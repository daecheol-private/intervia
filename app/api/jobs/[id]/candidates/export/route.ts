/**
 * 공고별 후보자 CSV 익스포트. 채용담당자가 외부 분석/공유 용도로 사용.
 *
 * 컬럼: 이름, 이메일, 전화, 경력, AI서류점수, AI추천, 면접점수, 면접추천,
 *      종합, 단계, 결정시점, 업로드일
 */
import { db } from "@/lib/db";
import {
  jobPostings,
  candidates,
  interviewSessions,
} from "@/lib/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { compositeScore } from "@/lib/utils";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const STAGE_KO: Record<string, string> = {
  applied: "지원",
  screened: "서류평가",
  ai_pending: "AI면접·대기",
  ai_evaluated: "AI면접·평가",
  round1_candidate: "1차·후보",
  round1_scheduling: "1차·스케쥴",
  round1_waiting: "1차·대기",
  round1_passed: "1차 합격",
  round2_passed: "2차 합격",
  hired: "최종 합격",
  rejected: "불합격",
  withdrawn: "지원취소",
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });
  if (
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(jobId))
  ) {
    return new Response("잠긴 공고입니다.", { status: 403 });
  }

  // CSV 에 실제 쓰는 컬럼만 — 전체 select() 는 resume_text·resume_masked_text(이력서 원문,
  // 후보자당 수십 KB)를 전 후보분 끌어왔다(GOTCHAS §0-0-5 금지 패턴). 대형 공고 export 시
  // 응답 지연·함수 메모리 스파이크(OOM) 원인.
  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      email: candidates.email,
      phone: candidates.phone,
      careerYears: candidates.careerYears,
      screeningScore: candidates.screeningScore,
      screeningReport: candidates.screeningReport,
      stage: candidates.stage,
      decisionNote: candidates.decisionNote,
      decidedAt: candidates.decidedAt,
      createdAt: candidates.createdAt,
    })
    .from(candidates)
    .where(eq(candidates.jobId, jobId))
    .orderBy(desc(candidates.createdAt));
  const ids = rows.map((r) => r.id);
  // 세션도 CSV 에 쓰는 것만 — messages(면접 대화록 전문, 세션당 수십 KB)는 제외.
  const sessions = ids.length
    ? await db
        .select({
          candidateId: interviewSessions.candidateId,
          status: interviewSessions.status,
          evaluation: interviewSessions.evaluation,
          createdAt: interviewSessions.createdAt,
        })
        .from(interviewSessions)
        .where(inArray(interviewSessions.candidateId, ids))
        .orderBy(desc(interviewSessions.createdAt))
    : [];
  const latestByCandidate = new Map<number, typeof sessions[number]>();
  for (const s of sessions) {
    if (!latestByCandidate.has(s.candidateId)) {
      latestByCandidate.set(s.candidateId, s);
    }
  }

  const header = [
    "ID",
    "이름",
    "이메일",
    "전화",
    "경력(년)",
    "AI서류점수",
    "AI추천",
    "면접점수",
    "면접추천",
    "종합점수",
    "단계",
    "결정메모",
    "결정시점",
    "업로드일",
  ];
  const lines: string[] = [header.join(",")];

  for (const c of rows) {
    const s = latestByCandidate.get(c.id);
    const interviewScore =
      s?.status === "completed" ? s.evaluation?.overall_score ?? null : null;
    const interviewRec =
      s?.status === "completed" ? s.evaluation?.recommendation ?? null : null;
    const composite = compositeScore(c.screeningScore, interviewScore);
    lines.push(
      [
        c.id,
        c.name,
        c.email,
        c.phone,
        c.careerYears,
        c.screeningScore,
        c.screeningReport?.recommendation,
        interviewScore,
        interviewRec,
        interviewScore != null ? composite : "",
        STAGE_KO[c.stage] ?? c.stage,
        c.decisionNote,
        c.decidedAt,
        c.createdAt,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  logAudit(req, {
    actor: me!,
    action: "candidate.bulk_delete" as const, // generic — CSV export tracking
    resourceType: "job",
    resourceId: jobId,
    orgId: job.orgId,
    metadata: { kind: "export_csv", rows: rows.length },
  });

  // BOM 추가 — Excel 한글 깨짐 방지
  const body = "﻿" + lines.join("\r\n");
  const filename = `intervia_${jobId}_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

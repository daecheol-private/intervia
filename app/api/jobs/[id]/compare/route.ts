import { db } from "@/lib/db";
import {
  jobPostings,
  candidates,
  interviewSessions,
  recordedInterviews,
} from "@/lib/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, ownsOrg } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";

export const runtime = "nodejs";

/**
 * 후보자 비교 전용 데이터 — 선택된 후보만 조회(폴링 아님).
 * 목록 API(/api/jobs/[id]/candidates)는 4~10초 폴링 경로라 면접 요약·대면 리포트까지
 * 실으면 무겁다. 비교 화면은 소수 후보를 1회 조회하므로 별도 엔드포인트로 분리한다.
 *
 * 반환: 서류(6축·JD요건·요약) + AI면접(점수·요약) + 대면 1/2차(점수·요약).
 */
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
  if (!job || !ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });
  if (
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(jobId, me!))
  )
    return new Response("잠긴 공고입니다.", { status: 403 });

  const idsParam = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isInteger);
  if (ids.length === 0) return Response.json([]);

  const cands = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      stage: candidates.stage,
      age: candidates.age,
      careerYears: candidates.careerYears,
      educationLevel: candidates.educationLevel,
      educationSchool: candidates.educationSchool,
      educationMajor: candidates.educationMajor,
      screeningScore: candidates.screeningScore,
      screeningReport: candidates.screeningReport,
    })
    .from(candidates)
    .where(and(eq(candidates.jobId, jobId), inArray(candidates.id, ids)));

  const candIds = cands.map((c) => c.id);

  const [sessions, recorded] = await Promise.all([
    candIds.length
      ? db
          .select({
            candidateId: interviewSessions.candidateId,
            status: interviewSessions.status,
            evaluation: interviewSessions.evaluation,
          })
          .from(interviewSessions)
          .where(inArray(interviewSessions.candidateId, candIds))
          .orderBy(desc(interviewSessions.createdAt))
      : Promise.resolve([]),
    candIds.length
      ? db
          .select({
            candidateId: recordedInterviews.candidateId,
            round: recordedInterviews.round,
            status: recordedInterviews.status,
            report: recordedInterviews.report,
          })
          .from(recordedInterviews)
          .where(inArray(recordedInterviews.candidateId, candIds))
          .orderBy(desc(recordedInterviews.id))
      : Promise.resolve([]),
  ]);

  // AI 면접 — 후보자별 최신 완료 세션의 종합점수 + 요약.
  const aiByCand = new Map<
    number,
    { score: number | null; summary: string | null }
  >();
  for (const s of sessions) {
    if (s.status !== "completed") continue;
    if (aiByCand.has(s.candidateId)) continue; // desc → 최신 1건
    aiByCand.set(s.candidateId, {
      score: s.evaluation?.overall_score ?? null,
      summary: s.evaluation?.summary ?? null,
    });
  }

  // 대면 면접 — 후보자 × 라운드별 최신 리포트(ready/confirmed) 점수 + 요약.
  const offlineByCand = new Map<
    number,
    Record<"round1" | "round2", { score: number | null; summary: string | null } | undefined>
  >();
  for (const r of recorded) {
    if (!r.report) continue;
    if (r.status !== "ready" && r.status !== "confirmed") continue;
    const entry =
      offlineByCand.get(r.candidateId) ?? ({} as Record<"round1" | "round2", { score: number | null; summary: string | null } | undefined>);
    if (!entry[r.round]) {
      entry[r.round] = {
        score: r.report.overall_score ?? null,
        summary: r.report.summary ?? null,
      };
      offlineByCand.set(r.candidateId, entry);
    }
  }

  const result = cands.map((c) => ({
    ...c,
    aiInterview: aiByCand.get(c.id) ?? null,
    offline: {
      round1: offlineByCand.get(c.id)?.round1 ?? null,
      round2: offlineByCand.get(c.id)?.round2 ?? null,
    },
  }));

  return Response.json(result);
}

/**
 * 대면 면접 질문지 — 조회(GET) / 생성·재생성(POST). `?round=round1|round2` (기본 round1).
 *   round1 = 1차 실무 면접 (직무·기술 검증 중심)
 *   round2 = 2차 임원 면접 (컬쳐핏·인재상·가치관 중심 — 법인 컬쳐핏 기준 반영)
 *
 * 게이트: 해당 라운드 면접 일정이 확정된 경우에만 생성 가능
 *   (interview_schedules 에 round 일치 · status='selected' row 존재).
 *
 * 생성 입력: 이력서(마스킹) + 서류평가(screeningReport) + AI 면접 평가(있으면)
 *   + 법인 컬쳐핏 기준(organizations.culture_fit_profile, 있으면 — 두 라운드 공통).
 * 면접관(같은 법인 누구나) 이 버튼을 누르면 LLM 이 질문지를 만들어 후보자당 라운드별 1건 저장.
 * 재생성하면 같은 row 를 덮어쓴다.
 *
 * 과금: 생성 성공마다 interview_question_gen(기본 5토큰) **후차감** — 라운드 구분 없이 동일 단가.
 *   chargeRepeatable 로 회차를 분리(refId=후보자, 라운드·재생성 합산 회차)하므로 성공 1회당 1건 과금.
 *   (멱등이 아님 — 단가표에 interview_question_gen 이 없어도 DEFAULT_PRICING=5 로 폴백.)
 */
import { db } from "@/lib/db";
import {
  organizations,
  interviewSessions,
  interviewSchedules,
  interviewQuestionSheets,
  users,
  type InterviewQuestionSheet,
} from "@/lib/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { generateJSON } from "@/lib/gemini";
import {
  buildInterviewQuestionsPrompt,
  buildExecutiveInterviewQuestionsPrompt,
  hasCultureFit,
  type CultureFitProfile,
} from "@/lib/prompts";
import { logAudit } from "@/lib/audit";
import { chargeRepeatable } from "@/lib/tokens";

export const runtime = "nodejs";

type Round = "round1" | "round2";

function parseRound(req: Request): Round | null {
  const r = new URL(req.url).searchParams.get("round") ?? "round1";
  return r === "round1" || r === "round2" ? r : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid))
    return new Response("잘못된 candidate id", { status: 400 });
  const round = parseRound(req);
  if (!round) return new Response("잘못된 round", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;

  const [sheet] = await db
    .select()
    .from(interviewQuestionSheets)
    .where(
      and(
        eq(interviewQuestionSheets.candidateId, cid),
        eq(interviewQuestionSheets.round, round)
      )
    );

  // 해당 라운드 일정 확정 여부 — 버튼 활성/비활성 판단용
  const [confirmed] = await db
    .select({ id: interviewSchedules.id })
    .from(interviewSchedules)
    .where(
      and(
        eq(interviewSchedules.candidateId, cid),
        eq(interviewSchedules.round, round),
        eq(interviewSchedules.status, "selected")
      )
    );

  let generatedByName: string | null = null;
  if (sheet?.generatedByUserId) {
    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, sheet.generatedByUserId));
    generatedByName = u?.name ?? null;
  }

  return Response.json({
    scheduleConfirmed: !!confirmed,
    sheet: sheet
      ? {
          questions: sheet.questions,
          basedOnScreening: sheet.basedOnScreening,
          basedOnInterview: sheet.basedOnInterview,
          basedOnCultureFit: sheet.basedOnCultureFit,
          generatedByName,
          createdAt: sheet.createdAt,
          updatedAt: sheet.updatedAt,
        }
      : null,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid))
    return new Response("잘못된 candidate id", { status: 400 });
  const round = parseRound(req);
  if (!round) return new Response("잘못된 round", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate, job } = g;

  // 게이트: 해당 라운드 면접 일정이 확정돼야 생성 가능
  const [confirmed] = await db
    .select({ id: interviewSchedules.id })
    .from(interviewSchedules)
    .where(
      and(
        eq(interviewSchedules.candidateId, cid),
        eq(interviewSchedules.round, round),
        eq(interviewSchedules.status, "selected")
      )
    );
  if (!confirmed)
    return new Response(
      `${round === "round2" ? "2차" : "1차"} 면접 일정이 확정된 후에 면접 문제를 생성할 수 있습니다.`,
      { status: 409 }
    );

  const resume = candidate.resumeMaskedText ?? "";
  if (!resume.trim())
    return new Response("이력서 내용이 없어 질문지를 생성할 수 없습니다.", {
      status: 400,
    });

  if (!job) return new Response("공고를 찾을 수 없습니다.", { status: 404 });

  const org = candidate.orgId
    ? (
        await db
          .select({
            name: organizations.name,
            cultureFitProfile: organizations.cultureFitProfile,
          })
          .from(organizations)
          .where(eq(organizations.id, candidate.orgId))
      )[0]
    : null;
  let cultureFit: CultureFitProfile | null = null;
  if (org?.cultureFitProfile) {
    try {
      cultureFit = JSON.parse(org.cultureFitProfile) as CultureFitProfile;
    } catch {
      /* 손상된 JSON 은 미설정으로 취급 */
    }
  }

  // 가장 최근 완료된 AI 면접 평가 (있으면)
  const [latestCompleted] = await db
    .select({ evaluation: interviewSessions.evaluation })
    .from(interviewSessions)
    .where(
      and(
        eq(interviewSessions.candidateId, cid),
        eq(interviewSessions.status, "completed")
      )
    )
    .orderBy(desc(interviewSessions.completedAt))
    .limit(1);
  const interviewEval = latestCompleted?.evaluation ?? null;
  const screening = candidate.screeningReport ?? null;

  const jobInfo = {
    company: org?.name ?? undefined,
    position: job.position,
    level: job.level,
    employmentType: job.employmentType,
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    idealProfile: job.idealProfile,
    evaluationFocus: job.evaluationFocus,
    tone: job.tone,
  };
  const prompt =
    round === "round2"
      ? buildExecutiveInterviewQuestionsPrompt(
          jobInfo,
          resume,
          screening,
          interviewEval,
          cultureFit
        )
      : buildInterviewQuestionsPrompt(
          jobInfo,
          resume,
          screening,
          interviewEval,
          cultureFit
        );

  let sheet: InterviewQuestionSheet;
  try {
    sheet = await generateJSON<InterviewQuestionSheet>(prompt, {
      task: "questionGen",
    });
  } catch (e) {
    console.error("[interview-questions] generation failed", e);
    return new Response(
      "면접 문제 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      { status: 502 }
    );
  }

  if (!sheet || !Array.isArray(sheet.sections) || sheet.sections.length === 0)
    return new Response(
      "면접 문제 생성 결과가 비어 있습니다. 다시 시도해 주세요.",
      { status: 502 }
    );

  const basedOnCultureFit = hasCultureFit(cultureFit);
  const now = new Date().toISOString();
  await db
    .insert(interviewQuestionSheets)
    .values({
      candidateId: cid,
      round,
      jobId: candidate.jobId,
      orgId: candidate.orgId,
      basedOnScreening: !!screening,
      basedOnInterview: !!interviewEval,
      basedOnCultureFit,
      questions: sheet,
      generatedByUserId: me!.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        interviewQuestionSheets.candidateId,
        interviewQuestionSheets.round,
      ],
      set: {
        jobId: candidate.jobId,
        orgId: candidate.orgId,
        basedOnScreening: !!screening,
        basedOnInterview: !!interviewEval,
        basedOnCultureFit,
        questions: sheet,
        generatedByUserId: me!.id,
        updatedAt: now,
      },
    });

  // 후차감 — 생성이 성공할 때마다 매번 과금 (재생성·라운드 추가 생성도 LLM 비용 발생 → chargeRepeatable 회차 분리).
  if (candidate.orgId) {
    await chargeRepeatable({
      orgId: candidate.orgId,
      feature: "interview_question_gen",
      baseRefType: "candidate",
      refId: cid,
      userId: me!.id,
      memo: `${round === "round2" ? "2차(임원) " : ""}면접 문제 생성 - ${candidate.name ?? ""}`.trim(),
    });
  }

  logAudit(req, {
    actor: me!,
    action: "interview_questions.generate",
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
    metadata: {
      round,
      basedOnScreening: !!screening,
      basedOnInterview: !!interviewEval,
      basedOnCultureFit,
      sections: sheet.sections.length,
    },
  });

  return Response.json({
    sheet: {
      questions: sheet,
      basedOnScreening: !!screening,
      basedOnInterview: !!interviewEval,
      basedOnCultureFit,
      generatedByName: me!.name,
      createdAt: now,
      updatedAt: now,
    },
  });
}

/**
 * 1차 대면 면접 질문지 — 조회(GET) / 생성·재생성(POST).
 *
 * 게이트: 후보자의 1차 면접 일정이 확정된 경우에만 생성 가능
 *   (interview_schedules 에 round='round1' · status='selected' row 존재).
 *
 * 생성 입력: 이력서(마스킹) + 서류평가(screeningReport) + AI 면접 평가(있으면).
 * 면접관(같은 법인 누구나) 이 버튼을 누르면 LLM 이 질문지를 만들어 후보자당 1건 저장.
 * 재생성하면 같은 row 를 덮어쓴다. 토큰 과금 없음(무료).
 */
import { db } from "@/lib/db";
import {
  candidates,
  jobPostings,
  organizations,
  interviewSessions,
  interviewSchedules,
  interviewQuestionSheets,
  users,
  type InterviewQuestionSheet,
} from "@/lib/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { generateJSON } from "@/lib/gemini";
import { buildInterviewQuestionsPrompt } from "@/lib/prompts";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

async function loadCandidate(cid: number) {
  const [c] = await db.select().from(candidates).where(eq(candidates.id, cid));
  return c ?? null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid))
    return new Response("잘못된 candidate id", { status: 400 });

  const candidate = await loadCandidate(cid);
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  const [sheet] = await db
    .select()
    .from(interviewQuestionSheets)
    .where(eq(interviewQuestionSheets.candidateId, cid));

  // 1차 일정 확정 여부 — 버튼 활성/비활성 판단용
  const [confirmed] = await db
    .select({ id: interviewSchedules.id })
    .from(interviewSchedules)
    .where(
      and(
        eq(interviewSchedules.candidateId, cid),
        eq(interviewSchedules.round, "round1"),
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

  const candidate = await loadCandidate(cid);
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  // 게이트: 1차 면접 일정이 확정돼야 생성 가능
  const [confirmed] = await db
    .select({ id: interviewSchedules.id })
    .from(interviewSchedules)
    .where(
      and(
        eq(interviewSchedules.candidateId, cid),
        eq(interviewSchedules.round, "round1"),
        eq(interviewSchedules.status, "selected")
      )
    );
  if (!confirmed)
    return new Response(
      "1차 면접 일정이 확정된 후에 면접 문제를 생성할 수 있습니다.",
      { status: 409 }
    );

  const resume = candidate.resumeMaskedText ?? "";
  if (!resume.trim())
    return new Response("이력서 내용이 없어 질문지를 생성할 수 없습니다.", {
      status: 400,
    });

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (!job) return new Response("공고를 찾을 수 없습니다.", { status: 404 });

  const org = candidate.orgId
    ? (
        await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, candidate.orgId))
      )[0]
    : null;

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

  let sheet: InterviewQuestionSheet;
  try {
    sheet = await generateJSON<InterviewQuestionSheet>(
      buildInterviewQuestionsPrompt(
        {
          company: org?.name ?? undefined,
          position: job.position,
          level: job.level,
          employmentType: job.employmentType,
          responsibilities: job.responsibilities,
          requirements: job.requirements,
          idealProfile: job.idealProfile,
          evaluationFocus: job.evaluationFocus,
          tone: job.tone,
        },
        resume,
        screening,
        interviewEval
      ),
      { task: "questionGen" }
    );
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

  const now = new Date().toISOString();
  await db
    .insert(interviewQuestionSheets)
    .values({
      candidateId: cid,
      jobId: candidate.jobId,
      orgId: candidate.orgId,
      basedOnScreening: !!screening,
      basedOnInterview: !!interviewEval,
      questions: sheet,
      generatedByUserId: me!.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: interviewQuestionSheets.candidateId,
      set: {
        jobId: candidate.jobId,
        orgId: candidate.orgId,
        basedOnScreening: !!screening,
        basedOnInterview: !!interviewEval,
        questions: sheet,
        generatedByUserId: me!.id,
        updatedAt: now,
      },
    });

  logAudit(req, {
    actor: me!,
    action: "interview_questions.generate",
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
    metadata: {
      basedOnScreening: !!screening,
      basedOnInterview: !!interviewEval,
      sections: sheet.sections.length,
    },
  });

  return Response.json({
    sheet: {
      questions: sheet,
      basedOnScreening: !!screening,
      basedOnInterview: !!interviewEval,
      generatedByName: me!.name,
      createdAt: now,
      updatedAt: now,
    },
  });
}

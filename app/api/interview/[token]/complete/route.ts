import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  jobPostings,
  organizations,
  type InterviewEvaluation,
} from "@/lib/schema";
import { eq } from "drizzle-orm";
import { generateJSON } from "@/lib/gemini";
import { buildSummaryPrompt } from "@/lib/prompts";
import { hasValidConsent } from "@/lib/consent";
import { notifyJobInterviewers } from "@/lib/notifications";
import { refundFeature } from "@/lib/tokens";
import { computeTranscriptStats } from "@/lib/interview-signals";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("세션 없음", { status: 404 });
  if (session.status === "completed" && session.evaluation) {
    return Response.json(session.evaluation);
  }
  if (session.messages.length < 2)
    return new Response("대화가 충분하지 않음", { status: 400 });

  if (!(await hasValidConsent(session.id))) {
    return Response.json(
      { error: "동의 없는 면접은 평가할 수 없습니다.", code: "consent_required" },
      { status: 403 }
    );
  }

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate!.jobId));
  const orgRow = job?.orgId
    ? (
        await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, job.orgId))
      )[0]
    : null;
  const companyName = orgRow?.name ?? null;

  const transcript = session.messages
    .map((m) => `${m.role === "user" ? "후보자" : "면접관"}: ${m.content}`)
    .join("\n\n");

  // 후보자 발언 통계 + 외부 LLM 보조 의심 신호 — complete·reevaluate 공용 헬퍼.
  const stats = computeTranscriptStats(session.messages);

  // 1) 세션 상태부터 completed 로 마킹. LLM 평가가 실패해도 면접 자체는 종결로 유지.
  await db
    .update(interviewSessions)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
    })
    .where(eq(interviewSessions.id, session.id));

  // 2) 후보자 전형 단계 자동 전환 — AI면접 전 단계만 ai_evaluated 로.
  const autoAdvance: ("applied" | "screened" | "ai_pending")[] = [
    "applied",
    "screened",
    "ai_pending",
  ];
  const nextStage = autoAdvance.includes(
    candidate!.stage as "applied" | "screened" | "ai_pending"
  )
    ? "ai_evaluated"
    : candidate!.stage;
  if (nextStage !== candidate!.stage) {
    await db
      .update(candidates)
      .set({ stage: nextStage })
      .where(eq(candidates.id, candidate!.id));
  }

  // 3) 후보자 답변이 실질적으로 없으면 LLM 호출 없이 자동 비추천 평가 저장.
  if (stats.candidateTurns === 0 || stats.candidateChars < 30) {
    const evaluation: InterviewEvaluation = {
      overall_score: 0,
      recommendation: "비추천",
      summary:
        "후보자가 면접에 사실상 응답하지 않았습니다 (답변 글자수 30자 미만). 평가 가능한 발언이 없어 자동 비추천 처리합니다.",
      scores: {
        기술역량: { score: 0, comment: "후보자 발언 없음 — 평가 불가." },
        실무경험: { score: 0, comment: "후보자 발언 없음 — 평가 불가." },
        협업커뮤니케이션: { score: 0, comment: "후보자 발언 없음 — 평가 불가." },
        직무적합성: { score: 0, comment: "후보자 발언 없음 — 평가 불가." },
      },
      strengths: [],
      concerns: [
        `후보자 답변 턴 ${stats.candidateTurns}회 / 총 글자수 ${stats.candidateChars}자 — 면접 미응답.`,
      ],
      followup_questions: [],
    };
    await db
      .update(interviewSessions)
      .set({ evaluation })
      .where(eq(interviewSessions.id, session.id));
    if (nextStage === "ai_evaluated") {
      void notifyJobInterviewers(candidate!.jobId, {
        type: "ai_interview_done",
        title: `${candidate!.name} 후보자의 AI 면접 평가가 완료되었습니다`,
        href: `/candidates/${candidate!.id}`,
        payload: { candidateId: candidate!.id, jobId: candidate!.jobId },
      });
    }
    return Response.json(evaluation);
  }

  // 4) LLM 평가. 실패해도 session 은 이미 completed → 면접완료 표시 유지.
  try {
    const evaluation = await generateJSON<InterviewEvaluation>(
      buildSummaryPrompt(
        {
          company: companyName ?? undefined,
          position: job!.position,
          level: job!.level,
          employmentType: job!.employmentType,
          responsibilities: job!.responsibilities,
          requirements: job!.requirements,
          idealProfile: job!.idealProfile,
          tone: job!.tone,
        },
        candidate!.resumeMaskedText ?? "",
        transcript,
        candidate!.screeningReport ?? null,
        stats
      ),
      { task: "interviewEval" }
    );

    await db
      .update(interviewSessions)
      .set({ evaluation })
      .where(eq(interviewSessions.id, session.id));

    if (nextStage === "ai_evaluated") {
      void notifyJobInterviewers(candidate!.jobId, {
        type: "ai_interview_done",
        title: `${candidate!.name} 후보자의 AI 면접 평가가 완료되었습니다`,
        href: `/candidates/${candidate!.id}`,
        payload: { candidateId: candidate!.id, jobId: candidate!.jobId },
      });
    }

    return Response.json(evaluation);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[interview/complete] LLM 평가 실패 (session ${session.id}):`, msg);
    // H3 — 평가 실패 시 면접 토큰 환불 (멱등). 재시도 시 chargeFeature 가 다시 차감.
    let refunded = 0;
    if (job?.orgId) {
      try {
        const r = await refundFeature({
          orgId: job.orgId,
          feature: "interview",
          refType: "interview_session",
          refId: session.id,
          userId: null,
          memo: `LLM 평가 실패 자동 환불: ${msg.slice(0, 80)}`,
        });
        refunded = r.refunded;
      } catch (re) {
        console.error("[interview/complete] refund failed:", re);
      }
    }
    // 평가 실패해도 면접 자체는 종료 — 면접관에게 재평가 필요 알림.
    if (nextStage === "ai_evaluated") {
      void notifyJobInterviewers(candidate!.jobId, {
        type: "ai_interview_done",
        title: `${candidate!.name} 후보자의 AI 면접이 종료되었습니다 (자동 평가 실패 — 재평가 필요)`,
        href: `/candidates/${candidate!.id}`,
        payload: { candidateId: candidate!.id, jobId: candidate!.jobId },
      });
    }
    return Response.json(
      {
        status: "completed",
        evaluation: null,
        evaluation_error: msg,
        message: "면접은 종료되었으나 자동 평가 생성에 실패했습니다.",
        refunded,
      },
      { status: 200 }
    );
  }
}

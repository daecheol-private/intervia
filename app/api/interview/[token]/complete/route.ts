import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  jobPostings,
  organizations,
  type InterviewEvaluation,
} from "@/lib/schema";
import { and, eq, ne } from "drizzle-orm";
import { generateJSON } from "@/lib/gemini";
import { buildSummaryPrompt, type CultureFitProfile } from "@/lib/prompts";
import { parseTraitProfile } from "@/lib/personality";
import { hasValidConsent, piiFallbackActive } from "@/lib/consent";
import { notifyJobInterviewers } from "@/lib/notifications";
import { chargeRepeatable } from "@/lib/tokens";
import { computeTranscriptStats } from "@/lib/interview-signals";
import { isAiInterviewSuperseded } from "@/lib/stage-meta";
import { logAudit } from "@/lib/audit";
import { newErrorRef } from "@/lib/error-ref";

export const runtime = "nodejs";
// 면접 종료 시 인터뷰 평가 LLM(generateJSON)을 동기 호출 — Vertex 서울 기준 수십 초.
// maxDuration 미설정 시 Vercel 기본값(~15s)에서 잘려 후보자 면접 종료가 실패한다.
export const maxDuration = 120;

// 후보자(무인증 토큰)에게 돌려주는 안전 응답 — 평가 결과(점수·추천·concerns)는 절대 노출하지 않는다.
// 자동화 의사결정(PIPA §37의2)은 채용 담당자의 인간 검토를 거쳐 통보되므로, 후보자 면접 종료 응답엔
// 감사 메시지만 담는다. 평가 조회는 인증된 관리자 라우트(/api/candidates/[id] 등)로만.
const DONE_RESPONSE = {
  status: "completed" as const,
  message: "면접이 종료되었습니다. 결과는 채용 담당자가 검토 후 안내해 드립니다.",
};

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
    return Response.json(DONE_RESPONSE);
  }
  // 만료된 세션 차단 — 만료 토큰으로 평가 생성·덮어쓰기 방지 (consent 라우트와 일관).
  // 단 위의 멱등(이미 completed+evaluation) 케이스는 만료여도 그대로 반환.
  if (
    session.status === "expired" ||
    new Date(session.expiresAt) < new Date()
  )
    return new Response("만료된 면접 링크입니다.", { status: 410 });
  if (session.messages.length < 2)
    return new Response("대화가 충분하지 않음", { status: 400 });

  if (!(await hasValidConsent(session.id, session.candidateId))) {
    return Response.json(
      { error: "동의 없는 면접은 평가할 수 없습니다.", code: "consent_required" },
      { status: 403 }
    );
  }

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  // 후보자가 AI 단계를 지났거나 종결됨 → 뒤늦은 제출로 평가·과금이 생성되는 것을 차단.
  // (페이지를 미리 열어둔 채 단계 전진/종결된 뒤 제출하는 유령 응시·더블차감 방지.)
  if (
    candidate &&
    isAiInterviewSuperseded({ stage: candidate.stage, outcome: candidate.outcome })
  )
    return new Response(
      "이미 다음 전형으로 진행되어 이 면접은 더 이상 제출할 수 없습니다.",
      { status: 409 }
    );
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate!.jobId));
  const orgRow = job?.orgId
    ? (
        await db
          .select({
            name: organizations.name,
            cultureFitProfile: organizations.cultureFitProfile,
          })
          .from(organizations)
          .where(eq(organizations.id, job.orgId))
      )[0]
    : null;
  const companyName = orgRow?.name ?? null;
  let cultureFit: CultureFitProfile | null = null;
  if (orgRow?.cultureFitProfile) {
    try { cultureFit = JSON.parse(orgRow.cultureFitProfile) as CultureFitProfile; } catch { /* ignore */ }
  }
  // 선호 특성 프로필은 공고 단위 — 법인 JSON 의 레거시 값을 공고 값으로 대체
  if (cultureFit) cultureFit.traitProfile = parseTraitProfile(job?.traitProfile);
  const personality =
    session.personalityProfile && session.personalityResponses
      ? {
          profile: session.personalityProfile,
          responses: session.personalityResponses,
        }
      : null;

  const transcript = session.messages
    .map((m) => `${m.role === "user" ? "후보자" : "면접관"}: ${m.content}`)
    .join("\n\n");

  // 후보자 발언 통계 + 외부 LLM 보조 의심 신호 — complete·reevaluate 공용 헬퍼.
  const stats = computeTranscriptStats(session.messages);

  // 1) 세션을 원자적으로 claim — 아직 completed 가 아닐 때만 completed 로 조건부 전이.
  //    LLM 평가(~30-40초) 전에 status 만 먼저 completed 로 바꾸는 구조라, 이 claim 이 없으면
  //    그 윈도우에 들어온 두 번째 POST(무인증 토큰·병렬)가 status=completed·evaluation=null 로
  //    위 멱등 게이트(:39)를 통과해 LLM 재실행 + chargeRepeatable 재과금이 발생한다.
  //    0행 = 이미 다른 요청이 완료 처리 중/완료 → 즉시 안전 응답(첫 claim 승자만 평가·과금).
  //    실패로 evaluation 이 비어도 재시도는 인증된 reevaluate 라우트로 (여기선 재실행 금지).
  const claimed = await db
    .update(interviewSessions)
    .set({
      status: "completed",
      completedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(interviewSessions.id, session.id),
        ne(interviewSessions.status, "completed")
      )
    )
    .returning({ id: interviewSessions.id });
  if (claimed.length === 0) return Response.json(DONE_RESPONSE);

  logAudit(_req, {
    actorRole: "candidate",
    action: "interview.complete",
    resourceType: "interview_session",
    resourceId: session.id,
    orgId: candidate!.orgId,
    jobId: candidate!.jobId,
    metadata: {
      candidateId: candidate!.id,
      candidateTurns: stats.candidateTurns,
    },
  });

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
    return Response.json(DONE_RESPONSE);
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
          evaluationFocus: job!.evaluationFocus,
          tone: job!.tone,
        },
        candidate!.resumeMaskedText ?? "",
        transcript,
        candidate!.screeningReport ?? null,
        stats,
        cultureFit,
        personality
      ),
      // hasValidConsent 통과 = 세션 동의가 현재 버전(1.9.0+, 도쿄 폴백 고지 포함).
      { task: "interviewEval", allowFallback: piiFallbackActive() }
    );

    await db
      .update(interviewSessions)
      .set({ evaluation })
      .where(eq(interviewSessions.id, session.id));

    // 후차감 — 면접 진행+평가가 성공적으로 끝난 시점에만 과금 (서류평가와 동일 모델).
    // chargeRepeatable: 재평가가 성공할 때마다 매번 1건씩 과금된다(complete=1회차, reevaluate=2회차…).
    if (job?.orgId) {
      await chargeRepeatable({
        orgId: job.orgId,
        feature: "interview",
        baseRefType: "interview_session",
        refId: session.id,
        // 차감 주체는 후보자가 아니라 면접을 결정·발급한 운영자.
        userId: session.createdByUserId,
        memo: "AI 면접 평가 완료",
      });
    }

    if (nextStage === "ai_evaluated") {
      void notifyJobInterviewers(candidate!.jobId, {
        type: "ai_interview_done",
        title: `${candidate!.name} 후보자의 AI 면접 평가가 완료되었습니다`,
        href: `/candidates/${candidate!.id}`,
        payload: { candidateId: candidate!.id, jobId: candidate!.jobId },
      });
    }

    return Response.json(DONE_RESPONSE);
  } catch (e: unknown) {
    const ref = newErrorRef();
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[interview/complete] LLM 평가 실패 (session ${session.id}, ref ${ref}):`,
      msg
    );
    // 후차감 모델 — 평가 실패 시 애초에 과금하지 않았으므로 환불도 불필요(서류평가와 동일).
    //   운영자가 reevaluate 로 재평가에 성공하면 그 시점에 1건 과금된다.
    // 평가 실패해도 면접 자체는 종료 — 면접관에게 재평가 필요 알림.
    if (nextStage === "ai_evaluated") {
      void notifyJobInterviewers(candidate!.jobId, {
        type: "ai_interview_done",
        title: `${candidate!.name} 후보자의 AI 면접이 종료되었습니다 (자동 평가 실패 — 재평가 필요 · 오류 코드 ${ref})`,
        href: `/candidates/${candidate!.id}`,
        payload: { candidateId: candidate!.id, jobId: candidate!.jobId },
      });
    }
    // 후보자에겐 기술 에러(evaluation_error)도 노출하지 않는다 — 안전 응답으로 통일.
    // 평가 실패 사실/원인은 면접관 알림·서버 로그로만 전달된다.
    return Response.json(DONE_RESPONSE);
  }
}

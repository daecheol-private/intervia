/**
 * AI 면접 평가 재시도 (M3).
 *
 * 운영 시나리오: LLM 응답 JSON 파싱 실패·timeout 으로 evaluation=null 인 세션을
 * 같은 transcript 로 다시 평가. H3 에서 실패 시 환불됐으므로 본 라우트는 chargeFeature
 * 로 다시 차감 후 generateJSON 호출. 재시도 실패 시 또 환불.
 *
 * 인증: 로그인 사용자 + ownsOrg + 잠금 가드.
 * 멱등: 이미 evaluation 이 채워져 있으면 409.
 */
import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  jobPostings,
  organizations,
  type InterviewEvaluation,
} from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { rateLimit } from "@/lib/rate-limit";
import { generateJSON } from "@/lib/gemini";
import { buildSummaryPrompt } from "@/lib/prompts";
import { chargeFeature, refundFeature } from "@/lib/tokens";
import {
  requirePositiveBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const limited = await rateLimit(
    req,
    "interview-reevaluate",
    { limit: 10, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { id } = await params;
  const sid = Number(id);
  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.id, sid));
  if (!session) return new Response("세션 없음", { status: 404 });

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  if (!candidate) return new Response("후보자 없음", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (!job) return new Response("공고 없음", { status: 404 });
  if (
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(job.id))
  ) {
    return new Response("잠긴 공고입니다.", { status: 403 });
  }

  if (session.status !== "completed") {
    return new Response(
      "면접이 종료되지 않은 세션은 재평가할 수 없습니다.",
      { status: 409 }
    );
  }
  if (session.evaluation) {
    return new Response(
      "이미 평가가 완료되었습니다. 재평가가 필요하면 면접 종결 후 새 면접을 진행해 주세요.",
      { status: 409 }
    );
  }
  if (!session.messages || session.messages.length < 2) {
    return new Response("대화가 충분하지 않아 재평가할 수 없습니다.", {
      status: 400,
    });
  }

  // 잔액 가드 — 재평가도 토큰 차감이므로 마이너스면 차단
  const balanceGuard = await requirePositiveBalance(candidate.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  // 토큰 차감 (멱등) — H3 에서 환불된 ledger 다음에 재차감.
  if (candidate.orgId) {
    await chargeFeature({
      orgId: candidate.orgId,
      feature: "interview",
      refType: "interview_session",
      refId: session.id,
      userId: me!.id,
      memo: `평가 재시도 by ${me!.email}`,
    });
  }

  const orgRow = job.orgId
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

  const userMsgs = session.messages.filter((m) => m.role === "user");
  const candidateChars = userMsgs.reduce(
    (sum, m) => sum + m.content.trim().length,
    0
  );
  const stats = {
    totalTurns: session.messages.length,
    candidateTurns: userMsgs.length,
    candidateChars,
    candidateAvgChars: userMsgs.length
      ? Math.round(candidateChars / userMsgs.length)
      : 0,
    interviewerTurns: session.messages.length - userMsgs.length,
    llmAssistSignal: {
      pasteEvents: 0,
      pastedChars: 0,
      typedChars: candidateChars,
      pasteRatio: 0,
      suspicious: false,
    },
  };

  try {
    const evaluation = await generateJSON<InterviewEvaluation>(
      buildSummaryPrompt(
        {
          company: companyName ?? undefined,
          position: job.position,
          level: job.level,
          employmentType: job.employmentType,
          responsibilities: job.responsibilities,
          requirements: job.requirements,
          idealProfile: job.idealProfile,
          tone: job.tone,
        },
        candidate.resumeMaskedText ?? "",
        transcript,
        candidate.screeningReport ?? null,
        stats
      ),
      { task: "interviewEval" }
    );

    await db
      .update(interviewSessions)
      .set({ evaluation })
      .where(eq(interviewSessions.id, session.id));

    logAudit(req, {
      actor: me!,
      action: "interview.reevaluate",
      resourceType: "interview_session",
      resourceId: session.id,
      orgId: candidate.orgId,
    });

    return Response.json({ ok: true, evaluation });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[interview/reevaluate] LLM 평가 재실패 (session ${session.id}):`,
      msg
    );
    // 실패 시 다시 환불 (멱등 — refundFeature 는 동일 ledger 에 이미 환불 있으면 no-op)
    let refunded = 0;
    if (candidate.orgId) {
      try {
        const r = await refundFeature({
          orgId: candidate.orgId,
          feature: "interview",
          refType: "interview_session",
          refId: session.id,
          userId: me!.id,
          memo: `재평가 실패 자동 환불: ${msg.slice(0, 80)}`,
        });
        refunded = r.refunded;
      } catch (re) {
        console.error("[interview/reevaluate] refund failed:", re);
      }
    }
    return Response.json(
      {
        ok: false,
        error: "재평가에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        detail: msg,
        refunded,
      },
      { status: 500 }
    );
  }
}

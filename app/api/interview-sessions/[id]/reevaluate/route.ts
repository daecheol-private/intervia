/**
 * AI 면접 평가 재시도 (M3).
 *
 * 운영 시나리오: LLM 응답 JSON 파싱 실패·timeout 으로 evaluation=null 인 세션을
 * 같은 transcript 로 다시 평가. 면접은 후차감 — 재평가가 성공한 시점에만 interview 1건
 * 과금(멱등, refId=session.id). 실패 시 과금 없음(환불도 불필요).
 *
 * 인증: 로그인 사용자 + ownsOrg + 잠금 가드.
 * 재평가는 성공할 때마다 매번 과금(chargeRepeatable). 이미 평가 완료된 세션도 재평가 가능(덮어쓰기).
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
import { buildSummaryPrompt, type CultureFitProfile } from "@/lib/prompts";
import { parseTraitProfile } from "@/lib/personality";
import { computeTranscriptStats } from "@/lib/interview-signals";
import { chargeRepeatable } from "@/lib/tokens";
import {
  requireSpendableBalance,
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
  // 이미 평가 완료된 세션도 재평가 허용(덮어쓰기). 재평가 성공 시 매번 과금되므로
  // 운영자의 명시적 재실행에만 발생한다(아래 rate limit 10/분 + 성공 시 후차감).
  if (!session.messages || session.messages.length < 2) {
    return new Response("대화가 충분하지 않아 재평가할 수 없습니다.", {
      status: 400,
    });
  }

  // 잔액 가드 — 재평가도 토큰 차감이므로 0 이하면 차단
  const balanceGuard = await requireSpendableBalance(candidate.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  const orgRow = job.orgId
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
  if (cultureFit) cultureFit.traitProfile = parseTraitProfile(job.traitProfile);
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

  // 재평가도 동일 신호 로직 — 저장된 messages.inputSignals 에서 집계.
  const stats = computeTranscriptStats(session.messages);

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
          evaluationFocus: job.evaluationFocus,
          tone: job.tone,
        },
        candidate.resumeMaskedText ?? "",
        transcript,
        candidate.screeningReport ?? null,
        stats,
        cultureFit,
        personality
      ),
      { task: "interviewEval" }
    );

    await db
      .update(interviewSessions)
      .set({ evaluation })
      .where(eq(interviewSessions.id, session.id));

    // 후차감 — 재평가가 성공할 때마다 매번 1건 과금 (chargeRepeatable 회차 분리).
    if (candidate.orgId) {
      await chargeRepeatable({
        orgId: candidate.orgId,
        feature: "interview",
        baseRefType: "interview_session",
        refId: session.id,
        userId: me!.id,
        memo: `AI 면접 재평가 완료 by ${me!.email}`,
      });
    }

    logAudit(req, {
      actor: me!,
      action: "interview.reevaluate",
      resourceType: "interview_session",
      resourceId: session.id,
      orgId: candidate.orgId,
      jobId: candidate.jobId,
      metadata: { candidateId: candidate.id },
    });

    return Response.json({ ok: true, evaluation });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[interview/reevaluate] LLM 평가 재실패 (session ${session.id}):`,
      msg
    );
    // 후차감 모델 — 재평가 실패 시 과금 자체가 없으므로 환불 불필요. 다시 시도하면 된다.
    return Response.json(
      {
        ok: false,
        error: "재평가에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        detail: msg,
      },
      { status: 500 }
    );
  }
}

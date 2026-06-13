import { db } from "@/lib/db";
import { candidates, interviewSessions, screeningJobs } from "@/lib/schema";
import { isJobExpired } from "@/lib/job-lifecycle";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { generateToken, addDays } from "@/lib/utils";
import { STAGE_RANK, type Stage } from "@/lib/stage-meta";
import {
  requireSpendableBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const body = (await req.json().catch(() => ({}))) as { days?: number };
  const days = body.days ?? 7;

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate, job } = g;

  // 종결(합격·불합격·지원취소)된 후보는 AI 면접 링크 발급 불가.
  if (candidate.outcome) {
    return Response.json(
      {
        code: "candidate_terminated",
        error: "이미 종결된 후보자에게는 AI 면접 링크를 발급할 수 없습니다.",
      },
      { status: 409 }
    );
  }

  // AI 면접 전형을 지나(스킵 포함) 1차 면접 이상으로 진행된 후보는 AI 면접 링크 발급/재발송 불가.
  // (AI면접 단계: ai_pending / ai_evaluated. 그 이후 단계로 넘어가면 AI면접 전형이 종료된 것으로 간주)
  if (STAGE_RANK[candidate.stage as Stage] > STAGE_RANK.ai_evaluated) {
    return Response.json(
      {
        code: "ai_stage_passed",
        error:
          "AI 면접 전형이 종료되었습니다. 이미 다음 전형으로 진행된 후보자에게는 AI 면접 링크를 발급할 수 없습니다.",
      },
      { status: 409 }
    );
  }

  // 잔액 가드
  const balanceGuard = await requireSpendableBalance(candidate.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  // 종결·만료 공고는 새 면접 발급 불가
  if (job?.status === "closed")
    return Response.json(
      { code: "job_closed", message: "종결된 공고입니다. 연장 후 다시 시도해 주세요." },
      { status: 409 }
    );
  if (job && isJobExpired(job))
    return Response.json(
      {
        code: "job_expired",
        message:
          "공고 종결 예정일이 지났습니다. 공고를 연장하거나 종결한 후 다시 시도해 주세요.",
      },
      { status: 409 }
    );

  // AI 면접은 서류평가 결과(interview_focus / strengths / concerns)를 기반으로 진행되므로
  // 서류평가가 끝나지 않은 후보자는 면접 링크 생성 차단.
  // 단, AI 이력서 평가를 끈 공고(job.aiScreeningDisabled)는 리포트 없이도 면접 진행 가능.
  if (!candidate.screeningReport && !job?.aiScreeningDisabled) {
    const [lastJob] = await db
      .select({ status: screeningJobs.status })
      .from(screeningJobs)
      .where(eq(screeningJobs.candidateId, cid))
      .orderBy(desc(screeningJobs.id))
      .limit(1);
    const msg =
      lastJob?.status === "queued" || lastJob?.status === "processing"
        ? "AI 서류평가가 진행 중입니다. 평가가 끝난 뒤 면접 링크를 생성할 수 있습니다."
        : lastJob?.status === "failed"
        ? "AI 서류평가가 실패했습니다. 평가를 재시도한 뒤 면접 링크를 생성해 주세요."
        : "AI 서류평가가 완료되지 않았습니다. 평가를 먼저 진행해 주세요.";
    return Response.json(
      { error: msg, code: "screening_required" },
      { status: 409 }
    );
  }

  // 본인확인 게이트(D-1) — AI 면접은 등록 이메일로 본인을 확인한다(동의·셀프서비스 라우트와 일관).
  // 이메일이 없으면 본인확인이 불가하므로 발급 단계에서 막고, HR 에게 이력서 수정으로
  // 이메일을 추가하도록 안내한다. (이메일 없이는 면접 링크 발송 자체도 불가)
  if (!candidate.email) {
    return Response.json(
      {
        code: "candidate_email_required",
        error:
          "후보자에게 등록된 이메일이 없습니다. 후보자 정보(이력서)를 수정해 이메일을 추가한 뒤 면접 링크를 발급해 주세요.",
      },
      { status: 400 }
    );
  }

  const token = generateToken();
  const expiresAt = addDays(new Date(), days).toISOString();

  const [session] = await db
    .insert(interviewSessions)
    .values({
      candidateId: cid,
      createdByUserId: me!.id,
      accessToken: token,
      expiresAt,
    })
    .returning();

  // 토큰 차감은 지원자가 링크로 들어와 동의 후 면접을 실제 시작할 때 수행
  // (app/api/interview/[token]/consent). 링크 발급/재발급은 무료.

  // 면접 링크 발급 시점에 전형 단계 자동 전환 — 아직 결정 단계 전이면 AI면접·대기로.
  if (
    candidate.stage === "applied" ||
    candidate.stage === "screened"
  ) {
    await db
      .update(candidates)
      .set({ stage: "ai_pending" })
      .where(eq(candidates.id, cid));
  }

  return Response.json(session);
}

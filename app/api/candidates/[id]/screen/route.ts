import { db } from "@/lib/db";
import { candidates, jobPostings, screeningJobs } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { chargeFeature } from "@/lib/tokens";
import { enqueueScreening } from "@/lib/screening-queue";
import { triggerWorker } from "@/lib/worker-trigger";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import {
  requirePositiveBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";

export const runtime = "nodejs";

/**
 * 후보자 서류 평가 큐 등록.
 * - 큐에 enqueue → 워커가 비동기로 처리 (즉시 worker 트리거 + cron 안전망)
 * - resume_upload 토큰 차감 (실패 시 큐의 final fail 단계에서 자동환불)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const limited = await rateLimit(
    req,
    "llm-screen",
    { limit: 30, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { id } = await params;
  const cid = Number(id);
  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  // 지원자 동의 확인 게이트 — 업로드 시점에 confirm 했어야 평가 가능.
  // 마이그레이션 이전 row 보호: 2026-05-22 이전 createdAt 은 면제 (legacy).
  if (
    !candidate.applicantConsentConfirmedAt &&
    new Date(candidate.createdAt) >= new Date("2026-05-22")
  ) {
    return Response.json(
      {
        code: "applicant_consent_required",
        message:
          "이 후보자는 업로드 시점에 지원자 동의 확인이 기록되지 않아 AI 평가를 진행할 수 없습니다. 후보자를 삭제하고 동의 확인 후 재업로드해 주세요.",
      },
      { status: 400 }
    );
  }

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

  // 잔액 가드 — 0 이하면 평가 차단
  const balanceGuard = await requirePositiveBalance(candidate.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  // 상태 체크: 리포트 없음 + 큐 진행 중 아님일 때만 트리거 (실패 후 재시도 OK).
  if (candidate.screeningReport) {
    return new Response("이미 평가 완료된 후보입니다.", { status: 409 });
  }
  const [lastJob] = await db
    .select({ status: screeningJobs.status })
    .from(screeningJobs)
    .where(eq(screeningJobs.candidateId, cid))
    .orderBy(desc(screeningJobs.id))
    .limit(1);
  if (lastJob?.status === "queued" || lastJob?.status === "processing") {
    return new Response("이미 진행 중인 후보입니다.", { status: 409 });
  }
  const textForLLM = candidate.resumeMaskedText ?? "";
  if (textForLLM.length < 30) {
    return new Response(
      "마스킹된 이력서 텍스트가 없습니다. 재업로드 해주세요.",
      { status: 400 }
    );
  }

  // 토큰 차감 (멱등). 실패 시 큐 최종 실패 단계에서 자동환불.
  if (candidate.orgId) {
    await chargeFeature({
      orgId: candidate.orgId,
      feature: "resume_upload",
      refType: "candidate",
      refId: candidate.id,
      userId: me!.id,
      memo: candidate.name,
    });
  }

  // 큐 등록 — 실제 LLM 호출은 워커가 수행
  const result = await enqueueScreening(cid, me!.id);

  // 워커 즉시 깨우기 (fire-and-forget)
  triggerWorker(req);

  logAudit(req, {
    actor: me!,
    action: "screen.trigger",
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
  });

  return Response.json({ ok: true, ...result });
}

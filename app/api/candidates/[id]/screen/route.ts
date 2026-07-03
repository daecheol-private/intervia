import { db } from "@/lib/db";
import { candidates, jobPostings, screeningJobs } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { enqueueScreening } from "@/lib/screening-queue";
import { triggerWorker } from "@/lib/worker-trigger";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { parseDbTimestamp } from "@/lib/utils";
import {
  requireSpendableBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";

export const runtime = "nodejs";

/**
 * 후보자 서류 평가 큐 등록 (신규 평가 + 재평가 공용).
 * - 큐에 enqueue → 워커가 비동기로 처리 (즉시 worker 트리거 + cron 안전망)
 * - 과금은 워커가 "평가 성공" 시점에 함 (chargeScreeningSuccess). 여기선 차감 안 함.
 * - 이미 평가 완료된 후보도 허용 — 공고/평가가이드 수정 후 또는 재확인용 재평가.
 *   기존 리포트는 새 평가가 성공하면 덮어쓴다(진행 중엔 기존 결과 유지).
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
    parseDbTimestamp(candidate.createdAt) >= new Date("2026-05-22")
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
  const balanceGuard = await requireSpendableBalance(candidate.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  const [lastJob] = await db
    .select({ id: screeningJobs.id, status: screeningJobs.status })
    .from(screeningJobs)
    .where(eq(screeningJobs.candidateId, cid))
    .orderBy(desc(screeningJobs.id))
    .limit(1);

  // 워커가 실제 점유 중(processing)이면 중복 실행 금지.
  if (lastJob?.status === "processing") {
    return new Response("평가가 실행 중입니다. 잠시 후 다시 시도해 주세요.", {
      status: 409,
    });
  }

  // 이미 queued(재시도 대기/백오프 포함)면 새 job 을 만들지 않고 백오프만 해제 후 즉시 워커를
  // 깨운다 — "지금 다시 시도". (로컬은 cron 이 없어 백오프가 안 풀리므로 이 수동 경로가 중요.)
  if (lastJob?.status === "queued") {
    await db
      .update(screeningJobs)
      .set({ notBefore: null })
      .where(eq(screeningJobs.id, lastJob.id));
    triggerWorker(req);
    logAudit(req, {
      actor: me!,
      action: "screen.retry_now",
      resourceType: "candidate",
      resourceId: cid,
      orgId: candidate.orgId,
      jobId: candidate.jobId,
    });
    return Response.json({ ok: true, status: "retry_kicked", jobId: lastJob.id });
  }

  // NOTE: resumeMaskedText 가 비어 있어도 차단하지 않는다 — 파싱은 워커가
  // 평가 직전에 수행(ensureParsed)하므로, 미파싱/파싱실패 후보의 재시도도 여기서 enqueue.
  // 진짜 추출 불가(스캔 PDF)면 워커가 실패 사유를 job.lastError 로 남긴다.

  // 큐 등록 — 실제 LLM 호출은 워커가 수행. 과금도 워커가 성공 시점에 함.
  const result = await enqueueScreening(cid, me!.id);

  // 워커 즉시 깨우기 (fire-and-forget)
  triggerWorker(req);

  logAudit(req, {
    actor: me!,
    action: "screen.trigger",
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
    jobId: candidate.jobId,
  });

  return Response.json({ ok: true, ...result });
}

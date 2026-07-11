import {
  claimNextRecorded,
  cleanupStuckRecorded,
  getQueuedRecordedCount,
  markRecordedFailedOrRetry,
  processRecordedInterview,
  requeueRecordedOutage,
  RecordedInterviewError,
} from "@/lib/recorded-interview-queue";
import { isCapacityOutageError } from "@/lib/gemini";
import { getCurrentUser } from "@/lib/auth";
import { secretEquals } from "@/lib/secret-compare";
import { workerBaseUrl } from "@/lib/worker-trigger";
import { isTransientDbError } from "@/lib/db-retry";
import { captureError } from "@/lib/error-reporter";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
// 한 실행에서 한 건(전사 ≤240s + 평가)을 처리. 남은 건은 self-chain.
export const maxDuration = 300;

/**
 * 대면 면접 녹음(업로드 모드) 백그라운드 워커.
 *
 * 인증: 내부 호출(X-Internal-Secret) / Vercel cron(시크릿 미설정 시) / system_admin.
 * 한 실행 = 한 건 처리 (전사+평가가 길어 단건). 성공 후 남은 queued 있으면 self-chain.
 * 실패-재큐 건은 self-chain 하지 않음 — busy-loop 대신 매분 cron 이 ~1분 backoff 로 재시도.
 */
async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.INTERNAL_API_SECRET;
  const header = req.headers.get("x-internal-secret");
  if (secret && secretEquals(header, secret)) return null;
  if (req.headers.get("x-vercel-cron") === "1" && !secret) return null;
  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
}

function chainSelf(req: Request) {
  const base = workerBaseUrl(req);
  void fetch(`${base}/api/internal/process-recorded-interviews`, {
    method: "POST",
    headers: { "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "" },
  }).catch((e) => console.error("recorded chainSelf failed", e));
}

export async function POST(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  // 유지보수(stuck 복구) — Turso 일시 5xx 는 이번 틱만 건너뜀(다음 cron 복구).
  let stuckRecovered = 0;
  try {
    stuckRecovered = await cleanupStuckRecorded();
  } catch (e) {
    if (!isTransientDbError(e)) throw e;
    log.warn("recorded_worker.cleanup_transient_skip", {
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  let claim: Awaited<ReturnType<typeof claimNextRecorded>> = null;
  try {
    claim = await claimNextRecorded();
  } catch (e) {
    if (!isTransientDbError(e)) throw e;
    log.warn("recorded_worker.claim_transient_skip", {
      reason: e instanceof Error ? e.message : String(e),
    });
    return Response.json({ ok: true, stuckRecovered, processed: 0 });
  }
  if (!claim) return Response.json({ ok: true, stuckRecovered, processed: 0 });

  let result: "success" | "failed_retry" | "failed_permanent";
  try {
    await processRecordedInterview(claim.id);
    result = "success";
  } catch (e) {
    const permanent = e instanceof RecordedInterviewError ? e.permanent : false;
    const msg = e instanceof Error ? e.message : String(e);
    log.error("recorded_worker.process_failed", e, {
      recordedInterviewId: claim.id,
      attempts: claim.attempts,
    });
    // 리전 용량 장애(429/503)는 상한에 카운트하지 않고 재큐 (Phase 3). self-chain 도
    // 생략해 장애 중 busy-loop 를 막는다 — 운영은 매분 cron 이 재시도, 복구 시 자동 재개.
    if (!permanent && isCapacityOutageError(e)) {
      await requeueRecordedOutage(claim.id, msg);
      return Response.json({
        ok: true,
        stuckRecovered,
        processed: 1,
        result: "failed_outage",
      });
    }
    const r = await markRecordedFailedOrRetry(
      claim.id,
      claim.attempts,
      msg,
      permanent
    );
    result = r.permanent ? "failed_permanent" : "failed_retry";
    if (r.permanent)
      captureError(e, {
        route: "internal/process-recorded-interviews",
        recordedInterviewId: claim.id,
      });
  }

  // 처리할 게 남아 있으면(성공으로 다음 건이 남았든, 일시 실패로 재큐됐든) 이어서 처리한다.
  // 로컬은 cron 이 없어 self-chain 이 유일한 재시도 구동원 — MAX_RECORDED_ATTEMPTS 상한이
  // 무한 루프를 막는다(일시 실패는 상한까지 재시도 후 failed 로 큐에서 빠짐).
  const remaining = await getQueuedRecordedCount().catch(() => 0);
  if (remaining > 0) chainSelf(req);

  return Response.json({ ok: true, stuckRecovered, processed: 1, result, remaining });
}

// GET 도 허용 — 모니터링 / cron 호환.
export async function GET(req: Request) {
  return POST(req);
}

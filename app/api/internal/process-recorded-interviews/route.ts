import {
  claimNextRecorded,
  cleanupStuckRecorded,
  getQueuedRecordedCount,
  markRecordedFailedOrRetry,
  processRecordedInterview,
  RecordedInterviewError,
} from "@/lib/recorded-interview-queue";
import { getCurrentUser } from "@/lib/auth";
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
  if (secret && header === secret) return null;
  if (req.headers.get("x-vercel-cron") === "1" && !secret) return null;
  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
}

function chainSelf(req: Request) {
  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
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

  // 성공 시에만 남은 큐를 즉시 이어 처리(self-chain). 실패-재큐는 cron 에 맡겨 backoff.
  const remaining = await getQueuedRecordedCount().catch(() => 0);
  if (result === "success" && remaining > 0) chainSelf(req);

  return Response.json({ ok: true, stuckRecovered, processed: 1, result, remaining });
}

// GET 도 허용 — 모니터링 / cron 호환.
export async function GET(req: Request) {
  return POST(req);
}

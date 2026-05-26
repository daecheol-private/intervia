import { randomBytes } from "node:crypto";
import {
  atomicClaimNext,
  cleanupStuck,
  markDone,
  markFailedOrRetry,
  MAX_ATTEMPTS,
} from "@/lib/screening-queue";
import {
  runScreeningOnce,
  markScreeningPermanentlyFailed,
  ScreeningError,
} from "@/lib/screening";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
// 최대 실행 시간 (Vercel Pro = 300s). Hobby 는 60s.
export const maxDuration = 60;

const DEFAULT_CONCURRENCY = Number(
  process.env.SCREENING_WORKER_CONCURRENCY ?? 8
);
// 한 번의 워커 실행에서 최대 처리량. 초과 시 self-chain 으로 다음 워커 호출.
const MAX_JOBS_PER_RUN = Number(process.env.SCREENING_WORKER_MAX_JOBS ?? 40);

/**
 * 큐 워커. 동시성 N, 최대 M 건 처리 후 종료.
 * 종료 시점에 큐에 남아 있으면 자신을 다시 호출 (self-chain).
 *
 * 인증:
 *  - 내부 호출: X-Internal-Secret = INTERNAL_API_SECRET 또는 X-Vercel-Cron=1
 *  - 수동 호출: 로그인된 system_admin
 */
async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.INTERNAL_API_SECRET;
  const header = req.headers.get("x-internal-secret");
  if (secret && header === secret) return null;
  if (req.headers.get("x-vercel-cron") === "1") return null;
  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
}

type RunStats = {
  processed: number;
  succeeded: number;
  failed_transient: number;
  failed_permanent: number;
  stuck_recovered: number;
  remaining: number;
  chained: boolean;
};

async function processOne(workerId: string): Promise<
  | "no_job"
  | "success"
  | { error: "transient" | "permanent"; permanent: boolean }
> {
  const claim = await atomicClaimNext(workerId);
  if (!claim) return "no_job";
  try {
    await runScreeningOnce(claim.candidateId);
    await markDone(claim.jobId);
    return "success";
  } catch (e) {
    const err =
      e instanceof ScreeningError
        ? e
        : new ScreeningError(e instanceof Error ? e.message : String(e), true);
    // 영구 오류면 attempts 무관 즉시 final fail
    const isPermanent = !err.transient;
    if (isPermanent) {
      await markFailedOrRetry(claim.jobId, err.message, MAX_ATTEMPTS); // 즉시 영구 처리
      await markScreeningPermanentlyFailed(claim.candidateId, err.message);
      return { error: "permanent", permanent: true };
    }
    const r = await markFailedOrRetry(claim.jobId, err.message, claim.attempts);
    if (r.permanent) {
      await markScreeningPermanentlyFailed(claim.candidateId, err.message);
    }
    return { error: "transient", permanent: r.permanent };
  }
}

async function chainSelf(req: Request) {
  // self-chain: 응답 본문 안 기다리고 fire-and-forget. INTERNAL_API_SECRET 동행.
  const base =
    process.env.APP_BASE_URL ?? new URL(req.url).origin;
  const url = `${base}/api/internal/process-screenings`;
  void fetch(url, {
    method: "POST",
    headers: {
      "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "",
    },
  }).catch((e) => console.error("chainSelf failed", e));
}

export async function POST(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  const workerId = "w_" + randomBytes(4).toString("hex");
  const stats: RunStats = {
    processed: 0,
    succeeded: 0,
    failed_transient: 0,
    failed_permanent: 0,
    stuck_recovered: 0,
    remaining: 0,
    chained: false,
  };

  stats.stuck_recovered = await cleanupStuck();

  while (stats.processed < MAX_JOBS_PER_RUN) {
    // 동시성 N — 한 번에 N 개 점유 시도, 모두 no_job 이면 종료
    const batch = await Promise.all(
      Array.from({ length: DEFAULT_CONCURRENCY }, () => processOne(workerId))
    );
    const anyClaimed = batch.some((r) => r !== "no_job");
    if (!anyClaimed) break;
    for (const r of batch) {
      if (r === "no_job") continue;
      stats.processed++;
      if (r === "success") stats.succeeded++;
      else if (r.permanent) stats.failed_permanent++;
      else stats.failed_transient++;
    }
  }

  // 남은 queued 있으면 self-chain
  const { getQueueStats } = await import("@/lib/screening-queue");
  const q = await getQueueStats();
  stats.remaining = q.queued;
  if (q.queued > 0) {
    stats.chained = true;
    chainSelf(req);
  }

  return Response.json({ ok: true, workerId, ...stats });
}

// GET 도 허용 — 모니터링 / Vercel Cron 호환
export async function GET(req: Request) {
  return POST(req);
}

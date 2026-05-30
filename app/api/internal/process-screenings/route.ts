import { randomBytes } from "node:crypto";
import {
  atomicClaimNext,
  cleanupStuck,
  reconcileBalanceHolds,
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
// 최대 실행 시간. Vercel Pro = 300s (Hobby 는 60s 가 상한).
// 길수록 한 함수 인스턴스가 살아있는 동안 더 많은 LLM in-flight(동시성 16)를
// 끝까지 처리 → self-chain 재호출 오버헤드 감소, 슬롯이 16 에 더 가깝게 참.
export const maxDuration = 300;

// 동시성 = LLM in-flight 슬롯 수. LLM 호출은 논블로킹 I/O(응답 대기 ~35s 동안 CPU
// 미점유)라 CPU 코어 수와 무관하게 올릴 수 있다. 병목은 코어가 아니라 "동시 대기 수".
// 파싱(CPU)은 건당 ~2s 로 짧아 동시 16 에서도 평균 ~1건만 겹쳐 2코어로 충분.
// (429 미발생 = Vertex 쿼터 여유 확인됨. env 로 상향 조정 가능.)
const DEFAULT_CONCURRENCY = Number(
  process.env.SCREENING_WORKER_CONCURRENCY ?? 16
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
  // 전역 동시성 = DEFAULT_CONCURRENCY. atomicClaimNext 가 법인별로 슬롯을 공정 분배.
  const claim = await atomicClaimNext(workerId, DEFAULT_CONCURRENCY);
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
  // 잔액 0 이하 법인 잡은 paused 로 분리(타 법인 영향 차단), 충전된 법인은 queued 로 재개.
  await reconcileBalanceHolds();

  // 롤링 워커 풀 — N 개의 워커가 각자 끝나는 즉시 다음 잡을 가져간다.
  // (이전: Promise.all 로 N 개를 띄우고 N 개가 *모두* 끝나야 다음 N 개를 점유 →
  //  배치 내 최장 1건이 나머지 슬롯을 놀리며 다음 배치를 막음. 사용자 체감 "3개씩 멈춤".)
  // 각 워커는 no_job(더 가져올 잡 없음)을 만나면 종료. atomicClaimNext 가 전역·법인별
  // cap 을 지키므로, 슬롯을 막 비운 워커가 곧바로 다음 잡을 채워 항상 N 개가 돈다.
  async function workerLoop() {
    while (stats.processed < MAX_JOBS_PER_RUN) {
      const r = await processOne(workerId);
      if (r === "no_job") return;
      stats.processed++;
      if (r === "success") stats.succeeded++;
      else if (r.permanent) stats.failed_permanent++;
      else stats.failed_transient++;
    }
  }
  await Promise.all(
    Array.from({ length: DEFAULT_CONCURRENCY }, () => workerLoop())
  );

  // 남은 queued 있으면 self-chain.
  // 단, 이번 실행이 한 건도 처리 못했으면(전역 슬롯 만석 등) 체인 안 함 —
  // 슬롯을 점유 중인 다른 실행이 끝나며 체인하고, cron 이 안전망. (즉시 재호출 busy-spin 방지)
  const { getQueueStats } = await import("@/lib/screening-queue");
  const q = await getQueueStats();
  stats.remaining = q.queued;
  if (q.queued > 0 && stats.processed > 0) {
    stats.chained = true;
    chainSelf(req);
  }

  return Response.json({ ok: true, workerId, ...stats });
}

// GET 도 허용 — 모니터링 / Vercel Cron 호환
export async function GET(req: Request) {
  return POST(req);
}

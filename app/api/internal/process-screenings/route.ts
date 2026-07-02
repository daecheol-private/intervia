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
  chargeScreeningSuccess,
  ScreeningError,
} from "@/lib/screening";
import { getCurrentUser } from "@/lib/auth";
import { captureError } from "@/lib/error-reporter";
import { isTransientDbError } from "@/lib/db-retry";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
// 최대 실행 시간 120s. 제약: LOCK_STALE_SECONDS(300) 보다 작아야 정상 워커가
// stuck 으로 오인되지 않음. 동시에 MAX_JOBS_PER_RUN 1라운드(~50s)보다 충분히 커야
// self-chain 코드(함수 끝)에 도달함 — 여기 도달 못 하면 체인이 끊겨 큐가 멈춘다.
// (300 으로 올렸다가 LOCK_STALE 와 충돌 + 대량 in-flight 락으로 큐가 정지했었음.)
export const maxDuration = 120;

// 동시성 = LLM in-flight 슬롯 수. LLM 호출은 논블로킹 I/O(응답 대기 ~35s 동안 CPU
// 미점유)라 CPU 코어 수와 무관하게 올릴 수 있다. 병목은 코어가 아니라 "동시 대기 수".
// 파싱(CPU)은 건당 ~2s 로 짧아 동시 16 에서도 평균 ~1건만 겹쳐 2코어로 충분.
// (429 미발생 = Vertex 쿼터 여유 확인됨. env 로 상향 조정 가능.)
const DEFAULT_CONCURRENCY = Number(
  process.env.SCREENING_WORKER_CONCURRENCY ?? 16
);
// 한 실행의 처리량 = 동시성(기본 1라운드). 이래야 한 번의 실행이 maxDuration 안에
// 끝나 self-chain 이 확실히 발동 → 다음 워커로 연속 이어짐. 과거 40 은 동시성 대비
// 너무 커서(3라운드 ~150s) 함수가 self-chain 전에 죽고 cleanupStuck(5분)에만
// 의존 → "5분씩 멈췄다 찔끔" 정체의 근본 원인이었음.
// ⚠️ env SCREENING_WORKER_MAX_JOBS 가 설정돼 있으면 이 기본값을 덮어쓴다 —
//    동시성과 어긋난 값(예: 40)이 박혀 있으면 삭제할 것.
const MAX_JOBS_PER_RUN = Number(
  process.env.SCREENING_WORKER_MAX_JOBS ?? DEFAULT_CONCURRENCY
);

// 벽시계 가드 — maxDuration(120s) 안에 함수 끝의 self-chain 코드까지 반드시 도달하도록,
// 이 시간이 지나면 새 잡을 더 claim 하지 않고 정상 종료한다. (1건 ~35-40s 이므로 70s 에
// 멈춰도 진행 중 1건이 끝나면 ~110s — self-chain 여유 확보.)
//
// 왜 필요한가: MAX_JOBS_PER_RUN 이 동시성보다 크게 설정돼 있으면(예: env 의
// SCREENING_WORKER_MAX_JOBS=100) 16동시성으로 100건 = ~220s > 120s → 함수가
// self-chain 전에 죽고 큐가 cron(매분)·cleanupStuck(5분)까지 정체된다.
// 시간 가드가 있으면 env 값과 무관하게 항상 self-chain 으로 끊김 없이 이어진다.
const WALL_CLOCK_BUDGET_MS = 70_000;

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
  // internal 은 cron(X-Internal-Secret)·self-chain 만 호출. 시크릿 설정 시 헤더 위조 우회 차단.
  if (req.headers.get("x-vercel-cron") === "1" && !secret) return null;
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
  // claim 은 아래 try 블록 밖이라, Turso 일시적 5xx 가 여기서 터지면 워커 라운드 전체가
  // 죽고 Sentry 로 샌다. 일시적이면 no_job 으로 처리(자가복구) — 다음 cron/self-chain 재시도.
  let claim: Awaited<ReturnType<typeof atomicClaimNext>> = null;
  try {
    claim = await atomicClaimNext(workerId, DEFAULT_CONCURRENCY);
  } catch (e) {
    if (!isTransientDbError(e)) throw e;
    log.warn("worker.claim_transient_skip", {
      reason: e instanceof Error ? e.message : String(e),
    });
    return "no_job";
  }
  if (!claim) return "no_job";
  try {
    await runScreeningOnce(claim.candidateId);
    await markDone(claim.jobId);
    // 과금은 "성공" 시점에만 — 오류/재시도는 과금 안 됨. job 단위 멱등(재평가는 새 job).
    // 과금 실패는 평가 성공을 되돌리지 않는다(이미 done) — 격리해 로그만. 안 그러면
    // 아래 catch 가 done 인 job 을 재큐해 재평가 루프가 생긴다.
    try {
      await chargeScreeningSuccess(claim.jobId, claim.candidateId);
    } catch (chargeErr) {
      // 평가는 성공했는데 과금만 실패 — 매출 누락 신호라 모니터링에 올린다(평가는 롤백 안 함).
      captureError(chargeErr, {
        route: "internal/process-screenings",
        op: "chargeScreeningSuccess",
        jobId: claim.jobId,
        candidateId: claim.candidateId,
      });
    }
    return "success";
  } catch (e) {
    const err =
      e instanceof ScreeningError
        ? e
        : new ScreeningError(e instanceof Error ? e.message : String(e), true);
    // 영구 오류면 attempts 무관 즉시 final fail (과금 전이므로 환불 불필요).
    const isPermanent = !err.transient;
    if (isPermanent) {
      await markFailedOrRetry(claim.jobId, err.message, MAX_ATTEMPTS); // 즉시 영구 처리
      return { error: "permanent", permanent: true };
    }
    const r = await markFailedOrRetry(claim.jobId, err.message, claim.attempts);
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
  const startedAt = Date.now();
  const stats: RunStats = {
    processed: 0,
    succeeded: 0,
    failed_transient: 0,
    failed_permanent: 0,
    stuck_recovered: 0,
    remaining: 0,
    chained: false,
  };

  // 유지보수 단계(stuck 복구 + 잔액 reconcile)는 best-effort. 매분 cron 의 첫 DB 작업이라
  // Turso 일시적 5xx 블립이 여기서 터져 Sentry 를 도배하던 지점 — 함수 내부에서 짧게 재시도하고,
  // 그래도 일시적 실패면 이번 틱만 건너뛴다(다음 cron 이 복구). 비일시적 에러는 그대로 전파 → Sentry.
  try {
    stats.stuck_recovered = await cleanupStuck();
    // 잔액 0 이하 법인 잡은 paused 로 분리(타 법인 영향 차단), 충전된 법인은 queued 로 재개.
    await reconcileBalanceHolds();
  } catch (e) {
    if (!isTransientDbError(e)) throw e;
    log.warn("worker.maintenance_transient_skip", {
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  // 롤링 워커 풀 — N 개의 워커가 각자 끝나는 즉시 다음 잡을 가져간다.
  // (이전: Promise.all 로 N 개를 띄우고 N 개가 *모두* 끝나야 다음 N 개를 점유 →
  //  배치 내 최장 1건이 나머지 슬롯을 놀리며 다음 배치를 막음. 사용자 체감 "3개씩 멈춤".)
  // 각 워커는 no_job(더 가져올 잡 없음)을 만나면 종료. atomicClaimNext 가 전역·법인별
  // cap 을 지키므로, 슬롯을 막 비운 워커가 곧바로 다음 잡을 채워 항상 N 개가 돈다.
  async function workerLoop() {
    while (
      stats.processed < MAX_JOBS_PER_RUN &&
      Date.now() - startedAt < WALL_CLOCK_BUDGET_MS
    ) {
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
  // self-chain 판단용 큐 카운트. 본 작업(workerLoop)은 이미 끝났으므로, Turso 일시
  // 끊김으로 이 조회가 실패해도 워커를 throw 시키지 않는다 — 체인만 건너뛰고 다음
  // cron 이 남은 큐를 잇는다(안전망). getQueueStats 내부 재시도까지 뚫린 persistent
  // transient 만 여기 도달. 비-transient(진짜 버그)는 그대로 전파해 Sentry 가시성 유지.
  const { getQueueStats } = await import("@/lib/screening-queue");
  try {
    const q = await getQueueStats();
    stats.remaining = q.queued;
    if (q.queued > 0 && stats.processed > 0) {
      stats.chained = true;
      chainSelf(req);
    }
  } catch (e) {
    if (!isTransientDbError(e)) throw e;
    log.warn("process_screenings.queue_stats_skip", {
      workerId,
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  return Response.json({ ok: true, workerId, ...stats });
}

// GET 도 허용 — 모니터링 / Vercel Cron 호환
export async function GET(req: Request) {
  return POST(req);
}

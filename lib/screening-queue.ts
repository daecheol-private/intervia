/**
 * 서류 평가 큐 (DB 기반).
 *
 * Vercel 서버리스 fire-and-forget 의 한계 + Gemini RPM 제한 + 대량 업로드 (100+) 시
 * 동시 LLM 호출 폭주를 막기 위한 백프레셔.
 *
 * 흐름:
 *  1) enqueue() — candidate 마다 screening_jobs row 생성
 *  2) atomicClaimNext() — 워커가 status=queued AND not_before<=now 중 가장 오래된 1건 점유
 *  3) markDone() / markFailedOrRetry() — 결과 기록 + 백오프
 *  4) cleanupStuck() — 5분 이상 lock 잡힌 채 멈춘 job 복구 (worker 비정상 종료 대응)
 */
import { db } from "./db";
import { screeningJobs, candidates, tokenWallets } from "./schema";
import { eq, and, sql, isNull, or, lte, inArray, lt, gt, gte } from "drizzle-orm";
import { withDbRetry } from "./db-retry";

export const MAX_ATTEMPTS = 3;
// 백오프: 1차 30s, 2차 2min, 3차 5min
const BACKOFF_SECONDS = [30, 120, 300];
const LOCK_STALE_SECONDS = 300;

export type EnqueueResult = {
  candidateId: number;
  jobId?: number;
  status: "enqueued" | "already_queued" | "already_processed";
};

/** 신규 평가 작업 enqueue. 이미 queued/processing/paused 인 후보자는 중복 enqueue 안 함. */
export async function enqueueScreening(
  candidateId: number,
  enqueuedByUserId: number | null
): Promise<EnqueueResult> {
  const activeFilter = and(
    eq(screeningJobs.candidateId, candidateId),
    inArray(screeningJobs.status, ["queued", "processing", "paused"])
  );
  // 활성 job 이 이미 있나? (paused 는 충전 시 재개되므로 중복 생성 금지)
  const [existing] = await db
    .select({ id: screeningJobs.id, status: screeningJobs.status })
    .from(screeningJobs)
    .where(activeFilter);
  if (existing) {
    return { candidateId, jobId: existing.id, status: "already_queued" };
  }
  // H5 — 위 SELECT-then-INSERT 는 동시 enqueue 시 둘 다 통과해 활성 job 2개(→이중 평가·이중
  //      과금)를 만들 수 있다. 부분 유니크 인덱스(screening_jobs_active_candidate_uq) +
  //      onConflictDoNothing 으로 두 번째 INSERT 를 무시(0 rows)해 DB 레벨에서 차단한다.
  const inserted = await db
    .insert(screeningJobs)
    .values({
      candidateId,
      enqueuedByUserId: enqueuedByUserId ?? undefined,
    })
    .onConflictDoNothing()
    .returning({ id: screeningJobs.id });
  if (inserted.length === 0) {
    // race 패배 — 동시 요청이 먼저 활성 job 을 만듦. 기존 활성 job 을 조회해 반환.
    const [now] = await db
      .select({ id: screeningJobs.id })
      .from(screeningJobs)
      .where(activeFilter);
    return { candidateId, jobId: now?.id, status: "already_queued" };
  }
  return { candidateId, jobId: inserted[0].id, status: "enqueued" };
}

/**
 * 큐에서 다음 job 1건 점유 (atomic) — **법인별 공정 분배** 적용.
 *
 * 동시에 여러 법인이 업로드하면 한 법인의 대량 업로드가 다른 법인을 굶기지 않도록,
 * 슬롯(maxConcurrency)을 "현재 활성 법인 수" 로 나눠 분배한다.
 *   활성 법인 = 지금 claim 가능한 queued 또는 processing job 을 가진 distinct org.
 *   perOrgCap = ceil(maxConcurrency / 활성법인수)
 *   예) max=8 →  1법인:8 · 2법인:4·4 · 3법인:3·3·2 (전역 cap 8 이 합을 8 로 제한).
 *   한 법인이 끝나 활성 수가 줄면 다음 claim 부터 cap 이 다시 커진다(동적).
 *
 * 동시성 안전:
 *   - SQLite/libsql 단일 writer → 조건부 UPDATE 가 직렬화됨.
 *   - claim UPDATE 의 WHERE 에 [전역 in-flight < max] + [법인 in-flight < cap] 서브쿼리를
 *     박아, 동시 claim 들도 cap 을 정확히 지킨다. (스냅샷은 선택 최적화용일 뿐, 정합성 보장은 UPDATE)
 *   - M2: 소속 법인 잔액 0 이하면 일시정지(스킵). 충전 후 자연 재개.
 *
 * @param maxConcurrency 전역 동시 처리 슬롯 수 (워커 동시성과 동일).
 */
export async function atomicClaimNext(
  workerId: string,
  maxConcurrency = 8
): Promise<{
  jobId: number;
  candidateId: number;
  attempts: number;
} | null> {
  const now = new Date().toISOString();
  const orgExpr = sql<number>`COALESCE(${candidates.orgId}, 0)`;

  // --- 스냅샷: 법인별 처리중 수 + 전역 처리중 수 ---
  const procRows = await db
    .select({ org: orgExpr, c: sql<number>`COUNT(*)` })
    .from(screeningJobs)
    .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
    .where(eq(screeningJobs.status, "processing"))
    .groupBy(orgExpr);
  const globalInFlight = procRows.reduce((s, r) => s + Number(r.c), 0);
  if (globalInFlight >= maxConcurrency) return null; // 전역 슬롯 만석

  // --- 활성 법인 수 (claim 가능 queued 또는 processing 보유 org) ---
  const activeRows = await db
    .select({ org: orgExpr })
    .from(screeningJobs)
    .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
    .leftJoin(tokenWallets, eq(tokenWallets.orgId, candidates.orgId))
    .where(
      or(
        eq(screeningJobs.status, "processing"),
        and(
          eq(screeningJobs.status, "queued"),
          or(isNull(screeningJobs.notBefore), lte(screeningJobs.notBefore, now)),
          or(
            isNull(candidates.orgId),
            isNull(tokenWallets.balance),
            gte(tokenWallets.balance, 1)
          )
        )
      )
    )
    .groupBy(orgExpr);
  const activeOrgs = Math.max(1, activeRows.length);
  const perOrgCap = Math.max(1, Math.ceil(maxConcurrency / activeOrgs));

  // 이미 cap 이상 처리중인 법인은 이번 claim 에서 제외 (head-of-line 방지 + 선형스캔 회피).
  const skip = new Set<number>(
    procRows.filter((r) => Number(r.c) >= perOrgCap).map((r) => Number(r.org))
  );

  // race-loss 시 그 다음 id 로, cap 도달 법인은 skip 에 넣어 건너뛴다.
  let afterId = 0;
  for (let i = 0; i < activeOrgs + 50; i++) {
    const conds = [
      eq(screeningJobs.status, "queued"),
      or(isNull(screeningJobs.notBefore), lte(screeningJobs.notBefore, now)),
      gt(screeningJobs.id, afterId),
      or(
        isNull(candidates.orgId),
        isNull(tokenWallets.balance),
        gte(tokenWallets.balance, 1)
      ),
    ];
    if (skip.size > 0) {
      conds.push(
        sql`COALESCE(${candidates.orgId}, 0) NOT IN (${sql.join(
          [...skip].map((o) => sql`${o}`),
          sql`, `
        )})`
      );
    }
    const [cand] = await db
      .select({ id: screeningJobs.id, org: orgExpr })
      .from(screeningJobs)
      .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
      .leftJoin(tokenWallets, eq(tokenWallets.orgId, candidates.orgId))
      .where(and(...conds))
      .orderBy(screeningJobs.id)
      .limit(1);
    if (!cand) return null;

    // 원자적 claim — UPDATE 시점에 전역·법인 cap 재확인 (동시 claim 정합성 보장).
    const updated = await db
      .update(screeningJobs)
      .set({
        status: "processing",
        lockedAt: now,
        lockedBy: workerId,
        startedAt: now,
        attempts: sql`${screeningJobs.attempts} + 1`,
      })
      .where(
        and(
          eq(screeningJobs.id, cand.id),
          eq(screeningJobs.status, "queued"),
          sql`(SELECT COUNT(*) FROM screening_jobs WHERE status = 'processing') < ${maxConcurrency}`,
          sql`(SELECT COUNT(*) FROM screening_jobs sj JOIN candidates c ON c.id = sj.candidate_id WHERE sj.status = 'processing' AND COALESCE(c.org_id, 0) = ${cand.org}) < ${perOrgCap}`
        )
      )
      .returning({
        id: screeningJobs.id,
        candidateId: screeningJobs.candidateId,
        attempts: screeningJobs.attempts,
      });
    if (updated.length > 0) {
      const row = updated[0];
      return {
        jobId: row.id,
        candidateId: row.candidateId,
        attempts: row.attempts,
      };
    }
    // claim 실패 — race(다른 워커가 가져감) vs cap(서브쿼리 차단) 구분.
    //   여전히 queued → cap 으로 막힌 것 → 이 법인 제외(skip)하고 다음 법인.
    //   아니면 → race → 다음 id 로 진행 (같은 법인 OK).
    const [still] = await db
      .select({ s: screeningJobs.status })
      .from(screeningJobs)
      .where(eq(screeningJobs.id, cand.id))
      .limit(1);
    if (still?.s === "queued") skip.add(Number(cand.org));
    else afterId = cand.id;
  }
  return null;
}

export async function markDone(jobId: number): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(screeningJobs)
    .set({
      status: "done",
      lockedAt: null,
      lockedBy: null,
      completedAt: now,
    })
    .where(eq(screeningJobs.id, jobId));
}

/**
 * 실패 처리. attempts < MAX 면 backoff 후 재큐, 도달하면 final fail.
 * @returns true = 영구 실패, false = 재시도 대기
 */
export async function markFailedOrRetry(
  jobId: number,
  error: string,
  currentAttempts: number
): Promise<{ permanent: boolean }> {
  const now = new Date();
  if (currentAttempts >= MAX_ATTEMPTS) {
    await db
      .update(screeningJobs)
      .set({
        status: "failed",
        lockedAt: null,
        lockedBy: null,
        completedAt: now.toISOString(),
        lastError: error.slice(0, 1000),
      })
      .where(eq(screeningJobs.id, jobId));
    return { permanent: true };
  }
  const backoffSec =
    BACKOFF_SECONDS[Math.min(currentAttempts - 1, BACKOFF_SECONDS.length - 1)];
  const notBefore = new Date(now.getTime() + backoffSec * 1000).toISOString();
  await db
    .update(screeningJobs)
    .set({
      status: "queued",
      lockedAt: null,
      lockedBy: null,
      notBefore,
      lastError: error.slice(0, 1000),
    })
    .where(eq(screeningJobs.id, jobId));
  return { permanent: false };
}

/**
 * 잔액 기반 일시정지 reconcile — 워커 실행마다 1회 (cleanupStuck 직후).
 *
 * - 잔액 0 이하 법인의 queued 잡 → paused (활성 큐에서 분리 → 타 법인 영향 차단).
 * - 잔액 0 초과 법인의 paused 잡 → queued (충전 후 자동 재개).
 *
 * cron 이 매분 워커를 깨우므로 충전 후 ~1분 내 자동 복원. (즉시성 필요 시 충전 라우트에서
 * 별도 triggerWorker 가능하나, 여기 reconcile 가 단일 진실원천.)
 *
 * @returns { paused, resumed } 전환 건수
 */
export async function reconcileBalanceHolds(): Promise<{
  paused: number;
  resumed: number;
}> {
  // cleanupStuck 직후 매 틱 실행 — 동일하게 멱등(잔액 기준 상태 전이)이라 transient 재시도.
  return withDbRetry(async () => {
    // 소속 법인 잔액 <= 0 → paused. (지갑 없으면 잔액 무제한으로 간주, 건드리지 않음)
    const pausedRows = await db
      .update(screeningJobs)
      .set({ status: "paused", lockedAt: null, lockedBy: null })
      .where(
        and(
          eq(screeningJobs.status, "queued"),
          sql`(SELECT w.balance FROM candidates c JOIN token_wallets w ON w.org_id = c.org_id WHERE c.id = ${screeningJobs.candidateId}) <= 0`
        )
      )
      .returning({ id: screeningJobs.id });

    // 잔액 > 0 으로 회복된 법인의 paused → queued (재개).
    const resumedRows = await db
      .update(screeningJobs)
      .set({ status: "queued", notBefore: null })
      .where(
        and(
          eq(screeningJobs.status, "paused"),
          sql`(SELECT w.balance FROM candidates c JOIN token_wallets w ON w.org_id = c.org_id WHERE c.id = ${screeningJobs.candidateId}) > 0`
        )
      )
      .returning({ id: screeningJobs.id });

    return { paused: pausedRows.length, resumed: resumedRows.length };
  }, { label: "reconcileBalanceHolds" });
}

/**
 * 멈춘 processing job 을 queued 로 복구 (워커 죽음 케이스). cron 이 매분 호출.
 *
 * 두 종류를 모두 잡는다:
 *   1) lockedAt 이 5분 이상 과거 — 정상 claim 됐으나 워커가 처리 중 죽음
 *   2) lockedAt 이 NULL — claim 직후/타임아웃 등으로 락 타임스탬프가 누락된 좀비.
 *      `lt(lockedAt, staleAt)` 는 NULL 을 못 잡으므로 (SQL: NULL < x = false)
 *      isNull 조건을 OR 로 추가해야 영구 정체를 방지한다.
 *      (정상 워커는 claim 시 항상 lockedAt 을 기록하므로, NULL processing 은
 *       비정상 상태 → 복구해도 정상 작업을 건드릴 위험 없음.)
 */
export async function cleanupStuck(): Promise<number> {
  // 매분 cron 워커의 첫 DB 작업 — Turso 일시적 5xx 가 가장 자주 터지던 지점. 조건부 상태
  // 전이라 멱등(재실행해도 같은 결과)이므로 withDbRetry 로 짧게 재시도. 그래도 실패하면
  // 호출부(워커)가 best-effort 로 이번 틱을 건너뛴다(다음 cron 복구).
  return withDbRetry(async () => {
    const staleAt = new Date(
      Date.now() - LOCK_STALE_SECONDS * 1000
    ).toISOString();
    const stuckCond = and(
      eq(screeningJobs.status, "processing"),
      or(lt(screeningJobs.lockedAt, staleAt), isNull(screeningJobs.lockedAt))
    );
    // H6 — 재시도 상한(MAX_ATTEMPTS)을 이미 넘긴 stuck job 은 queued 로 되돌리면
    //      claim→죽음→재큐 무한 루프(매 라운드 파싱/LLM 토큰 재소비)에 빠진다.
    //      기존 cleanupStuck 은 attempts 를 무시하고 무조건 재큐했음 → 상한 초과분은 즉시 final fail.
    const failed = await db
      .update(screeningJobs)
      .set({
        status: "failed",
        lockedAt: null,
        lockedBy: null,
        lastError: "stuck: 재시도 상한 초과 (worker 반복 비정상 종료)",
        completedAt: new Date().toISOString(),
      })
      .where(and(stuckCond, gte(screeningJobs.attempts, MAX_ATTEMPTS)))
      .returning({ id: screeningJobs.id });
    // 상한 이내 stuck 은 정상 복구(queued).
    const requeued = await db
      .update(screeningJobs)
      .set({
        status: "queued",
        lockedAt: null,
        lockedBy: null,
      })
      .where(and(stuckCond, lt(screeningJobs.attempts, MAX_ATTEMPTS)))
      .returning({ id: screeningJobs.id });
    return failed.length + requeued.length;
  }, { label: "cleanupStuck" });
}

/** 큐 통계 — UI/모니터링용. */
export async function getQueueStats(orgId?: number | null): Promise<{
  queued: number;
  processing: number;
  failed: number;
}> {
  const rows = orgId
    ? await db
        .select({
          status: screeningJobs.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(screeningJobs)
        .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
        .where(eq(candidates.orgId, orgId))
        .groupBy(screeningJobs.status)
    : await db
        .select({
          status: screeningJobs.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(screeningJobs)
        .groupBy(screeningJobs.status);
  const out = { queued: 0, processing: 0, failed: 0 };
  for (const r of rows) {
    if (r.status === "queued") out.queued = Number(r.count);
    else if (r.status === "processing") out.processing = Number(r.count);
    else if (r.status === "failed") out.failed = Number(r.count);
  }
  return out;
}

/** 특정 후보자의 활성 job 정보 (UI 진행상황 표시용). */
export async function getActiveJobForCandidate(candidateId: number) {
  const [row] = await db
    .select()
    .from(screeningJobs)
    .where(
      and(
        eq(screeningJobs.candidateId, candidateId),
        inArray(screeningJobs.status, ["queued", "processing"])
      )
    )
    .orderBy(sql`${screeningJobs.id} DESC`)
    .limit(1);
  return row ?? null;
}

/** 큐에서 해당 job 앞쪽에 있는 queued 갯수 (대기 위치).
 *  M6 — 같은 채용공고(jobs.id) 안에서만 카운트. 타법인·타공고 큐 길이로 인해
 *  "당신은 N번 대기" 표시가 부풀려지던 문제 차단. 후보자가 본인 공고 내 순번만 본다. */
export async function getQueuePosition(jobId: number): Promise<number> {
  // 대상 job 의 candidate → job_posting id 를 먼저 조회
  const [target] = await db
    .select({ jobPostingId: candidates.jobId })
    .from(screeningJobs)
    .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
    .where(eq(screeningJobs.id, jobId))
    .limit(1);
  if (!target) return 0;
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(screeningJobs)
    .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
    .where(
      and(
        eq(screeningJobs.status, "queued"),
        lt(screeningJobs.id, jobId),
        eq(candidates.jobId, target.jobPostingId)
      )
    );
  return Number(row?.count ?? 0);
}

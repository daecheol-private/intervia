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

export const MAX_ATTEMPTS = 3;
// 백오프: 1차 30s, 2차 2min, 3차 5min
const BACKOFF_SECONDS = [30, 120, 300];
const LOCK_STALE_SECONDS = 300;

export type EnqueueResult = {
  candidateId: number;
  jobId?: number;
  status: "enqueued" | "already_queued" | "already_processed";
};

/** 신규 평가 작업 enqueue. 이미 queued/processing 인 후보자는 중복 enqueue 안 함. */
export async function enqueueScreening(
  candidateId: number,
  enqueuedByUserId: number | null
): Promise<EnqueueResult> {
  // 활성 job 이 이미 있나? (queued/processing)
  const [existing] = await db
    .select({ id: screeningJobs.id, status: screeningJobs.status })
    .from(screeningJobs)
    .where(
      and(
        eq(screeningJobs.candidateId, candidateId),
        inArray(screeningJobs.status, ["queued", "processing"])
      )
    );
  if (existing) {
    return { candidateId, jobId: existing.id, status: "already_queued" };
  }
  const [job] = await db
    .insert(screeningJobs)
    .values({
      candidateId,
      enqueuedByUserId: enqueuedByUserId ?? undefined,
    })
    .returning({ id: screeningJobs.id });
  return { candidateId, jobId: job.id, status: "enqueued" };
}

/**
 * 큐에서 다음 job 1건 점유 (atomic).
 * SQLite 는 SELECT FOR UPDATE 없음 — 조건부 UPDATE ... RETURNING 으로 대체.
 * 동시 워커가 같은 row 를 잡지 못함.
 */
export async function atomicClaimNext(workerId: string): Promise<{
  jobId: number;
  candidateId: number;
  attempts: number;
} | null> {
  const now = new Date().toISOString();
  // race-loss 시 그 다음 id 로 진행. 같은 호출에서 최대 20회 시도.
  // M2 — 후보자 소속 법인의 잔액이 0 이하면 워커가 일시정지 (해당 job 스킵).
  // 충전 후 자연스럽게 재개. candidates JOIN + LEFT JOIN tokenWallets 로 검사.
  let afterId = 0;
  for (let i = 0; i < 20; i++) {
    const [candidate] = await db
      .select({ id: screeningJobs.id })
      .from(screeningJobs)
      .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
      .leftJoin(tokenWallets, eq(tokenWallets.orgId, candidates.orgId))
      .where(
        and(
          eq(screeningJobs.status, "queued"),
          or(isNull(screeningJobs.notBefore), lte(screeningJobs.notBefore, now)),
          gt(screeningJobs.id, afterId),
          // orgId 미설정(legacy) 또는 잔액 > 0 만 처리. 음수면 일시정지.
          or(
            isNull(candidates.orgId),
            isNull(tokenWallets.balance),
            gte(tokenWallets.balance, 1)
          )
        )
      )
      .orderBy(screeningJobs.id)
      .limit(1);
    if (!candidate) return null;
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
          eq(screeningJobs.id, candidate.id),
          eq(screeningJobs.status, "queued")
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
    // 동시에 다른 워커가 채감 — 그 다음 id 로 진행
    afterId = candidate.id;
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

/** 5분 이상 잠긴 채 멈춘 processing job 들을 queued 로 복구 (워커 죽음 케이스). */
export async function cleanupStuck(): Promise<number> {
  const staleAt = new Date(Date.now() - LOCK_STALE_SECONDS * 1000).toISOString();
  const r = await db
    .update(screeningJobs)
    .set({
      status: "queued",
      lockedAt: null,
      lockedBy: null,
    })
    .where(
      and(
        eq(screeningJobs.status, "processing"),
        lt(screeningJobs.lockedAt, staleAt)
      )
    )
    .returning({ id: screeningJobs.id });
  return r.length;
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

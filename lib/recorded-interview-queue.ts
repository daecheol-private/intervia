/**
 * 대면 면접 녹음(업로드 모드) 백그라운드 처리 큐.
 *
 * 업로드 라우트는 오디오를 임시 저장(Blob/로컬)하고 recorded_interviews 행만
 * status='queued' 로 만든 뒤 즉시 응답한다. 실제 무거운 작업(전사 → 평가)은 이 워커가
 * 백그라운드에서 수행하므로, 사용자는 업로드 후 페이지를 닫거나 새로고침해도 된다.
 * (서류 스크리닝 큐와 동일한 사상 — 다만 건수가 적어 공정분배 없이 단순화.)
 *
 * 큐 = recorded_interviews 행 자체 (별도 jobs 테이블 없음):
 *   - status='queued'      : 업로드 완료, 워커 대기
 *   - status='processing'  : 워커가 claim (startedAt = 락 타임스탬프)
 *   - status='ready'       : 리포트 완료 (finalize 가 설정)
 *   - status='failed'      : 영구 실패
 *   - attempts             : 재시도 횟수 (상한 MAX_RECORDED_ATTEMPTS)
 *
 * 멱등·중복 방지:
 *   - 전사는 세그먼트가 아직 없을 때만 (재시도가 세그먼트를 중복 생성하지 않게).
 *   - 자동 첫 평가는 finalize(charge:"once") → chargeFeature 멱등 (재시도 이중과금 방지).
 *   - LOCK_STALE_SECONDS > 워커 maxDuration 이라, 살아있는 실행을 stuck 으로 오인해
 *     다른 워커가 동시에 같은 건을 처리하는 일이 없다.
 */
import { and, asc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  interviewTranscriptSegments,
  jobPostings,
  recordedInterviews,
} from "./schema";
import {
  buildTranscriptionDomainHint,
  finalizeRecordedInterview,
  transcribeAudio,
} from "./recorded-interview";
import { deleteFile, readStoredFile } from "./storage";
import { withDbRetry } from "./db-retry";
import { workerBaseUrl } from "./worker-trigger";
import { captureError } from "./error-reporter";

// 전사·평가를 별도 함수 실행으로 분리(아래 processRecordedInterview). attempts 는 "한 단계의
// 연속 실패 예산"이다 — 전사가 성공해 평가 단계로 넘어갈 때 attempts 를 0 으로 리셋하므로
// (claimNextRecorded 는 claim 마다 +1 하지만) 정상 실행이 전사+평가로 카운터를 소진해 멀쩡한
// 면접이 상한에 닿아 '실패'로 오판되는 일이 없다(2026-07-07 사고: 3분짜리 라이브가 상한 도달).
// 각 시도는 하드 타임아웃으로 경계가 잡혀(강제종료 없이 깔끔히 실패) 상한이 커도 폭주하지 않는다.
export const MAX_RECORDED_ATTEMPTS = 5;
// 워커 maxDuration(300s) 보다 커야 — 전사+평가로 길어진 *살아있는* 실행을 stuck 으로
// 오인해 재큐하면, 두 워커가 같은 건을 동시에 처리(전사 중복·LLM 낭비)할 수 있다.
const LOCK_STALE_SECONDS = 360;
// 업로드 동기 버전과 동일한 전사 타임아웃.
const TRANSCRIBE_TIMEOUT_MS = 240_000;

/** 영구 실패(재업로드 필요 등)와 일시적 실패(재시도 가치 있음)를 구분하는 마커. */
export class RecordedInterviewError extends Error {
  permanent: boolean;
  constructor(message: string, permanent = false) {
    super(message);
    this.name = "RecordedInterviewError";
    this.permanent = permanent;
  }
}

/**
 * 큐에서 가장 오래된 queued 1건을 원자적으로 claim (status='processing').
 * 조건부 UPDATE 가 직렬화되므로 동시 워커가 같은 건을 가져가지 않는다(race 시 다음 건).
 */
export async function claimNextRecorded(): Promise<{
  id: number;
  attempts: number;
} | null> {
  for (let i = 0; i < 20; i++) {
    const [cand] = await db
      .select({ id: recordedInterviews.id })
      .from(recordedInterviews)
      .where(eq(recordedInterviews.status, "queued"))
      .orderBy(asc(recordedInterviews.id))
      .limit(1);
    if (!cand) return null;

    const now = new Date().toISOString();
    const updated = await db
      .update(recordedInterviews)
      .set({
        status: "processing",
        startedAt: now,
        attempts: sql`${recordedInterviews.attempts} + 1`,
        error: null,
      })
      .where(
        and(
          eq(recordedInterviews.id, cand.id),
          eq(recordedInterviews.status, "queued")
        )
      )
      .returning({
        id: recordedInterviews.id,
        attempts: recordedInterviews.attempts,
      });
    if (updated.length > 0)
      return { id: updated[0].id, attempts: updated[0].attempts };
    // race 패배 — 다른 워커가 가져감. 다음 건 시도.
  }
  return null;
}

/**
 * 멈춘 processing 행 복구 (워커 비정상 종료 대응). cron 이 매분 호출.
 * 상한 이내면 queued 로 복구, 상한 초과면 즉시 failed.
 */
export async function cleanupStuckRecorded(): Promise<number> {
  const staleAt = new Date(Date.now() - LOCK_STALE_SECONDS * 1000).toISOString();
  const stuckCond = and(
    eq(recordedInterviews.status, "processing"),
    or(
      lt(recordedInterviews.startedAt, staleAt),
      isNull(recordedInterviews.startedAt)
    )
  );

  const stuck = await withDbRetry(
    () =>
      db
        .select({
          id: recordedInterviews.id,
          attempts: recordedInterviews.attempts,
          audioBlobKey: recordedInterviews.audioBlobKey,
        })
        .from(recordedInterviews)
        .where(stuckCond),
    { label: "cleanupStuckRecorded.select" }
  );
  if (stuck.length === 0) return 0;

  // 상한 초과(영구실패)분의 고아 오디오는 즉시 폐기 (worker 가 죽어 markFailed 를 못 거친 경우).
  // 이 경로는 worker 가 강제종료(maxDuration/OOM)돼 catch·captureError 를 못 거친 stuck 실패라
  // 모니터링에 안 잡힌다 — 여기서 직접 Sentry 로 보고해 가시화한다.
  const overLimit = stuck.filter((r) => r.attempts >= MAX_RECORDED_ATTEMPTS);
  for (const r of overLimit) {
    if (r.audioBlobKey) await deleteFile(r.audioBlobKey).catch(() => {});
    captureError(
      new Error(
        `recorded_interview ${r.id} stuck 영구실패 (attempts=${r.attempts}) — worker 반복 강제종료(maxDuration/OOM 추정)`
      ),
      { route: "cleanupStuckRecorded", recordedInterviewId: r.id, attempts: r.attempts }
    );
  }

  await withDbRetry(
    async () => {
      await db
        .update(recordedInterviews)
        .set({
          status: "failed",
          error: "stuck: 재시도 상한 초과 (worker 반복 비정상 종료)",
          audioBlobKey: null,
          completedAt: new Date().toISOString(),
        })
        .where(
          and(stuckCond, gte(recordedInterviews.attempts, MAX_RECORDED_ATTEMPTS))
        );
      await db
        .update(recordedInterviews)
        .set({ status: "queued" })
        .where(
          and(stuckCond, lt(recordedInterviews.attempts, MAX_RECORDED_ATTEMPTS))
        );
    },
    { label: "cleanupStuckRecorded.update" }
  );
  return stuck.length;
}

/**
 * 한 건을 **한 단계만** 진행한다 — 전사와 평가를 별도 함수 실행으로 분리.
 *
 *  - 세그먼트 없음 → 1단계(전사): 전사 → 세그먼트 저장 → 오디오 폐기 → status='queued' 로 되돌림.
 *    (finalize 는 하지 않고 리턴 — 워커가 self-chain/cron 으로 이 행을 다시 claim 해 2단계 수행.)
 *  - 세그먼트 있음 → 2단계(평가): 역할 배정 → 평가 → 리포트 저장 → 멱등 후차감(once).
 *
 * 왜 분리하나: 전사(≤240s)와 평가(LLM 2회)를 한 함수 실행(maxDuration 300s)에 욱여넣으면
 * 긴 녹취는 평가 도중 함수가 강제종료돼 catch 를 못 거치고 'processing' 에 멈춘다
 * → cleanupStuck 이 "stuck: 재시도 상한 초과" 로 영구실패시킨다(2026-06-20 실제 사고).
 * 단계를 나누면 평가가 온전한 maxDuration 예산을 받는다. 세그먼트 존재가 멱등 가드라
 * 재시도가 전사를 중복하지 않는다.
 *
 * 실패하면 throw (호출 워커가 재시도/영구실패 판정).
 */
export async function processRecordedInterview(riId: number): Promise<void> {
  const [ri] = await db
    .select()
    .from(recordedInterviews)
    .where(eq(recordedInterviews.id, riId));
  if (!ri) throw new RecordedInterviewError(`recorded_interview ${riId} 없음`, true);

  // ── 1단계: 전사 (오디오가 있을 때). 전사 성공 시 audioBlobKey=null 로 되므로 멱등하다.
  // 게이트를 '세그먼트 없음'이 아니라 '오디오 있음'으로 두는 이유: 라이브(A안)는 화면용
  // Web Speech 초안 세그먼트가 이미 있는 채로 오디오를 attach 하므로, 세그먼트 유무로 판단하면
  // 전사를 건너뛰고 저품질 초안으로 평가하게 된다. 오디오가 있으면 재전사해 초안을 교체한다.
  // (업로드 모드는 초안 세그먼트가 없어 삭제가 no-op — 동작 동일.)
  if (ri.audioBlobKey) {
    const buf = await readStoredFile(ri.audioBlobKey);
    if (!buf)
      throw new RecordedInterviewError(
        "저장된 오디오를 읽을 수 없습니다. 다시 업로드해 주세요.",
        true
      );

    const [job] = await db
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.id, ri.jobId));
    const segments = await transcribeAudio(
      buf.toString("base64"),
      ri.audioMime ?? "audio/webm",
      {
        timeoutMs: TRANSCRIBE_TIMEOUT_MS,
        domainHint: job ? buildTranscriptionDomainHint(job) : undefined,
      }
    );
    if (segments.length === 0)
      throw new RecordedInterviewError(
        "음성에서 인식된 발화가 없습니다. 녹음 상태를 확인해 주세요.",
        true
      );

    // 라이브 실측 길이가 있으면 유지, 없으면 전사 endMs 로 산출.
    const durationSeconds =
      ri.durationSeconds && ri.durationSeconds > 0
        ? ri.durationSeconds
        : Math.round((segments[segments.length - 1]?.endMs ?? 0) / 1000);
    // 재전사는 기존 초안 세그먼트를 **교체**한다(라이브 초안 삭제 후 재삽입). transcribeAudio 가
    // 성공한 뒤에만 삭제하므로, 전사가 throw 하면 초안이 보존돼 폴백(수동 재평가) 여지가 남는다.
    await db
      .delete(interviewTranscriptSegments)
      .where(eq(interviewTranscriptSegments.recordedInterviewId, riId));
    await db.insert(interviewTranscriptSegments).values(
      segments.map((s, i) => ({
        recordedInterviewId: riId,
        seq: i + 1,
        speakerLabel: s.speakerLabel,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        lowConfidence: s.lowConfidence,
      }))
    );
    // 전사 끝 — 오디오 즉시 폐기(미보관 원칙) + status='queued' 로 되돌려 평가를 다음 실행에 맡긴다.
    // startedAt=null 로 두면 cleanupStuck 의 stale 윈도우 계산에서도 깔끔하다(다음 claim 이 재설정).
    // attempts=0 리셋: 전사 성공은 '전진'이지 재시도가 아니다. 리셋 안 하면 전사에서 쓴 claim 이
    // 평가 예산까지 잠식해, 짧은 면접도 claim 몇 번에 상한을 넘겨 '실패'로 오판됐다(2026-07-07 사고).
    await deleteFile(ri.audioBlobKey).catch(() => {});
    await db
      .update(recordedInterviews)
      .set({
        durationSeconds,
        audioBlobKey: null,
        status: "queued",
        startedAt: null,
        attempts: 0,
      })
      .where(eq(recordedInterviews.id, riId));
    return;
  }

  // ── 2단계: 평가 (오디오 없음 = 전사 완료 상태). 세그먼트가 있어야 평가 가능. ──────────
  const [seg] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(interviewTranscriptSegments)
    .where(eq(interviewTranscriptSegments.recordedInterviewId, riId));
  if (Number(seg?.c ?? 0) === 0)
    throw new RecordedInterviewError(
      "전사할 오디오가 없습니다. 다시 업로드해 주세요.",
      true
    );

  // 역할 배정 → 평가 → 리포트 저장 → 멱등 후차감(once). finalize 가 status='ready' 설정.
  await finalizeRecordedInterview(riId, { charge: "once" });
}

/**
 * 실패 처리. permanent 이거나 상한 도달이면 failed(+오디오 폐기), 아니면 queued 로 재시도.
 * @returns { permanent } 영구 실패 여부.
 */
export async function markRecordedFailedOrRetry(
  riId: number,
  currentAttempts: number,
  error: string,
  permanent: boolean
): Promise<{ permanent: boolean }> {
  if (permanent || currentAttempts >= MAX_RECORDED_ATTEMPTS) {
    // 영구 실패 — 남은 오디오 폐기 (orphan blob 방지).
    const [ri] = await db
      .select({ key: recordedInterviews.audioBlobKey })
      .from(recordedInterviews)
      .where(eq(recordedInterviews.id, riId));
    if (ri?.key) await deleteFile(ri.key).catch(() => {});
    // status 가드: 동시 실행된 다른 finalize(워커 자동평가 + 사용자 재평가)가 이미 성공시켰으면
    // 이번 실패로 덮어쓰지 않는다 — '성공인데 실패' 표시·이미 완료된 건의 재처리(재과금) 방지.
    await db
      .update(recordedInterviews)
      .set({
        status: "failed",
        error: error.slice(0, 500),
        audioBlobKey: null,
        completedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(recordedInterviews.id, riId),
          ne(recordedInterviews.status, "ready"),
          ne(recordedInterviews.status, "confirmed")
        )
      );
    return { permanent: true };
  }
  // 재시도 — queued 로 되돌림. 자기 자신은 self-chain 하지 않으므로(busy-loop 방지),
  // 다음 cron(매분)이 ~1분 backoff 후 다시 claim 한다. (이미 성공한 건은 재큐 금지 = 재과금 방지.)
  await db
    .update(recordedInterviews)
    .set({ status: "queued", error: error.slice(0, 500) })
    .where(
      and(
        eq(recordedInterviews.id, riId),
        ne(recordedInterviews.status, "ready"),
        ne(recordedInterviews.status, "confirmed")
      )
    );
  return { permanent: false };
}

/** 남은 queued 건수 (self-chain 판단·모니터링용). */
export async function getQueuedRecordedCount(): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(recordedInterviews)
    .where(eq(recordedInterviews.status, "queued"));
  return Number(r?.c ?? 0);
}

/** 워커를 즉시 깨우는 fire-and-forget 트리거 (업로드 직후·cron 안전망에서 호출). */
export function triggerRecordedWorker(req?: Request): void {
  const base = workerBaseUrl(req);
  void fetch(`${base}/api/internal/process-recorded-interviews`, {
    method: "POST",
    headers: { "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "" },
  }).catch((e) =>
    console.error(
      "[recorded-worker-trigger] failed:",
      e instanceof Error ? e.message : e
    )
  );
}

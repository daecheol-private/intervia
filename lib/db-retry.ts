/**
 * 원격 DB(Turso/libsql) 의 *일시적* 장애 판별 + 짧은 재시도.
 *
 * 왜 필요한가: @libsql/client 는 원격 5xx(502/503/504)·스트림 만료·네트워크 끊김에 대한
 * 자동 재시도가 없다. 매분 도는 서류평가 워커의 첫 DB 작업(cleanupStuck)이 Turso 의
 * 순간 502 를 만나면 그대로 throw → instrumentation(onRequestError) 이 Sentry 로 error
 * 전송 → 매분 같은 이슈로 노이즈가 쌓인다 (실제 반복 발생). 이런 블립은 다음 cron 에서
 * 자가복구되므로 여기서 짧게 재시도하고, 그래도 안 되면 호출부가 best-effort 로 건너뛴다.
 *
 * 핵심: *비*일시적 에러(no such column·문법 오류 등 진짜 버그)는 여기서 안 잡혀 그대로
 * 전파된다 → Sentry 가시성 유지. transient 판별을 보수적으로 두는 이유.
 *
 * Drizzle/@libsql 은 실제 원인을 error.cause 에 감싸므로 cause 체인을 평탄화해 판별한다.
 * node 모듈 미import (Edge 런타임 안전) — setTimeout/Promise 만 사용.
 */
import { log } from "./logger";

// message 부분일치(소문자). 오탐하면 진짜 버그를 삼키므로 보수적으로 — Turso/hrana 의
// 원격·전송 계층 신호만.
const TRANSIENT_MESSAGE = [
  "server returned http status 50", // 500/502/503/504 게이트웨이·서버 오류
  "server_error",
  "fetch failed",
  "econnreset",
  "etimedout",
  "socket hang up",
  "stream not found", // hrana 스트림 만료
  "stream expired",
  "baton", // hrana baton 불일치 → 재연결 필요
  "database is locked",
  "connection",
];
// code/rawCode 정확일치.
const TRANSIENT_CODE = new Set([
  "SERVER_ERROR",
  "SQLITE_BUSY",
  "500",
  "502",
  "503",
  "504",
]);

export function isTransientDbError(err: unknown): boolean {
  let cur: unknown = err;
  for (let d = 0; cur && d < 6; d++) {
    const n = cur as {
      message?: unknown;
      code?: unknown;
      rawCode?: unknown;
      cause?: unknown;
    };
    const code = n.code ?? n.rawCode;
    if (code != null && TRANSIENT_CODE.has(String(code))) return true;
    const msg = typeof n.message === "string" ? n.message.toLowerCase() : "";
    if (msg && TRANSIENT_MESSAGE.some((s) => msg.includes(s))) return true;
    cur = n.cause;
  }
  return false;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 일시적 DB 오류면 짧게 재시도. 마지막 시도까지 실패하면 그대로 throw (호출부가 처리).
 * 비일시적 오류는 즉시 throw (재시도 무의미 + 진짜 버그는 빨리 드러나야 함).
 *
 * serverless 환경이라 backoff 는 작게(기본 [150, 400]ms) — maxDuration 예산 보호.
 *
 * @param attempts 총 시도 횟수 (기본 3 = 최초 1 + 재시도 2)
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: { label?: string; attempts?: number; backoffMs?: number[] } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const backoff = opts.backoffMs ?? [150, 400];
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1 || !isTransientDbError(e)) throw e;
      // Turso 헬스 신호 — Sentry 가 아닌 Vercel 로그(warn)로만. 재시도가 잦으면 여기서 보인다.
      log.warn("db.transient_retry", {
        label: opts.label,
        attempt: i + 1,
        of: attempts,
        reason: e instanceof Error ? e.message : String(e),
      });
      await sleep(backoff[Math.min(i, backoff.length - 1)]);
    }
  }
  throw lastErr;
}

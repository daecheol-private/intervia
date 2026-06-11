/**
 * DB 제약 위반 판별 헬퍼.
 *
 * Drizzle + @libsql/client 는 에러를 감싸므로 최상위 Error.message 에는
 * "Failed query: insert into ..." 만 들어가고, 실제 SQLite 제약 위반 정보는
 * `e.cause`(LibsqlError/SqliteError) 의 message / code / rawCode 에 들어있다.
 *
 * 따라서 `e.message` 만 정규식으로 검사하면(이전 join-requests 버그) UNIQUE 충돌을
 * 못 잡아 500 이 난다. 최상위와 cause 체인을 모두 보고, code/rawCode 까지 확인한다.
 *
 * SQLite UNIQUE: extendedCode/code = "SQLITE_CONSTRAINT_UNIQUE", rawCode = 2067.
 */

type DbErrorLike = {
  message?: unknown;
  code?: unknown;
  rawCode?: unknown;
  extendedCode?: unknown;
  cause?: DbErrorLike | null;
};

function collect(e: unknown, depth = 0): DbErrorLike[] {
  if (!e || typeof e !== "object" || depth > 5) return [];
  const node = e as DbErrorLike;
  return [node, ...collect(node.cause, depth + 1)];
}

/** UNIQUE 제약 위반인지 — 메시지/코드/rawCode 를 cause 체인 전체에서 확인. */
export function isUniqueViolation(e: unknown): boolean {
  for (const node of collect(e)) {
    const msg = typeof node.message === "string" ? node.message : "";
    if (/unique constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(msg)) return true;
    if (node.code === "SQLITE_CONSTRAINT_UNIQUE") return true;
    if (node.extendedCode === "SQLITE_CONSTRAINT_UNIQUE") return true;
    if (node.rawCode === 2067) return true;
  }
  return false;
}

/**
 * 일시적(재시도하면 풀릴 수 있는) 쓰기 충돌인지 — `SQLITE_BUSY`/"database is locked".
 *
 * SQLite 는 단일 writer 라 동시 쓰기 트랜잭션이 겹치면 BEGIN 단계에서 즉시 이 오류로
 * 실패한다(`lib/db.ts` 에 busy_timeout 미설정). UNIQUE 와 달리 같은 작업을 다시 시도하면
 * 보통 성공하므로, 멱등 차감(`writeLedgerIdempotent`)처럼 누락이 곧 손실인 경로는 이걸로
 * 판별해 짧게 재시도한다. (운영 Turso 는 빈도가 다르나 동일 계열 오류로 귀결.)
 */
export function isTransientDbError(e: unknown): boolean {
  for (const node of collect(e)) {
    const msg = typeof node.message === "string" ? node.message : "";
    if (/SQLITE_BUSY|database is locked|database table is locked/i.test(msg))
      return true;
    if (node.code === "SQLITE_BUSY") return true;
    if (node.extendedCode === "SQLITE_BUSY") return true;
    if (node.rawCode === 5) return true;
  }
  return false;
}

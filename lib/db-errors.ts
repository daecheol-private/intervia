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

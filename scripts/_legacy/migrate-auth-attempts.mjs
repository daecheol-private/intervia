import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function tableExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function indexExists(name) {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function main() {
  console.log(`DB: ${url}`);
  if (!(await tableExists("auth_attempts"))) {
    console.log("  + CREATE TABLE auth_attempts");
    await db.execute(`
      CREATE TABLE auth_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier TEXT NOT NULL,
        kind TEXT NOT NULL,
        success INTEGER NOT NULL,
        user_agent TEXT,
        attempted_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  } else {
    console.log("  = auth_attempts already exists");
  }
  // 조회 인덱스 — 최근 N분 내 실패 count 자주 함
  if (!(await indexExists("idx_auth_attempts_lookup"))) {
    console.log("  + CREATE INDEX idx_auth_attempts_lookup");
    await db.execute(
      `CREATE INDEX idx_auth_attempts_lookup ON auth_attempts(identifier, kind, attempted_at)`
    );
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

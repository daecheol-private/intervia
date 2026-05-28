import "./_load-env.mjs";
import { createClient } from "@libsql/client";

/**
 * sync-schema.ts 에서 누락으로 보고된 테이블 생성.
 * 멱등 — IF NOT EXISTS 사용.
 *
 * 사용:
 *   $env:TURSO_DATABASE_URL = "libsql://..."
 *   $env:TURSO_AUTH_TOKEN   = "..."
 *   node scripts/create-missing-tables.mjs
 */

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

console.log(`\n🎯 Target DB: ${url}\n`);

const STATEMENTS = [
  {
    label: "user_candidate_favorites",
    sql: `CREATE TABLE IF NOT EXISTS user_candidate_favorites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    )`,
  },
  {
    label: "user_candidate_favorites unique index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_candidate_favorites_pk ON user_candidate_favorites(user_id, candidate_id)`,
  },
  {
    label: "notifications",
    sql: `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      href TEXT NOT NULL,
      payload TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    )`,
  },
];

let ok = 0;
let failed = 0;

for (const { label, sql } of STATEMENTS) {
  try {
    await db.execute(sql);
    console.log(`  ✅ ${label}`);
    ok++;
  } catch (e) {
    console.error(`  ❌ ${label} — ${e?.message ?? e}`);
    failed++;
  }
}

console.log(`\n결과 — 성공: ${ok}, 실패: ${failed}\n`);
if (failed > 0) process.exit(1);

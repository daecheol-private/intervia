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
  if (!(await tableExists("appeal_logs"))) {
    console.log("  + CREATE TABLE appeal_logs");
    await db.execute(`
      CREATE TABLE appeal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL,
        interview_session_id INTEGER NOT NULL,
        email TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        ip TEXT,
        user_agent TEXT,
        reviewed_by_user_id INTEGER,
        reviewed_at TEXT,
        response TEXT,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  } else {
    console.log("  = appeal_logs already exists");
  }
  if (!(await indexExists("idx_appeal_logs_candidate"))) {
    console.log("  + CREATE INDEX idx_appeal_logs_candidate");
    await db.execute(
      `CREATE INDEX idx_appeal_logs_candidate ON appeal_logs(candidate_id, created_at)`
    );
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

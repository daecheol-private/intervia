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
  if (!(await tableExists("consent_logs"))) {
    console.log("  + CREATE TABLE consent_logs");
    await db.execute(`
      CREATE TABLE consent_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        interview_session_id INTEGER NOT NULL,
        candidate_id INTEGER NOT NULL,
        consent_version TEXT NOT NULL,
        consents TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  } else {
    console.log("  = consent_logs already exists");
  }
  if (!(await indexExists("idx_consent_logs_session"))) {
    console.log("  + CREATE INDEX idx_consent_logs_session");
    await db.execute(
      `CREATE INDEX idx_consent_logs_session ON consent_logs(interview_session_id)`
    );
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

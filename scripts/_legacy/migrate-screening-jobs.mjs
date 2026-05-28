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
  if (!(await tableExists("screening_jobs"))) {
    console.log("  + CREATE TABLE screening_jobs");
    await db.execute(`
      CREATE TABLE screening_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        not_before TEXT,
        locked_at TEXT,
        locked_by TEXT,
        last_error TEXT,
        enqueued_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  } else {
    console.log("  = screening_jobs already exists");
  }

  // 큐 조회 인덱스 — worker 가 status='queued' AND not_before<=now 로 자주 스캔
  if (!(await indexExists("idx_screening_jobs_status"))) {
    console.log("  + CREATE INDEX idx_screening_jobs_status");
    await db.execute(
      `CREATE INDEX idx_screening_jobs_status ON screening_jobs(status, not_before)`
    );
  }
  if (!(await indexExists("idx_screening_jobs_candidate"))) {
    console.log("  + CREATE INDEX idx_screening_jobs_candidate");
    await db.execute(
      `CREATE INDEX idx_screening_jobs_candidate ON screening_jobs(candidate_id)`
    );
  }

  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ migration failed:", e);
  process.exit(1);
});

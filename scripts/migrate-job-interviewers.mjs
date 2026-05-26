import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function hasCol(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}
async function tableExists(name) {
  const r = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function main() {
  console.log(`DB: ${url}`);

  // 1) job_postings.created_by_user_id 컬럼
  if (!(await hasCol("job_postings", "created_by_user_id"))) {
    console.log("  + ALTER job_postings ADD created_by_user_id");
    await db.execute(
      `ALTER TABLE job_postings ADD COLUMN created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`
    );
  } else {
    console.log("  = job_postings.created_by_user_id already exists");
  }

  // 2) job_interviewers 테이블
  if (!(await tableExists("job_interviewers"))) {
    console.log("  + CREATE job_interviewers");
    await db.execute(`
      CREATE TABLE job_interviewers (
        job_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(
      `CREATE UNIQUE INDEX idx_job_interviewers_pk ON job_interviewers(job_id, user_id)`
    );
  } else {
    console.log("  = job_interviewers already exists");
  }

  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

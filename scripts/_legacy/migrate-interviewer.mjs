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
  if (!(await tableExists("interviewer_notes"))) {
    console.log("  + CREATE TABLE interviewer_notes");
    await db.execute(`
      CREATE TABLE interviewer_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        interview_session_id INTEGER,
        scores TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  }
  if (!(await indexExists("idx_interviewer_notes_candidate"))) {
    await db.execute(
      `CREATE INDEX idx_interviewer_notes_candidate ON interviewer_notes(candidate_id, created_at DESC)`
    );
  }

  if (!(await tableExists("interviewer_assignments"))) {
    console.log("  + CREATE TABLE interviewer_assignments");
    await db.execute(`
      CREATE TABLE interviewer_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  }
  if (!(await indexExists("idx_interviewer_assignments_candidate"))) {
    await db.execute(
      `CREATE INDEX idx_interviewer_assignments_candidate ON interviewer_assignments(candidate_id)`
    );
  }
  if (!(await indexExists("idx_interviewer_assignments_user"))) {
    await db.execute(
      `CREATE INDEX idx_interviewer_assignments_user ON interviewer_assignments(user_id)`
    );
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

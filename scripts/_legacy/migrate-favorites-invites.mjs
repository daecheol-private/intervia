import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function tableExists(name) {
  const r = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function main() {
  console.log(`DB: ${url}`);

  if (!(await tableExists("user_job_favorites"))) {
    console.log("  + CREATE user_job_favorites");
    await db.execute(`
      CREATE TABLE user_job_favorites (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(`
      CREATE UNIQUE INDEX idx_user_job_favorites_pk
      ON user_job_favorites(user_id, job_id)
    `);
  } else {
    console.log("  = user_job_favorites already exists");
  }

  if (!(await tableExists("org_invites"))) {
    console.log("  + CREATE org_invites");
    await db.execute(`
      CREATE TABLE org_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL UNIQUE,
        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        job_id INTEGER REFERENCES job_postings(id) ON DELETE SET NULL,
        invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        used_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(
      `CREATE INDEX idx_org_invites_email ON org_invites(email, used_at)`
    );
  } else {
    console.log("  = org_invites already exists");
  }

  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

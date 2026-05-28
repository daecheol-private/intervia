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

async function main() {
  console.log(`DB: ${url}`);
  if (!(await tableExists("org_smtp_configs"))) {
    console.log("  + CREATE TABLE org_smtp_configs");
    await db.execute(`
      CREATE TABLE org_smtp_configs (
        org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 465,
        secure INTEGER NOT NULL DEFAULT 1,
        auth_user TEXT NOT NULL,
        auth_pass TEXT NOT NULL,
        from_email TEXT NOT NULL,
        from_name TEXT,
        last_checked_at TEXT,
        last_check_status TEXT,
        last_check_error TEXT,
        updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  } else {
    console.log("  = org_smtp_configs already exists");
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ migration failed:", e);
  process.exit(1);
});

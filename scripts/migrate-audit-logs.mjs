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
  if (!(await tableExists("audit_logs"))) {
    console.log("  + CREATE TABLE audit_logs");
    await db.execute(`
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER,
        actor_role TEXT,
        org_id INTEGER,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id INTEGER,
        ip TEXT,
        user_agent TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  } else {
    console.log("  = audit_logs already exists");
  }
  if (!(await indexExists("idx_audit_logs_org_created"))) {
    console.log("  + CREATE INDEX idx_audit_logs_org_created");
    await db.execute(
      `CREATE INDEX idx_audit_logs_org_created ON audit_logs(org_id, created_at DESC)`
    );
  }
  if (!(await indexExists("idx_audit_logs_actor"))) {
    console.log("  + CREATE INDEX idx_audit_logs_actor");
    await db.execute(
      `CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC)`
    );
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

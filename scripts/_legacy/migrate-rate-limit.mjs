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
  if (!(await tableExists("api_rate_log"))) {
    console.log("  + CREATE TABLE api_rate_log");
    await db.execute(`
      CREATE TABLE api_rate_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        identifier TEXT NOT NULL,
        attempted_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      )
    `);
  } else {
    console.log("  = api_rate_log already exists");
  }
  if (!(await indexExists("idx_api_rate_log_lookup"))) {
    console.log("  + CREATE INDEX idx_api_rate_log_lookup");
    await db.execute(
      `CREATE INDEX idx_api_rate_log_lookup ON api_rate_log(scope, identifier, attempted_at)`
    );
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

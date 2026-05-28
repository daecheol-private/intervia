import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function tableHasColumn(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}

async function main() {
  console.log(`DB: ${url}`);
  if (!(await tableHasColumn("candidates", "resume_masked_text"))) {
    console.log("  + ALTER candidates ADD resume_masked_text");
    await db.execute(`ALTER TABLE candidates ADD COLUMN resume_masked_text TEXT`);
  } else {
    console.log("  = candidates.resume_masked_text already exists");
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ migration failed:", e);
  process.exit(1);
});

import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function hasCol(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}

async function main() {
  console.log(`DB: ${url}`);
  if (!(await hasCol("candidates", "decision_from_stage"))) {
    console.log("  + ALTER candidates ADD decision_from_stage");
    await db.execute(`ALTER TABLE candidates ADD COLUMN decision_from_stage TEXT`);
  } else {
    console.log("  = candidates.decision_from_stage already exists");
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

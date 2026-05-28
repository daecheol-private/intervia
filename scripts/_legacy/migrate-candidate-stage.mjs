import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function hasCol(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}

async function ensure(col, ddl) {
  if (!(await hasCol("candidates", col))) {
    console.log(`  + ALTER candidates ADD ${col}`);
    await db.execute(`ALTER TABLE candidates ADD COLUMN ${ddl}`);
  } else {
    console.log(`  = candidates.${col} already exists`);
  }
}

async function main() {
  console.log(`DB: ${url}`);
  await ensure("stage", "stage TEXT NOT NULL DEFAULT 'applied'");
  await ensure("decided_at", "decided_at TEXT");
  await ensure(
    "decided_by_user_id",
    "decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"
  );
  await ensure("decision_note", "decision_note TEXT");

  // 기존 후보자 stage 백필 — status 매핑
  await db.execute(`
    UPDATE candidates SET stage = 'screened' WHERE stage='applied' AND status='screened'
  `);
  await db.execute(`
    UPDATE candidates SET stage = 'interview_1' WHERE stage='applied' AND status='interviewed'
  `);
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

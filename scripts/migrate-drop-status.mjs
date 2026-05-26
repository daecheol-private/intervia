/**
 * candidates.status 컬럼 DROP.
 * 모든 사용처가 stage / outcome / screeningJobs / interviewSessions / screeningReport 로 전환된 후 실행.
 */
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
  if (!(await tableHasColumn("candidates", "status"))) {
    console.log("  = candidates.status already dropped");
    return;
  }
  console.log("  - DROP candidates.status");
  await db.execute(`ALTER TABLE candidates DROP COLUMN status`);
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ migration failed:", e);
  process.exit(1);
});

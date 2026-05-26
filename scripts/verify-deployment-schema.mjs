import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

const REQUIRED = {
  candidates: [
    "applicant_consent_confirmed_at",
    "applicant_consent_confirmed_by_user_id",
  ],
  users: [
    "terms_accepted_ip",
    "terms_accepted_ua",
    "privacy_accepted_ip",
    "privacy_accepted_ua",
  ],
};

async function main() {
  console.log(`DB: ${url}\n`);
  let allOk = true;
  for (const [table, cols] of Object.entries(REQUIRED)) {
    const r = await db.execute(`PRAGMA table_info(${table})`);
    const have = new Set(r.rows.map((row) => row.name));
    console.log(`Table ${table}:`);
    for (const col of cols) {
      const ok = have.has(col);
      console.log(`  ${ok ? "✅" : "❌"} ${col}`);
      if (!ok) allOk = false;
    }
  }

  // 인덱스 / 외래키도 한번 확인
  const idxC = await db.execute(`PRAGMA index_list(candidates)`);
  console.log(`\ncandidates indexes: ${idxC.rows.length}`);

  if (!allOk) {
    console.error("\n❌ 일부 컬럼 누락. 마이그레이션 재실행 필요.");
    process.exit(1);
  }
  console.log("\n✅ all required columns present");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

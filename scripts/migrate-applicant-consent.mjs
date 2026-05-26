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
  if (!(await hasCol("candidates", "applicant_consent_confirmed_at"))) {
    console.log("  + ALTER candidates ADD applicant_consent_confirmed_at");
    await db.execute(
      `ALTER TABLE candidates ADD COLUMN applicant_consent_confirmed_at TEXT`
    );
  } else {
    console.log("  = candidates.applicant_consent_confirmed_at already exists");
  }
  if (!(await hasCol("candidates", "applicant_consent_confirmed_by_user_id"))) {
    console.log("  + ALTER candidates ADD applicant_consent_confirmed_by_user_id");
    await db.execute(
      `ALTER TABLE candidates ADD COLUMN applicant_consent_confirmed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`
    );
  } else {
    console.log(
      "  = candidates.applicant_consent_confirmed_by_user_id already exists"
    );
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

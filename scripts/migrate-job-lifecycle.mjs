import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function hasCol(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}

async function ensure(table, col, ddl) {
  if (!(await hasCol(table, col))) {
    console.log(`  + ALTER ${table} ADD ${col}`);
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } else {
    console.log(`  = ${table}.${col} already exists`);
  }
}

async function main() {
  console.log(`DB: ${url}`);

  // job_postings — 라이프사이클 컬럼
  // SQLite ALTER ADD COLUMN 은 non-constant DEFAULT (CURRENT_TIMESTAMP) 불가 → nullable 로 추가 후 UPDATE
  await ensure("job_postings", "status", "status TEXT NOT NULL DEFAULT 'active'");
  if (!(await hasCol("job_postings", "published_at"))) {
    console.log("  + ALTER job_postings ADD published_at");
    await db.execute(`ALTER TABLE job_postings ADD COLUMN published_at TEXT`);
  }
  if (!(await hasCol("job_postings", "closes_at"))) {
    console.log("  + ALTER job_postings ADD closes_at");
    await db.execute(`ALTER TABLE job_postings ADD COLUMN closes_at TEXT`);
  }
  await ensure("job_postings", "closed_at", "closed_at TEXT");
  await ensure(
    "job_postings",
    "extension_count",
    "extension_count INTEGER NOT NULL DEFAULT 0"
  );

  // 기존 job_postings — published_at=created_at, closes_at=published_at + 60일
  await db.execute(`
    UPDATE job_postings
    SET published_at = created_at
    WHERE published_at IS NULL OR published_at = ''
  `);
  await db.execute(`
    UPDATE job_postings
    SET closes_at = datetime(published_at, '+60 days')
    WHERE closes_at IS NULL OR closes_at = ''
  `);
  console.log("  · backfilled job_postings.published_at/closes_at");

  // candidates — 이메일 카운터 + PII 폐기 마커
  await ensure(
    "candidates",
    "interview_email_count",
    "interview_email_count INTEGER NOT NULL DEFAULT 0"
  );
  await ensure(
    "candidates",
    "decision_email_count",
    "decision_email_count INTEGER NOT NULL DEFAULT 0"
  );
  await ensure("candidates", "pii_purged_at", "pii_purged_at TEXT");

  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

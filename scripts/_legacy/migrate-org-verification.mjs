import "./_load-env.mjs";
import { createClient } from "@libsql/client";

/**
 * organizations 테이블 + 관련 컬럼 추가 마이그레이션.
 * 멱등 — 이미 있으면 skip.
 *
 * 추가 컬럼:
 *   - office_address, office_address_detail (오프라인 면접 주소)
 *   - suspended_at, suspended_reason (법인 정지)
 *   - verification_status, verified_at, verified_by_user_id, verification_note (검증)
 *   - created_by_user_id (생성자)
 *   - idx_org_email_domain 인덱스
 *
 * 사용:
 *   $env:TURSO_DATABASE_URL = "libsql://..."
 *   $env:TURSO_AUTH_TOKEN   = "..."
 *   node scripts/migrate-org-verification.mjs
 */

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

console.log(`\n🎯 Target DB: ${url}\n`);

// 각 ALTER 를 개별 try/catch — 이미 있으면 "duplicate column" 에러 → skip.
const ALTERS = [
  {
    label: "office_address",
    sql: `ALTER TABLE organizations ADD COLUMN office_address TEXT`,
  },
  {
    label: "office_address_detail",
    sql: `ALTER TABLE organizations ADD COLUMN office_address_detail TEXT`,
  },
  {
    label: "suspended_at",
    sql: `ALTER TABLE organizations ADD COLUMN suspended_at TEXT`,
  },
  {
    label: "suspended_reason",
    sql: `ALTER TABLE organizations ADD COLUMN suspended_reason TEXT`,
  },
  {
    label: "verification_status",
    // NOT NULL DEFAULT 'pending_review' — 기존 row 도 안전하게 채워짐.
    sql: `ALTER TABLE organizations ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending_review'`,
  },
  {
    label: "verified_at",
    sql: `ALTER TABLE organizations ADD COLUMN verified_at TEXT`,
  },
  {
    label: "verified_by_user_id",
    sql: `ALTER TABLE organizations ADD COLUMN verified_by_user_id INTEGER`,
  },
  {
    label: "verification_note",
    sql: `ALTER TABLE organizations ADD COLUMN verification_note TEXT`,
  },
  {
    label: "created_by_user_id",
    sql: `ALTER TABLE organizations ADD COLUMN created_by_user_id INTEGER`,
  },
];

let added = 0;
let skipped = 0;
let failed = 0;

for (const { label, sql } of ALTERS) {
  try {
    await db.execute(sql);
    console.log(`  ✅ added: ${label}`);
    added++;
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (/duplicate column|already exists/i.test(msg)) {
      console.log(`  ⏭️  skip (exists): ${label}`);
      skipped++;
    } else {
      console.error(`  ❌ failed: ${label} — ${msg}`);
      failed++;
    }
  }
}

// 도메인 인덱스
try {
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_org_email_domain ON organizations(email_domain)`
  );
  console.log(`  ✅ index: idx_org_email_domain`);
} catch (e) {
  console.error(`  ❌ index failed: ${e?.message ?? e}`);
  failed++;
}

console.log(
  `\n결과 — 추가: ${added}, 스킵: ${skipped}, 실패: ${failed}\n`
);

if (failed > 0) process.exit(1);

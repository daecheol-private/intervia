import "./_load-env.mjs";
/**
 * 모든 마이그레이션을 순서대로 실행.
 * 신규 DB (Turso 또는 새 로컬) 셋업용. 멱등 (이미 적용된 건 skip).
 *
 * 사용:
 *   $env:TURSO_DATABASE_URL = "libsql://..."   # PowerShell
 *   $env:TURSO_AUTH_TOKEN = "..."
 *   node scripts/migrate-all.mjs
 *
 * 또는 로컬:
 *   node scripts/migrate-all.mjs               # → file:./data.db
 */
import { spawnSync } from "node:child_process";

const SCRIPTS = [
  "migrate-multitenant.mjs",
  "migrate-email-verification.mjs",
  "migrate-masked-text.mjs",
  "migrate-smtp.mjs",
  "migrate-screening-jobs.mjs",
  "purge-resume-text.mjs", // 기존 행 cleanup (멱등)
];

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:./data.db";

console.log(`\n🎯 Target DB: ${url}\n`);

for (const s of SCRIPTS) {
  console.log(`▶ ${s}`);
  const r = spawnSync("node", [`scripts/${s}`], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`❌ ${s} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
  console.log("");
}

console.log("✅ 모든 마이그레이션 완료");

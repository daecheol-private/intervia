/**
 * 신규 DB (Turso 또는 새 로컬) 셋업.
 *
 * 1) drizzle-kit push  → schema.ts 기반 모든 테이블 + 인덱스 일괄 생성
 * 2) 초기 토큰 가격 시드 (job_post, resume_upload, interview)
 * 3) 끝 — 사용자는 웹 UI 에서 첫 가입 → 자동으로 system_admin 됨
 *
 * 사용:
 *   $env:TURSO_DATABASE_URL = "libsql://..."
 *   $env:TURSO_AUTH_TOKEN   = "eyJhbGc..."
 *   node scripts/setup-fresh-db.mjs
 *
 * 로컬 fresh DB:
 *   Remove-Item .\data.db     # 기존 DB 지우기
 *   node scripts/setup-fresh-db.mjs
 */
import "./_load-env.mjs"; // .env.local / .env.production.local 자동 로드
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:./data.db";

console.log(`\n🎯 Target DB: ${url}\n`);

// 1) drizzle-kit push
console.log("▶ [1/2] drizzle-kit push");
const push = spawnSync("npx", ["drizzle-kit", "push", "--force"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
if (push.status !== 0) {
  console.error("❌ drizzle-kit push 실패");
  process.exit(push.status ?? 1);
}

// 2) 토큰 가격 시드
console.log("\n▶ [2/2] Seed default token pricing");
const db = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const DEFAULT_PRICING = [
  ["job_post", 10],
  ["resume_upload", 5],
  ["interview", 30],
];
for (const [key, cost] of DEFAULT_PRICING) {
  await db.execute({
    sql: `INSERT INTO token_pricing (feature_key, cost) VALUES (?, ?)
          ON CONFLICT(feature_key) DO NOTHING`,
    args: [key, cost],
  });
  console.log(`  ✓ ${key} = ${cost} tokens`);
}

console.log("\n✅ 셋업 완료\n");
console.log("다음 단계:");
console.log("  - 배포된 URL 접속 → 첫 회원가입 → 자동으로 system_admin 권한 부여됨");
console.log("  - 또는 로컬: npm run dev → http://localhost:3002/login → 초기 관리자 생성");

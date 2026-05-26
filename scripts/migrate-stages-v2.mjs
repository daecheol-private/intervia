/**
 * 채용 단계 stage enum 재정의 마이그레이션 (2026-05-18).
 *
 * 기존 → 신규:
 *   applied              → applied         (변경 없음)
 *   screened             → screened        (변경 없음)
 *   interview_pending    → ai_pending
 *   interview_done       → ai_evaluated
 *   interview_1          → round1_passed
 *   interview_2          → round2_passed
 *   offer                → hired           (처우 단계 제거 → 최종합격으로 흡수)
 *   hired                → hired
 *   rejected             → rejected
 *   hold                 → rejected        (보류 단계 제거 → 일단 불합격 처리)
 *   withdrawn            → withdrawn
 *
 * 신규 단계 (기존 데이터 없음): round1_candidate, round1_scheduling, round1_waiting
 *
 * sqlite/libsql 은 CHECK 제약 없는 TEXT 컬럼 → ALTER 불필요, UPDATE 만 수행.
 */
import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

const MAPPING = [
  ["interview_pending", "ai_pending"],
  ["interview_done", "ai_evaluated"],
  ["interview_1", "round1_passed"],
  ["interview_2", "round2_passed"],
  ["offer", "hired"],
  ["hold", "rejected"],
];

async function main() {
  console.log(`DB: ${url}`);
  for (const [from, to] of MAPPING) {
    const r = await db.execute({
      sql: `UPDATE candidates SET stage = ? WHERE stage = ?`,
      args: [to, from],
    });
    console.log(`  ${from} → ${to}: ${r.rowsAffected} rows`);
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

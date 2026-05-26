/**
 * outcome / outcome_reason 컬럼 추가 + 기존 stage='hired/rejected/withdrawn' 행 분리.
 *
 * 새 모델: stage (진행 단계) + outcome (종결 결과).
 *   기존: stage='hired' 만으로 종결 표현
 *   신: stage=마지막 진행 단계 + outcome='hired'
 *
 * 마이그레이션 매핑:
 *   - decision_from_stage 가 있으면 그 값을 stage 로 복원
 *   - 없으면 outcome 별 fallback:
 *       hired      → round2_passed
 *       rejected   → screened       (가장 흔한 첫 거름점)
 *       withdrawn  → ai_pending     (대부분 AI면접 발송 후 취소)
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

const FALLBACK_STAGE = {
  hired: "round2_passed",
  rejected: "screened",
  withdrawn: "ai_pending",
};

const FALLBACK_REASON = {
  hired: "passed_final",
  rejected: "resume_unfit",
  withdrawn: "candidate_withdrew",
};

async function main() {
  console.log(`DB: ${url}`);

  if (!(await tableHasColumn("candidates", "outcome"))) {
    console.log("  + ALTER candidates ADD outcome");
    await db.execute(`ALTER TABLE candidates ADD COLUMN outcome TEXT`);
  } else {
    console.log("  = candidates.outcome already exists");
  }

  if (!(await tableHasColumn("candidates", "outcome_reason"))) {
    console.log("  + ALTER candidates ADD outcome_reason");
    await db.execute(`ALTER TABLE candidates ADD COLUMN outcome_reason TEXT`);
  } else {
    console.log("  = candidates.outcome_reason already exists");
  }

  // 기존 종결 stage 행을 outcome 으로 분리
  const targets = await db.execute({
    sql: `SELECT id, stage, decision_from_stage, outcome FROM candidates
          WHERE stage IN ('hired','rejected','withdrawn') AND outcome IS NULL`,
  });
  console.log(`  → 분리 대상 ${targets.rows.length} 행`);

  for (const row of targets.rows) {
    const id = row.id;
    const oldStage = row.stage;
    const restored = row.decision_from_stage || FALLBACK_STAGE[oldStage];
    const reason = FALLBACK_REASON[oldStage];
    await db.execute({
      sql: `UPDATE candidates SET stage=?, outcome=?, outcome_reason=? WHERE id=?`,
      args: [restored, oldStage, reason, id],
    });
  }
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ migration failed:", e);
  process.exit(1);
});

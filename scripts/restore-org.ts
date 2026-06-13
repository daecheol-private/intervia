/**
 * 법인(org) 단위 선별 복구 — 추출 헬퍼.
 *
 * 백업(dump)·PITR 은 DB 전체 단위라, "한 법인만" 되살리려면 전체를 스크래치 DB 에
 * 복원한 뒤 그 법인의 서브트리만 골라 운영에 다시 넣어야 한다. 이 스크립트는
 * **읽기 전용**으로 스크래치 DB 에서 한 법인의 모든 행을 FK 순서대로 추출해
 * 검토용 INSERT SQL 파일로 출력한다. **운영에 직접 쓰지 않는다.**
 * (운영 적용은 사람이 SQL 을 검토한 뒤 수동으로 — CLAUDE.md 운영 데이터 보호 절대 규칙.)
 *
 * 흐름:
 *   1) 전체 dump 를 스크래치 DB 로 복원 (RUNBOOK §4-3 1~2단계)
 *        age -d -i key.txt -o dump.sql dump.sql.age
 *        turso db create intervia-restore && turso db shell intervia-restore < dump.sql
 *      또는 로컬 파일로:  (sqlite3 restore.db < dump.sql)
 *   2) 이 스크립트로 법인 추출:
 *        # 법인 목록 보기 (어떤 org_id 인지 확인)
 *        $env:RESTORE_DATABASE_URL="libsql://intervia-restore-...turso.io"
 *        $env:RESTORE_AUTH_TOKEN="..."
 *        npm run db:restore-org
 *        # 특정 법인 추출 → restore-org-<id>.sql 생성
 *        npm run db:restore-org -- --org 5
 *   3) 생성된 SQL 을 검토 → 운영에 적용 (turso db shell <운영DB> < restore-org-5.sql).
 *      ⚠️ 운영 적용 전 반드시: 사용자 승인 + 직전 백업 확보.
 *
 * 소스 DB 지정 (우선순위): --source <url>  >  RESTORE_DATABASE_URL  >  file:restore.db
 *   (운영 TURSO_DATABASE_URL 은 절대 기본값으로 쓰지 않는다. 같으면 경고.)
 *
 * 옵션:
 *   --org <id>            추출할 법인 id. 없으면 법인 목록만 출력.
 *   --out <path>          출력 파일 (기본 restore-org-<id>.sql).
 *   --conflict <mode>     error(기본) | ignore | replace
 *                           error   = INSERT             (이미 있으면 실패 — 삭제분 재삽입용)
 *                           ignore  = INSERT OR IGNORE   (있는 행은 건너뜀)
 *                           replace = INSERT OR REPLACE  (덮어쓰기 — 롤백용, 위험)
 *   --source <url>        소스(스크래치) DB.  --source-token <token>
 */
import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sourceUrl =
  arg("source") || process.env.RESTORE_DATABASE_URL || "file:restore.db";
const sourceToken = arg("source-token") || process.env.RESTORE_AUTH_TOKEN;
const orgArg = arg("org");
const outPath = arg("out");
const conflict = (arg("conflict") || "error").toLowerCase();

const INSERT_KW =
  conflict === "ignore"
    ? "INSERT OR IGNORE INTO"
    : conflict === "replace"
      ? "INSERT OR REPLACE INTO"
      : "INSERT INTO";

if (!["error", "ignore", "replace"].includes(conflict)) {
  console.error(`❌ --conflict 는 error|ignore|replace 중 하나여야 합니다 (받음: ${conflict})`);
  process.exit(1);
}

// 운영 DB 를 소스로 잘못 지정하는 footgun 방지 (읽기 전용이라 위험하진 않지만, 복구는 스냅샷에서).
if (process.env.TURSO_DATABASE_URL && sourceUrl === process.env.TURSO_DATABASE_URL) {
  console.warn(
    "⚠️  소스가 운영 TURSO_DATABASE_URL 과 동일합니다. 복구는 보통 '스냅샷(스크래치) DB'에서 추출합니다.\n" +
      "   현재 운영 데이터를 그대로 뽑는 게 의도라면 무시하세요. (읽기 전용이라 운영엔 영향 없음)\n"
  );
}

/**
 * 법인 서브트리 — 부모→자식 FK 순서. 각 행은 org_id 직접 보유거나,
 * candidate_id/job_id/user_id 를 타고 법인에 귀속된다. 모든 WHERE 는 ? = org_id 1개.
 *
 * 제외(전역·공유·휘발성): screening_cache(내용주소 공유캐시·재생성됨),
 *   token_pricing·marketing_recipients(전역), auth_attempts·api_rate_log(휘발),
 *   sessions·password_resets·email_verifications(휘발 인증), __drizzle_migrations.
 */
const TABLES: Array<{ name: string; where: string }> = [
  { name: "organizations", where: "id = ?" },
  { name: "users", where: "org_id = ?" },
  { name: "job_postings", where: "org_id = ?" },
  { name: "candidates", where: "org_id = ?" },
  { name: "interview_sessions", where: "candidate_id IN (SELECT id FROM candidates WHERE org_id = ?)" },
  { name: "candidate_attachments", where: "candidate_id IN (SELECT id FROM candidates WHERE org_id = ?)" },
  { name: "screening_jobs", where: "candidate_id IN (SELECT id FROM candidates WHERE org_id = ?)" },
  { name: "interviewer_notes", where: "candidate_id IN (SELECT id FROM candidates WHERE org_id = ?)" },
  { name: "job_interviewers", where: "job_id IN (SELECT id FROM job_postings WHERE org_id = ?)" },
  { name: "user_job_favorites", where: "user_id IN (SELECT id FROM users WHERE org_id = ?)" },
  { name: "user_candidate_favorites", where: "user_id IN (SELECT id FROM users WHERE org_id = ?)" },
  { name: "interview_schedules", where: "candidate_id IN (SELECT id FROM candidates WHERE org_id = ?)" },
  { name: "interview_question_sheets", where: "candidate_id IN (SELECT id FROM candidates WHERE org_id = ?)" },
  { name: "org_invites", where: "org_id = ?" },
  { name: "org_join_requests", where: "org_id = ?" },
  { name: "org_smtp_configs", where: "org_id = ?" },
  { name: "org_zoom_configs", where: "org_id = ?" },
  { name: "token_wallets", where: "org_id = ?" },
  { name: "token_ledger", where: "org_id = ?" },
  { name: "payment_orders", where: "org_id = ?" },
  { name: "notifications", where: "user_id IN (SELECT id FROM users WHERE org_id = ?)" },
  { name: "consent_logs", where: "candidate_id IN (SELECT id FROM candidates WHERE org_id = ?)" },
  { name: "appeal_logs", where: "candidate_id IN (SELECT id FROM candidates WHERE org_id = ?)" },
  { name: "audit_logs", where: "org_id = ?" },
  { name: "inquiries", where: "org_id = ?" },
];

const client = createClient({ url: sourceUrl, authToken: sourceToken });

/** SQLite SQL 리터럴 직렬화. */
function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString("hex")}'`;
  if (v instanceof ArrayBuffer) return `X'${Buffer.from(new Uint8Array(v)).toString("hex")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

async function tableExists(name: string): Promise<boolean> {
  const r = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
    args: [name],
  });
  return r.rows.length > 0;
}

async function listOrgs(): Promise<void> {
  console.log(`\n📂 소스: ${sourceUrl}\n`);
  const orgs = await client.execute(
    "SELECT id, name, verification_status, suspended_at, created_at FROM organizations ORDER BY id"
  );
  if (orgs.rows.length === 0) {
    console.log("법인이 없습니다. 소스 DB 가 맞는지 확인하세요.");
    return;
  }
  // 후보자 수 집계 (규모 가늠용).
  const counts = new Map<number, number>();
  try {
    const c = await client.execute(
      "SELECT org_id, COUNT(*) AS n FROM candidates GROUP BY org_id"
    );
    for (const row of c.rows) counts.set(Number(row.org_id), Number(row.n));
  } catch {
    /* candidates 없을 수도 */
  }
  console.log("법인 목록:");
  for (const o of orgs.rows) {
    const id = Number(o.id);
    const flags = [
      o.verification_status,
      o.suspended_at ? "🚫정지" : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `  [${id}] ${o.name}  · 후보자 ${counts.get(id) ?? 0}명 · ${flags} · 생성 ${o.created_at}`
    );
  }
  console.log(`\n추출:  npm run db:restore-org -- --org <id>\n`);
}

async function extractOrg(orgId: number): Promise<void> {
  // 대상 법인 존재 확인.
  const org = await client.execute({
    sql: "SELECT id, name FROM organizations WHERE id = ?",
    args: [orgId],
  });
  if (org.rows.length === 0) {
    console.error(`❌ org_id=${orgId} 법인을 소스에서 찾을 수 없습니다. 먼저 목록을 확인하세요.`);
    process.exit(1);
  }
  const orgName = String(org.rows[0].name);

  const lines: string[] = [];
  lines.push("-- ============================================================");
  lines.push(`-- Intervia 법인 단위 복구 SQL`);
  lines.push(`-- org_id = ${orgId}  (${orgName})`);
  lines.push(`-- 소스: ${sourceUrl}`);
  lines.push(`-- conflict mode: ${conflict}  (${INSERT_KW})`);
  lines.push("-- ⚠️ 검토 후 운영에 수동 적용. 운영 적용 전 사용자 승인 + 직전 백업 필수 (CLAUDE.md 절대 규칙).");
  lines.push("-- 적용:  turso db shell <운영DB> < 이파일   또는 Turso 대시보드 SQL 콘솔");
  lines.push("-- ============================================================");
  lines.push("-- (선택) 외부 법인 사용자 참조 등 FK 위반으로 막히면 아래 줄 주석 해제:");
  lines.push("-- PRAGMA foreign_keys=OFF;");
  lines.push("BEGIN TRANSACTION;");
  lines.push("");

  const summary: Array<{ table: string; rows: number }> = [];
  let total = 0;

  for (const { name, where } of TABLES) {
    if (!(await tableExists(name))) {
      console.warn(`  ⚠️  ${name} 테이블이 소스에 없음 — 건너뜀`);
      continue;
    }
    const res = await client.execute({
      sql: `SELECT * FROM ${q(name)} WHERE ${where}`,
      args: [orgId],
    });
    const n = res.rows.length;
    summary.push({ table: name, rows: n });
    total += n;
    if (n === 0) continue;

    const cols = res.columns;
    const colList = cols.map(q).join(", ");
    lines.push(`-- ${name} (${n} rows)`);
    for (const row of res.rows) {
      const vals = cols.map((c) => lit((row as Record<string, unknown>)[c])).join(", ");
      lines.push(`${INSERT_KW} ${q(name)} (${colList}) VALUES (${vals});`);
    }
    lines.push("");
  }

  lines.push("COMMIT;");
  lines.push("-- PRAGMA foreign_keys=ON;");
  lines.push("");

  const file = outPath || `restore-org-${orgId}.sql`;
  writeFileSync(file, lines.join("\n"), "utf8");

  console.log(`\n📦 법인 [${orgId}] ${orgName} 추출 완료`);
  console.log("─".repeat(48));
  for (const s of summary) {
    if (s.rows > 0) console.log(`  ${s.table.padEnd(28)} ${s.rows}`);
  }
  console.log("─".repeat(48));
  console.log(`  합계 ${total} rows  →  ${file}`);
  console.log(
    `\n다음: 파일을 검토한 뒤, 사용자 승인 + 직전 백업 확보 후\n` +
      `      turso db shell <운영DB> < ${file}\n`
  );
}

async function main(): Promise<void> {
  if (orgArg === undefined) {
    await listOrgs();
    return;
  }
  const orgId = Number(orgArg);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    console.error(`❌ --org 는 양의 정수여야 합니다 (받음: ${orgArg})`);
    process.exit(1);
  }
  await extractOrg(orgId);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ 추출 실패:", e);
    process.exit(1);
  });

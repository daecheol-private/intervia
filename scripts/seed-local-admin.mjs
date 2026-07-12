/**
 * 로컬 DB 완전 초기화 + 관리자(env SYSTEM_ADMIN_EMAIL) 계정 1개만 생성.
 *
 * "테스트를 위해 완전히 처음으로" — test-company 더미 없이, 전 테이블 wipe 후
 * ① token_pricing 기본값(앱 과금 동작 필수) ② system_admin 계정 1개만 심는다.
 *
 * 반드시 로컬로:  $env:LOCAL_DB="1"; node scripts/seed-local-admin.mjs
 * (_load-env 가 LOCAL_DB=1 일 때만 TURSO 변수를 지워 file:./data.db 로 떨어진다.)
 */
import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

// ── 운영 안전 가드: 전체 wipe 이므로 원격(비 file:) 은 절대 거부 ──────────────
// seed-test.mjs 와 동일 원칙. SEED_REMOTE 우회 경로조차 두지 않는다(로컬 전용 스크립트).
if (!url.startsWith("file:")) {
  console.error(`\n❌ 원격/비로컬 DB(${url}) 초기화 거부. 로컬은 LOCAL_DB=1 로 실행할 것.\n`);
  process.exit(1);
}

const ADMIN_EMAIL = process.env.SYSTEM_ADMIN_EMAIL;
if (!ADMIN_EMAIL) {
  console.error("\n❌ SYSTEM_ADMIN_EMAIL 이 env(.env.local) 에 없음.\n");
  process.exit(1);
}

// 부트스트랩 관리자 초기 비번(임시) — mustChangePassword=true 라 로그인 후 즉시 변경 유도.
// 실제 bootstrap-admin.ts 는 보안상 changeme 를 제거하고 SYSTEM_ADMIN_INITIAL_PASSWORD/랜덤을
// 쓰지만, 로컬 테스트 편의로 관례값 changeme 를 사용한다.
const PASSWORD = "changeme";

const PRICING = [
  ["job_post", 10],
  ["resume_upload", 5],
  ["interview", 30],
];

const db = createClient({ url, authToken });

async function main() {
  console.log(`\nDB      : ${url}`);
  console.log(`관리자  : ${ADMIN_EMAIL}\n`);

  // 로컬 file: 연결은 PRAGMA 상태가 유지되므로 FK OFF 후 순서 무관 삭제 가능.
  await db.execute("PRAGMA foreign_keys=OFF");

  const tbls = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'"
  );
  const names = tbls.rows.map((r) => r.name);
  console.log(`[1/3] Wipe ${names.length} tables`);
  for (const t of names) {
    await db.execute(`DELETE FROM "${t}"`);
  }
  // autoincrement 카운터 리셋 → id 1 부터 다시.
  try {
    await db.execute("DELETE FROM sqlite_sequence");
  } catch {
    // sqlite_sequence 는 autoincrement 테이블이 하나도 없으면 존재하지 않음.
  }

  console.log("[2/3] Seed token pricing (기본값)");
  for (const [key, cost] of PRICING) {
    await db.execute({
      sql: "INSERT INTO token_pricing(feature_key, cost) VALUES (?, ?)",
      args: [key, cost],
    });
  }

  console.log("[3/3] Seed system_admin account");
  const hash = await bcrypt.hash(PASSWORD, 10);
  await db.execute({
    sql: `INSERT INTO users(email, password_hash, name, is_admin, org_id, role, status, email_verified_at, must_change_password)
          VALUES (?, ?, ?, 1, NULL, 'system_admin', 'active', CURRENT_TIMESTAMP, 1)`,
    args: [ADMIN_EMAIL, hash, "시스템 관리자"],
  });

  // ── 검증 ──────────────────────────────────────────────────────────────────
  const u = await db.execute("SELECT id, email, role, is_admin, status, must_change_password FROM users");
  const p = await db.execute("SELECT feature_key, cost FROM token_pricing ORDER BY feature_key");
  const orgs = await db.execute("SELECT COUNT(*) AS c FROM organizations");
  const jobs = await db.execute("SELECT COUNT(*) AS c FROM job_postings");
  const cands = await db.execute("SELECT COUNT(*) AS c FROM candidates");

  console.log("\n✅ 완료");
  console.log("users       :", JSON.stringify(u.rows));
  console.log("token_pricing:", JSON.stringify(p.rows));
  console.log(`organizations: ${orgs.rows[0].c}, job_postings: ${jobs.rows[0].c}, candidates: ${cands.rows[0].c}`);
  console.log(`\n로그인 → ${ADMIN_EMAIL} / ${PASSWORD}\n`);
}

main().catch((e) => {
  console.error("❌ 실패:", e);
  process.exit(1);
});

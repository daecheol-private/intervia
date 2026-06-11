import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

// 전체 wipe 를 수행하므로 원격(운영) DB 차단 — _load-env 가 기본으로 .env.production.local 을
// 읽어 TURSO URL 이 잡힐 수 있다. 로컬 실행: $env:LOCAL_DB="1"; npm run db:seed-test
if (!url.startsWith("file:") && process.env.SEED_REMOTE !== "1") {
  console.error(`❌ 원격 DB(${url}) 시드 거부. 로컬은 LOCAL_DB=1, 원격을 정말 원하면 SEED_REMOTE=1.`);
  process.exit(1);
}

const db = createClient({ url, authToken });

// C-2 — 비번 정책(10자+·3종+) 준수. 기존 "Test1234!"(9자)는 정책 미달이라 일부
// 정책 검증 테스트(예: TC-4.1.2 동일비번 거부)가 길이 에러에 먼저 막혔다. 정책 통과 값으로 교체.
const PASSWORD = "Test1234!aZ";

const PRICING = [
  ["job_post", 10],
  ["resume_upload", 5],
  ["interview", 30],
];

async function wipe() {
  const tables = [
    "interview_sessions",
    "candidates",
    "job_postings",
    "token_ledger",
    "token_wallets",
    "token_pricing",
    "payment_orders",
    "org_join_requests",
    "email_verifications",
    "sessions",
    "users",
    "organizations",
  ];
  for (const t of tables) {
    try {
      await db.execute(`DELETE FROM ${t}`);
    } catch {
      // table may not exist yet (migration not run)
    }
  }
}

async function insertOrg(name, domain) {
  // C-1 — 실제 signup 은 도메인 이메일 인증으로 'verified' 법인을 만든다. 시드도 'verified' 로
  // 맞춰 합류 happy-path(검증 게이트 통과) 등 테스트가 우회 없이 돌게 한다.
  const r = await db.execute({
    sql: `INSERT INTO organizations(name, email_domain, verification_status, verified_at)
          VALUES (?, ?, 'verified', CURRENT_TIMESTAMP)`,
    args: [name, domain],
  });
  return Number(r.lastInsertRowid);
}

async function insertUser({ email, name, role, orgId, isAdmin = false }) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const r = await db.execute({
    sql: `INSERT INTO users(email, password_hash, name, is_admin, org_id, role, status, email_verified_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)`,
    args: [email, hash, name, isAdmin ? 1 : 0, orgId, role],
  });
  return Number(r.lastInsertRowid);
}

async function grantTokens(orgId, amount, memo) {
  await db.execute({
    sql: "INSERT INTO token_wallets(org_id, balance) VALUES (?, ?)",
    args: [orgId, amount],
  });
  await db.execute({
    sql: `INSERT INTO token_ledger(org_id, delta, reason, balance_after, memo)
          VALUES (?, ?, 'admin_adjust', ?, ?)`,
    args: [orgId, amount, amount, memo],
  });
}

async function insertJob({ orgId, title, position, pin }) {
  const passwordHash = pin ? await bcrypt.hash(pin, 10) : null;
  // 라이프사이클 도입 후 closes_at NOT NULL — 기본 60일 후
  const closesAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const r = await db.execute({
    sql: `INSERT INTO job_postings(
            org_id, title, position, level, employment_type,
            responsibilities, requirements, tone,
            interview_duration_minutes, password_hash, closes_at
          ) VALUES (?, ?, ?, '신입', '정규직', '담당업무', '자격요건', '중립적인', 30, ?, ?)`,
    args: [orgId, title, position, passwordHash, closesAt],
  });
  return Number(r.lastInsertRowid);
}

async function main() {
  console.log(`DB: ${url}`);
  console.log("[1/4] Wipe existing rows");
  await wipe();

  console.log("[2/4] Seed organizations");
  const orgAId = await insertOrg("test-company-a", "company-a.test");
  const orgBId = await insertOrg("test-company-b", "company-b.test");

  console.log("[3/4] Seed users");
  await insertUser({
    email: "sysadmin@test",
    name: "시스템관리자",
    role: "system_admin",
    orgId: null,
    isAdmin: true,
  });
  await insertUser({
    email: "admin@company-a.test",
    name: "A사 관리자",
    role: "org_admin",
    orgId: orgAId,
  });
  await insertUser({
    email: "member@company-a.test",
    name: "A사 멤버",
    role: "member",
    orgId: orgAId,
  });
  await insertUser({
    email: "admin@company-b.test",
    name: "B사 관리자",
    role: "org_admin",
    orgId: orgBId,
  });

  console.log("[4/4] Seed wallets, pricing, sample jobs");
  await grantTokens(orgAId, 1000, "test seed");
  await grantTokens(orgBId, 1000, "test seed");
  for (const [key, cost] of PRICING) {
    await db.execute({
      sql: `INSERT INTO token_pricing(feature_key, cost) VALUES (?, ?)
            ON CONFLICT(feature_key) DO UPDATE SET cost = excluded.cost`,
      args: [key, cost],
    });
  }
  await insertJob({
    orgId: orgAId,
    title: "A사 공개 공고",
    position: "백엔드 개발자",
    pin: null,
  });
  await insertJob({
    orgId: orgAId,
    title: "A사 PIN 공고",
    position: "프론트엔드 개발자",
    pin: "1234",
  });
  await insertJob({
    orgId: orgBId,
    title: "B사 공고",
    position: "데이터 엔지니어",
    pin: null,
  });

  console.log(`✅ test seed done — password for all users: ${PASSWORD}`);
}

main().catch((e) => {
  console.error("❌ seed failed:", e);
  process.exit(1);
});

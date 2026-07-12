/**
 * 테스트 DB 준비 — 스크래치 파일 DB 에 drizzle journal 전체 적용 + 시드.
 * scripts/seed-test.mjs 와 동일 구성 (검증된 시드 패턴을 격리 DB 에 재현).
 *
 * 안전: env.ts 의 격리 어서션 + 여기서 한 번 더 file:.testdb 확인.
 * 원격 URL 이면 어떤 쿼리도 실행하지 않는다.
 */
import { TEST_DB_URL, TESTDB_DIR, PASSWORD, assertIsolated } from "./env";
import { createClient, type Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert";
import bcrypt from "bcryptjs";

export type SeedIds = {
  orgA: number;
  orgB: number;
  jobA: number;
  jobAPin: number;
  jobB: number;
};

let client: Client | null = null;

export function testClient(): Client {
  assertIsolated();
  assert.ok(TEST_DB_URL.startsWith("file:") && TEST_DB_URL.includes(".testdb"));
  if (!client) client = createClient({ url: TEST_DB_URL });
  return client;
}

export function closeTestClient() {
  client?.close();
  client = null;
}

const statementsOf = (sql: string) =>
  sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

const isIdempotentError = (msg: string) => {
  const m = msg.toLowerCase();
  return (
    m.includes("duplicate column name") ||
    m.includes("already exists") ||
    m.includes("already an index")
  );
};

/** drizzle/meta/_journal.json 순서대로 전체 마이그레이션 적용 (스크래치 DB 전용) */
export async function applyMigrations() {
  const db = testClient();
  const journal = JSON.parse(
    readFileSync(path.join("drizzle", "meta", "_journal.json"), "utf8")
  ) as { entries: Array<{ tag: string; when: number }> };
  const entries = [...journal.entries].sort((a, b) => a.when - b.when);
  for (const entry of entries) {
    const sql = readFileSync(path.join("drizzle", `${entry.tag}.sql`), "utf8");
    for (const stmt of statementsOf(sql)) {
      try {
        await db.execute(stmt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isIdempotentError(msg)) continue;
        throw new Error(`마이그레이션 실패 (${entry.tag}): ${msg.split("\n")[0]}`);
      }
    }
  }
  // 서버(lib/db.ts)와 동일한 파일 모드 — 두 프로세스 동시 접근 안정화
  await db.execute("PRAGMA journal_mode=WAL");
  return entries.length;
}

async function insertOrg(name: string, domain: string): Promise<number> {
  const r = await testClient().execute({
    sql: `INSERT INTO organizations(name, email_domain, verification_status, verified_at)
          VALUES (?, ?, 'verified', CURRENT_TIMESTAMP)`,
    args: [name, domain],
  });
  return Number(r.lastInsertRowid);
}

async function insertUser(u: {
  email: string;
  name: string;
  role: string;
  orgId: number | null;
  isAdmin?: boolean;
  verified?: boolean;
}): Promise<number> {
  const hash = bcrypt.hashSync(PASSWORD, 4); // 로컬 대조용 — 낮은 cost 로 시드 속도 확보
  const r = await testClient().execute({
    sql: `INSERT INTO users(email, password_hash, name, is_admin, org_id, role, status, email_verified_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ${u.verified === false ? "NULL" : "CURRENT_TIMESTAMP"})`,
    args: [u.email, hash, u.name, u.isAdmin ? 1 : 0, u.orgId, u.role],
  });
  return Number(r.lastInsertRowid);
}

async function grantTokens(orgId: number, amount: number) {
  await testClient().execute({
    sql: "INSERT INTO token_wallets(org_id, balance) VALUES (?, ?)",
    args: [orgId, amount],
  });
  await testClient().execute({
    sql: `INSERT INTO token_ledger(org_id, delta, reason, balance_after, memo)
          VALUES (?, ?, 'admin_adjust', ?, 'critical-test seed')`,
    args: [orgId, amount, amount],
  });
}

async function insertJob(j: {
  orgId: number;
  title: string;
  position: string;
  pin?: string | null;
  applyToken?: string | null;
}): Promise<number> {
  const passwordHash = j.pin ? bcrypt.hashSync(j.pin, 4) : null;
  const closesAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const r = await testClient().execute({
    sql: `INSERT INTO job_postings(
            org_id, title, position, level, employment_type,
            responsibilities, requirements, tone,
            interview_duration_minutes, password_hash, closes_at, apply_token
          ) VALUES (?, ?, ?, '신입', '정규직', '담당업무', '자격요건', '중립적인', 30, ?, ?, ?)`,
    args: [j.orgId, j.title, j.position, passwordHash, closesAt, j.applyToken ?? null],
  });
  return Number(r.lastInsertRowid);
}

export const APPLY_TOKEN_A = "ct-apply-token-aaaaaaaaaaaaaaaa";

export async function seed(): Promise<SeedIds> {
  const orgA = await insertOrg("test-company-a", "company-a.test");
  const orgB = await insertOrg("test-company-b", "company-b.test");

  await insertUser({ email: "sysadmin@test", name: "시스템관리자", role: "system_admin", orgId: null, isAdmin: true });
  await insertUser({ email: "admin@company-a.test", name: "A사 관리자", role: "org_admin", orgId: orgA });
  await insertUser({ email: "member@company-a.test", name: "A사 멤버", role: "member", orgId: orgA });
  await insertUser({ email: "admin@company-b.test", name: "B사 관리자", role: "org_admin", orgId: orgB });
  // CT-105 전용 (락아웃 격리) / CT-106 전용 (이메일 미인증)
  await insertUser({ email: "ratelimit@company-a.test", name: "락아웃용", role: "member", orgId: orgA });
  await insertUser({ email: "unverified@company-a.test", name: "미인증", role: "member", orgId: orgA, verified: false });

  await grantTokens(orgA, 1000);
  await grantTokens(orgB, 1000);

  for (const [key, cost] of [
    ["job_post", 10],
    ["resume_upload", 5],
    ["interview", 30],
  ] as const) {
    await testClient().execute({
      sql: `INSERT INTO token_pricing(feature_key, cost) VALUES (?, ?)
            ON CONFLICT(feature_key) DO UPDATE SET cost = excluded.cost`,
      args: [key, cost],
    });
  }

  const jobA = await insertJob({
    orgId: orgA,
    title: "A사 공개 공고",
    position: "백엔드 개발자",
    applyToken: APPLY_TOKEN_A,
  });
  const jobAPin = await insertJob({ orgId: orgA, title: "A사 PIN 공고", position: "프론트엔드 개발자", pin: "1234" });
  const jobB = await insertJob({ orgId: orgB, title: "B사 공고", position: "데이터 엔지니어" });

  return { orgA, orgB, jobA, jobAPin, jobB };
}

// ── 시나리오 보조 (검증·주입) ────────────────────────────────────────────────

export async function walletBalance(orgId: number): Promise<number> {
  const r = await testClient().execute({
    sql: "SELECT balance FROM token_wallets WHERE org_id = ?",
    args: [orgId],
  });
  return Number(r.rows[0]?.balance ?? NaN);
}

export async function setWalletBalance(orgId: number, balance: number) {
  await testClient().execute({
    sql: "UPDATE token_wallets SET balance = ? WHERE org_id = ?",
    args: [balance, orgId],
  });
}

export async function ledgerRows(orgId: number, reason?: string) {
  const r = await testClient().execute({
    sql: reason
      ? "SELECT id, delta, reason, ref_type, ref_id, balance_after FROM token_ledger WHERE org_id = ? AND reason = ? ORDER BY id"
      : "SELECT id, delta, reason, ref_type, ref_id, balance_after FROM token_ledger WHERE org_id = ? ORDER BY id",
    args: reason ? [orgId, reason] : [orgId],
  });
  return r.rows;
}

export async function row<T = Record<string, unknown>>(
  sql: string,
  args: (string | number | null)[] = []
): Promise<T | undefined> {
  const r = await testClient().execute({ sql, args });
  return r.rows[0] as T | undefined;
}

export async function rows<T = Record<string, unknown>>(
  sql: string,
  args: (string | number | null)[] = []
): Promise<T[]> {
  const r = await testClient().execute({ sql, args });
  return r.rows as T[];
}

export async function exec(sql: string, args: (string | number | null)[] = []) {
  return testClient().execute({ sql, args });
}

/** 서류평가 리포트 주입 — 면접 링크 발급 게이트 통과용 (LLM 없이) */
export async function injectScreeningReport(candidateId: number, score = 72) {
  const report = JSON.stringify({
    score,
    summary: "테스트 주입 리포트",
    strengths: ["강점1"],
    concerns: ["우려1"],
    interview_focus: ["확인 포인트"],
  });
  await exec(
    `UPDATE candidates SET screening_report = ?, screening_score = ?, stage = 'screened' WHERE id = ?`,
    [report, score, candidateId]
  );
}

/** 최소 후보자 직접 생성 (테넌시·면접 플로우 셋업용 — 업로드 경로와 독립) */
export async function insertCandidate(c: {
  orgId: number;
  jobId: number;
  name: string;
  email: string | null;
  stage?: string;
}): Promise<number> {
  const r = await exec(
    `INSERT INTO candidates(org_id, job_id, name, email, resume_text, resume_file_path, stage)
     VALUES (?, ?, ?, ?, '', '', ?)`,
    [c.orgId, c.jobId, c.name, c.email, c.stage ?? "applied"]
  );
  return Number(r.lastInsertRowid);
}

export async function insertSession(s: {
  candidateId: number;
  accessToken: string;
  expiresAt: string;
  status?: string;
}): Promise<number> {
  const r = await exec(
    `INSERT INTO interview_sessions(candidate_id, access_token, expires_at, status)
     VALUES (?, ?, ?, ?)`,
    [s.candidateId, s.accessToken, s.expiresAt, s.status ?? "pending"]
  );
  return Number(r.lastInsertRowid);
}

export async function insertSchedule(s: {
  candidateId: number;
  jobId: number;
  orgId: number;
  accessToken: string;
  slots: Array<{ start: string; end: string }>;
  expiresAt: string;
}): Promise<number> {
  const r = await exec(
    `INSERT INTO interview_schedules(candidate_id, job_id, org_id, round, access_token, proposed_slots, mode_online, status, expires_at)
     VALUES (?, ?, ?, 'round1', ?, ?, 1, 'pending', ?)`,
    [s.candidateId, s.jobId, s.orgId, s.accessToken, JSON.stringify(s.slots), s.expiresAt]
  );
  return Number(r.lastInsertRowid);
}

export { TESTDB_DIR };

/**
 * 필수 기능 자동 테스트 — 시나리오·예상 결과는 docs/CRITICAL_TESTS.md 의 CT-XXX 와 1:1.
 * 실행: npm run test:critical  (격리: .testdb DB + 포트 3103 전용 서버)
 *
 * 파일 하나 = 순차 실행. 앞 테스트가 만든 상태를 뒤 테스트가 이어 쓴다(주석에 명시).
 */
import {
  BASE,
  CRON_SECRET,
  INTERNAL_SECRET,
  PASSWORD,
  ROOT,
  RUN_TAG,
} from "./env";
import {
  APPLY_TOKEN_A,
  applyMigrations,
  closeTestClient,
  exec,
  injectScreeningReport,
  insertCandidate,
  insertSchedule,
  insertSession,
  ledgerRows,
  row,
  rows,
  seed,
  setWalletBalance,
  walletBalance,
  type SeedIds,
} from "./db";
import { resetWorkspace, startServer, stopServer } from "./server";
import { Client, field } from "./http";
import { makeResumePdf } from "./fixtures";
import { after, before, describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
// lib 직접 단위 검증 (CT-10) — lib/db 가 모듈 로드 시 DB 파일을 열므로,
// .testdb 준비(before) 이후 동적 import 한다. env.ts 의 DATABASE_URL 이 적용된다.
let tokens: typeof import("../../lib/tokens");
let walletGuard: typeof import("../../lib/wallet-guard");

let ids: SeedIds;
const sysadmin = new Client();
const adminA = new Client();
const memberA = new Client();
const adminB = new Client();
const anon = new Client();

// 시나리오 간 공유 상태
const ctx = {
  jobNew: 0, // CT-3 에서 생성한 공고
  candUpload: 0, // CT-401 업로드 후보 (실파일 보유)
  candUploadFile: "", // 그 후보의 저장 파일 키
  candApply: 0, // CT-501 셀프지원 후보
  cAi: 0, // CT-7 면접 플로우 후보
  aiToken1: "",
  aiSession1: 0,
  aiToken2: "",
  cExp: 0,
  cCron: 0,
  cWd: 0,
  cSched: 0,
  schedToken: `ct-sched-${RUN_TAG}`,
  pdfA: Buffer.alloc(0) as Buffer,
  pdfB: Buffer.alloc(0) as Buffer,
  pdfC: Buffer.alloc(0) as Buffer,
  pdfD: Buffer.alloc(0) as Buffer,
};

function form(entries: Record<string, string | { buf: Buffer; name: string }>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (typeof v === "string") fd.append(k, v);
    else fd.append(k, new Blob([new Uint8Array(v.buf)], { type: "application/pdf" }), v.name);
  }
  return fd;
}

const futureIso = (ms: number) => new Date(Date.now() + ms).toISOString();
const pastIso = (ms: number) => new Date(Date.now() - ms).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

before(async () => {
  await resetWorkspace();
  const applied = await applyMigrations();
  assert.ok(applied > 0, "마이그레이션 0건 — journal 로딩 실패");
  ids = await seed();
  ctx.pdfA = await makeResumePdf({ name: "Upload Kim", email: "upload1@example.com" });
  ctx.pdfB = await makeResumePdf({ name: "Apply Lee", email: "apply1@example.com", extra: "Frontend focus." });
  ctx.pdfC = await makeResumePdf({ name: "Apply Park", email: "apply2@example.com", extra: "Data pipelines." });
  ctx.pdfD = await makeResumePdf({ name: "Apply Choi", email: "apply3@example.com", extra: "Infra and SRE." });
  tokens = await import("../../lib/tokens");
  walletGuard = await import("../../lib/wallet-guard");
  await startServer();
});

after(async () => {
  await stopServer();
  closeTestClient();
  // 이 실행이 uploads/ 에 남긴 픽스처만 정리 (RUN_TAG 프리픽스)
  try {
    const dir = path.join(ROOT, "uploads");
    for (const f of readdirSync(dir)) {
      if (f.includes(RUN_TAG)) rmSync(path.join(dir, f), { force: true });
    }
  } catch {
    /* uploads 미존재 등 — 무시 */
  }
});

// ─── CT-0. 인프라 ────────────────────────────────────────────────────────────

describe("CT-0 인프라", () => {
  it("CT-001 /api/health 200", async () => {
    const r = await anon.get("/api/health");
    assert.equal(r.status, 200, r.text);
  });
});

// ─── CT-1. 인증 ──────────────────────────────────────────────────────────────

describe("CT-1 인증", () => {
  it("CT-101 정상 로그인 → 세션 쿠키", async () => {
    const r = await adminA.login("admin@company-a.test", PASSWORD);
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "email"), "admin@company-a.test");
    assert.ok(adminA.hasCookie("session"), "session 쿠키 미발급");
    // 이후 시나리오용 로그인
    assert.equal((await sysadmin.login("sysadmin@test", PASSWORD)).status, 200);
    assert.equal((await memberA.login("member@company-a.test", PASSWORD)).status, 200);
    assert.equal((await adminB.login("admin@company-b.test", PASSWORD)).status, 200);
  });

  it("CT-102 잘못된 비밀번호 401", async () => {
    const c = new Client();
    const r = await c.login("admin@company-a.test", "wrong-password-1!");
    assert.equal(r.status, 401, r.text);
    assert.ok(!c.hasCookie("session"));
  });

  it("CT-103 미인증 보호 API 차단 (로그인 리다이렉트)", async () => {
    // proxy.ts 인증 가드 — 쿠키 없으면 /login 리다이렉트 (데이터 미노출이 계약)
    const r = await anon.get("/api/jobs");
    assert.ok(
      [301, 302, 303, 307, 308].includes(r.status) || r.status === 401,
      `차단 안 됨: ${r.status} ${r.text.slice(0, 100)}`
    );
    if (r.status !== 401) {
      const loc = r.headers.get("location") ?? "";
      assert.ok(loc.includes("/login"), `리다이렉트 목적지 이상: ${loc}`);
    }
  });

  it("CT-104 로그아웃 → 서버측 세션 무효화", async () => {
    const c = new Client();
    await c.login("member@company-a.test", PASSWORD);
    const cookie = c.getCookie("session");
    assert.ok(cookie);
    const out = await c.post("/api/auth/logout");
    assert.ok(out.status < 300, out.text);
    const r = await new Client().get("/api/jobs", { Cookie: `session=${cookie}` });
    assert.equal(r.status, 401, "로그아웃된 세션이 여전히 유효함");
  });

  it("CT-105 로그인 5회 실패 → 429 rate_limited", async () => {
    const c = new Client();
    for (let i = 0; i < 5; i++) {
      const r = await c.login("ratelimit@company-a.test", "bad-pass-1!");
      assert.equal(r.status, 401, `${i + 1}회차: ${r.text}`);
    }
    const locked = await c.login("ratelimit@company-a.test", "bad-pass-1!");
    assert.equal(locked.status, 429, locked.text);
    assert.equal(field(locked.body, "code"), "rate_limited");
  });

  it("CT-106 이메일 미인증 로그인 403 email_unverified", async () => {
    const r = await new Client().login("unverified@company-a.test", PASSWORD);
    assert.equal(r.status, 403, r.text);
    assert.equal(field(r.body, "code"), "email_unverified");
  });
});

// ─── CT-2. 테넌시 / 권한 격리 ────────────────────────────────────────────────

describe("CT-2 테넌시/권한", () => {
  let bCand = 0;

  it("CT-201 타 법인 공고 404 위장", async () => {
    bCand = await insertCandidate({
      orgId: ids.orgB,
      jobId: ids.jobB,
      name: "B사 후보",
      email: "b-cand@example.com",
    });
    const r = await adminA.get(`/api/jobs/${ids.jobB}`);
    assert.equal(r.status, 404, r.text);
  });

  it("CT-202 타 법인 후보자 404", async () => {
    const r = await adminA.get(`/api/candidates/${bCand}`);
    assert.equal(r.status, 404, r.text);
  });

  it("CT-203 member 의 org_admin 전용 API 403", async () => {
    const r = await memberA.get("/api/orgs/members");
    assert.equal(r.status, 403, r.text);
  });

  it("CT-204 member 의 system_admin 전용 API 403", async () => {
    const r = await memberA.patch("/api/admin/pricing", { job_post: 11 });
    assert.equal(r.status, 403, r.text);
  });

  it("CT-205 bulk-delete 에 타 법인 id → 전체 거부", async () => {
    const r = await adminA.post("/api/candidates/bulk-delete", { ids: [bCand] });
    assert.equal(r.status, 403, r.text);
    const alive = await row("SELECT id FROM candidates WHERE id = ?", [bCand]);
    assert.ok(alive, "타 법인 후보가 삭제됨 — 테넌시 붕괴");
  });

  it("CT-206 system_admin 전역 접근 + PIN 우회", async () => {
    const b = await sysadmin.get(`/api/jobs/${ids.jobB}`);
    assert.equal(b.status, 200, b.text);
    const pin = await sysadmin.get(`/api/jobs/${ids.jobAPin}`);
    assert.equal(pin.status, 200, pin.text);
    assert.equal(field(pin.body, "locked"), false);
  });
});

// ─── CT-3. 공고 CRUD + 과금 ──────────────────────────────────────────────────

const JOB_BODY = {
  title: "CT 신규 공고",
  position: "테스트 엔지니어",
  level: "경력",
  employmentType: "정규직",
  responsibilities: "필수 테스트 자동화",
  requirements: "Node.js",
};

describe("CT-3 공고 CRUD/과금", () => {
  it("CT-301 공고 생성 → job_post 차감 + ledger", async () => {
    const before = await walletBalance(ids.orgA);
    const r = await adminA.post("/api/jobs", JOB_BODY);
    assert.equal(r.status, 200, r.text);
    ctx.jobNew = Number(field(r.body, "id"));
    assert.ok(ctx.jobNew > 0);
    assert.equal(await walletBalance(ids.orgA), before - 10, "job_post 10 차감 불일치");
    const led = (await ledgerRows(ids.orgA, "job_post")).filter(
      (l) => l.ref_id === ctx.jobNew
    );
    assert.equal(led.length, 1);
    assert.equal(Number(led[0].delta), -10);
  });

  it("CT-302 필수 필드 누락 400", async () => {
    const r = await adminA.post("/api/jobs", { ...JOB_BODY, title: "" });
    assert.equal(r.status, 400, r.text);
  });

  it("CT-303 공고 수정 반영", async () => {
    const r = await adminA.put(`/api/jobs/${ctx.jobNew}`, {
      ...JOB_BODY,
      title: "CT 수정된 공고",
    });
    assert.equal(r.status, 200, r.text);
    const g = await adminA.get(`/api/jobs/${ctx.jobNew}`);
    assert.equal(field(g.body, "title"), "CT 수정된 공고");
  });

  it("CT-304 5분 내 삭제 → 자동 환불", async () => {
    const before = await walletBalance(ids.orgA);
    const r = await adminA.del(`/api/jobs/${ctx.jobNew}`);
    assert.equal(r.status, 204, r.text);
    assert.equal(await walletBalance(ids.orgA), before + 10, "환불 미반영");
    const refunds = (await ledgerRows(ids.orgA, "refund")).filter(
      (l) => l.ref_id === ctx.jobNew
    );
    assert.equal(refunds.length, 1);
  });

  it("CT-305 잔액 0 → 공고 생성 402", async () => {
    const before = await walletBalance(ids.orgA);
    await setWalletBalance(ids.orgA, 0);
    try {
      const r = await adminA.post("/api/jobs", JOB_BODY);
      assert.equal(r.status, 402, r.text);
      assert.equal(field(r.body, "code"), "insufficient_tokens");
    } finally {
      await setWalletBalance(ids.orgA, before);
    }
  });

  it("CT-306 PIN 공고 잠금/해제", async () => {
    const locked = await memberA.get(`/api/jobs/${ids.jobAPin}`);
    assert.equal(locked.status, 403, locked.text);
    assert.equal(field(locked.body, "locked"), true);
    const bad = await memberA.post(`/api/jobs/${ids.jobAPin}/unlock`, { password: "9999" });
    assert.equal(bad.status, 401, bad.text);
    const ok = await memberA.post(`/api/jobs/${ids.jobAPin}/unlock`, { password: "1234" });
    assert.equal(ok.status, 204, ok.text);
    const open = await memberA.get(`/api/jobs/${ids.jobAPin}`);
    assert.equal(open.status, 200, open.text);
    assert.equal(field(open.body, "locked"), false);
  });
});

// ─── CT-4. 이력서 인입 — HR 업로드 ───────────────────────────────────────────

describe("CT-4 HR 업로드", () => {
  it("CT-401 정상 업로드 → 후보 생성 + 큐 등록 + 과금 0", async () => {
    const r = await adminA.postForm(
      `/api/jobs/${ids.jobA}/candidates`,
      form({
        applicantConsentConfirmed: "true",
        name: "Upload Kim",
        email: "upload1@example.com",
        file: { buf: ctx.pdfA, name: `${RUN_TAG}-resume-a.pdf` },
      })
    );
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "created"), 1, r.text);
    const cand = await row<{ id: number; resume_file_path: string }>(
      "SELECT id, resume_file_path FROM candidates WHERE job_id = ? AND email = ?",
      [ids.jobA, "upload1@example.com"]
    );
    assert.ok(cand, "후보 row 미생성");
    ctx.candUpload = Number(cand.id);
    ctx.candUploadFile = String(cand.resume_file_path ?? "");
    const q = await row("SELECT status FROM screening_jobs WHERE candidate_id = ?", [
      ctx.candUpload,
    ]);
    assert.ok(q, "screening_jobs 미등록");
    assert.equal((await ledgerRows(ids.orgA, "resume_upload")).length, 0, "후차감 전 과금 발생");
  });

  it("CT-402 같은 파일 재업로드 → 중복 거부", async () => {
    const r = await adminA.postForm(
      `/api/jobs/${ids.jobA}/candidates`,
      form({
        applicantConsentConfirmed: "true",
        file: { buf: ctx.pdfA, name: `${RUN_TAG}-resume-a-again.pdf` },
      })
    );
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "created"), 0, r.text);
    assert.equal(field(r.body, "failed"), 1, r.text);
  });

  it("CT-403 동의 미체크 400 applicant_consent_required", async () => {
    const r = await adminA.postForm(
      `/api/jobs/${ids.jobA}/candidates`,
      form({ file: { buf: ctx.pdfC, name: `${RUN_TAG}-noconsent.pdf` } })
    );
    assert.equal(r.status, 400, r.text);
    assert.equal(field(r.body, "code"), "applicant_consent_required");
  });

  it("CT-404 확장자 위장 파일 → 매직바이트 거부", async () => {
    const r = await adminA.postForm(
      `/api/jobs/${ids.jobA}/candidates`,
      form({
        applicantConsentConfirmed: "true",
        file: { buf: Buffer.from("this is not a pdf at all"), name: `${RUN_TAG}-fake.pdf` },
      })
    );
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "created"), 0, r.text);
    assert.ok(Number(field(r.body, "failed")) >= 1, r.text);
  });

  it("CT-405 잔액 0 → 업로드 402", async () => {
    const before = await walletBalance(ids.orgA);
    await setWalletBalance(ids.orgA, 0);
    try {
      const r = await adminA.postForm(
        `/api/jobs/${ids.jobA}/candidates`,
        form({
          applicantConsentConfirmed: "true",
          file: { buf: ctx.pdfC, name: `${RUN_TAG}-broke.pdf` },
        })
      );
      assert.equal(r.status, 402, r.text);
    } finally {
      await setWalletBalance(ids.orgA, before);
    }
  });

  it("CT-406 잠긴 공고 업로드 403", async () => {
    const fresh = new Client(); // PIN 해제 쿠키 없는 새 세션
    await fresh.login("member@company-a.test", PASSWORD);
    const r = await fresh.postForm(
      `/api/jobs/${ids.jobAPin}/candidates`,
      form({
        applicantConsentConfirmed: "true",
        file: { buf: ctx.pdfC, name: `${RUN_TAG}-locked.pdf` },
      })
    );
    assert.equal(r.status, 403, r.text);
  });
});

// ─── CT-5. 지원자 셀프 지원 ──────────────────────────────────────────────────

describe("CT-5 셀프 지원", () => {
  it("CT-501 정상 지원 → 후보 생성 + 동의 기록 + 큐 등록", async () => {
    const r = await anon.postForm(
      `/api/apply/${APPLY_TOKEN_A}`,
      form({
        name: "Apply Lee",
        email: "apply1@example.com",
        phone: "010-2222-3333",
        consent_collection_use: "true",
        consent_ai_decision: "true",
        file: { buf: ctx.pdfB, name: `${RUN_TAG}-apply-b.pdf` },
      })
    );
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "ok"), true);
    const cand = await row<{
      id: number;
      source: string;
      applicant_consent_confirmed_at: string | null;
    }>(
      "SELECT id, source, applicant_consent_confirmed_at FROM candidates WHERE job_id = ? AND email = ?",
      [ids.jobA, "apply1@example.com"]
    );
    assert.ok(cand, "지원자 row 미생성");
    ctx.candApply = Number(cand.id);
    assert.equal(cand.source, "apply_link");
    assert.ok(cand.applicant_consent_confirmed_at, "동의 시각 미기록");
    const q = await row("SELECT status FROM screening_jobs WHERE candidate_id = ?", [
      ctx.candApply,
    ]);
    assert.ok(q, "screening_jobs 미등록");
  });

  it("CT-502 같은 이메일 재지원 409 already_applied", async () => {
    const r = await anon.postForm(
      `/api/apply/${APPLY_TOKEN_A}`,
      form({
        email: "apply1@example.com",
        consent_collection_use: "true",
        consent_ai_decision: "true",
        file: { buf: ctx.pdfC, name: `${RUN_TAG}-apply-c.pdf` },
      })
    );
    assert.equal(r.status, 409, r.text);
    assert.equal(field(r.body, "code"), "already_applied");
  });

  it("CT-503 동의 누락 400 consent_required", async () => {
    const r = await anon.postForm(
      `/api/apply/${APPLY_TOKEN_A}`,
      form({
        email: "apply2@example.com",
        consent_ai_decision: "true",
        file: { buf: ctx.pdfC, name: `${RUN_TAG}-apply-c2.pdf` },
      })
    );
    assert.equal(r.status, 400, r.text);
    assert.equal(field(r.body, "code"), "consent_required");
  });

  it("CT-504 잔액 0 이어도 지원 접수 성공 (지원자 유실 방지)", async () => {
    const before = await walletBalance(ids.orgA);
    await setWalletBalance(ids.orgA, 0);
    try {
      const r = await anon.postForm(
        `/api/apply/${APPLY_TOKEN_A}`,
        form({
          email: "apply3@example.com",
          consent_collection_use: "true",
          consent_ai_decision: "true",
          file: { buf: ctx.pdfD, name: `${RUN_TAG}-apply-d.pdf` },
        })
      );
      assert.equal(r.status, 200, r.text);
      assert.equal(field(r.body, "ok"), true);
      const cand = await row<{ id: number }>(
        "SELECT id FROM candidates WHERE job_id = ? AND email = ?",
        [ids.jobA, "apply3@example.com"]
      );
      assert.ok(cand);
      const q = await row<{ status: string }>(
        "SELECT status FROM screening_jobs WHERE candidate_id = ?",
        [Number(cand.id)]
      );
      assert.ok(q && ["queued", "paused"].includes(String(q.status)), `큐 상태 이상: ${q?.status}`);
    } finally {
      await setWalletBalance(ids.orgA, before);
    }
  });

  it("CT-505 무효 지원 토큰 404", async () => {
    const r = await anon.postForm(
      `/api/apply/ct-no-such-token`,
      form({
        email: "x@example.com",
        consent_collection_use: "true",
        consent_ai_decision: "true",
        file: { buf: ctx.pdfC, name: `${RUN_TAG}-apply-x.pdf` },
      })
    );
    assert.equal(r.status, 404, r.text);
  });
});

// ─── CT-6. 서류 평가 큐 (LLM 경계) ───────────────────────────────────────────

describe("CT-6 서류 평가 큐", () => {
  it("CT-601 워커 무인증 401", async () => {
    const r = await anon.post("/api/internal/process-screenings");
    assert.equal(r.status, 401, r.text);
  });

  it("CT-602 워커 실행 — LLM 실패 시 과금 0 + 상태 오염 없음", { timeout: 180_000 }, async () => {
    const r = await anon.post("/api/internal/process-screenings", undefined, {
      "X-Internal-Secret": INTERNAL_SECRET,
    });
    assert.equal(r.status, 200, r.text);
    // 평가 성공이 없어야 하므로: 과금 0 + 후보 미승격 + 큐는 재시도/실패
    assert.equal(
      (await ledgerRows(ids.orgA, "resume_upload")).length,
      0,
      "LLM 실패인데 과금 발생 — 후차감 원칙 위반"
    );
    for (const cid of [ctx.candUpload, ctx.candApply]) {
      const cand = await row<{ stage: string; screening_report: string | null }>(
        "SELECT stage, screening_report FROM candidates WHERE id = ?",
        [cid]
      );
      assert.ok(cand);
      assert.notEqual(cand.stage, "screened", `후보 ${cid} 가 평가 없이 screened 로 오염`);
      assert.equal(cand.screening_report, null, `후보 ${cid} 에 가짜 평가 리포트 생성`);
      const q = await row<{ status: string; attempts: number }>(
        "SELECT status, attempts FROM screening_jobs WHERE candidate_id = ? ORDER BY id DESC",
        [cid]
      );
      assert.ok(q);
      assert.ok(
        ["queued", "failed", "processing"].includes(String(q.status)),
        `큐 상태 이상: ${q.status}`
      );
    }
  });

  it("CT-603 queued 후보 단건 재트리거 2xx", async () => {
    const r = await adminA.post(`/api/candidates/${ctx.candUpload}/screen`);
    assert.ok(r.status === 200, r.text);
    assert.equal(field(r.body, "ok"), true);
  });
});

// ─── CT-7. AI 면접 토큰 플로우 ───────────────────────────────────────────────

describe("CT-7 AI 면접 플로우", () => {
  const consents = { collection_use: true, cross_border: true };
  const AI_EMAIL = "cai@example.com";

  it("CT-701 서류평가 없는 후보 발급 409 screening_required", async () => {
    ctx.cAi = await insertCandidate({
      orgId: ids.orgA,
      jobId: ids.jobA,
      name: "AI 면접 후보",
      email: AI_EMAIL,
    });
    const r = await adminA.post(`/api/candidates/${ctx.cAi}/interview-link`, {});
    assert.equal(r.status, 409, r.text);
    assert.equal(field(r.body, "code"), "screening_required");
  });

  it("CT-702 리포트 주입 후 발급 → 세션 + stage 전환 + 과금 0", async () => {
    await injectScreeningReport(ctx.cAi);
    const r = await adminA.post(`/api/candidates/${ctx.cAi}/interview-link`, {});
    assert.equal(r.status, 200, r.text);
    ctx.aiToken1 = String(field(r.body, "accessToken") ?? "");
    ctx.aiSession1 = Number(field(r.body, "id") ?? 0);
    assert.ok(ctx.aiToken1.length > 10, "accessToken 없음");
    const cand = await row<{ stage: string }>("SELECT stage FROM candidates WHERE id = ?", [
      ctx.cAi,
    ]);
    assert.equal(cand?.stage, "ai_pending");
    assert.equal((await ledgerRows(ids.orgA, "interview")).length, 0, "발급 시점 과금 발생");
  });

  it("CT-703 세션 GET — 동의 요구 + 민감 필드 비노출", async () => {
    const r = await anon.get(`/api/interview/${ctx.aiToken1}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "consentRequired"), true);
    assert.ok(!r.text.includes('"personalityResponses"'), "인성검사 원응답 노출");
    assert.ok(!r.text.includes('"evaluation"'), "평가 노출");
  });

  it("CT-704 무효 토큰 404", async () => {
    const r = await anon.get(`/api/interview/ct-no-such-interview-token`);
    assert.equal(r.status, 404, r.text);
  });

  it("CT-705 동의 전 chat 403 consent_required", async () => {
    const r = await anon.post(`/api/interview/${ctx.aiToken1}/chat`, {
      userMessage: "안녕하세요",
    });
    assert.equal(r.status, 403, r.text);
    assert.equal(field(r.body, "code"), "consent_required");
  });

  it("CT-706 complete 게이트 — 대화 부족 400 / 동의 없음 403", async () => {
    const short = await anon.post(`/api/interview/${ctx.aiToken1}/complete`, {});
    assert.equal(short.status, 400, short.text);
    await exec(
      `UPDATE interview_sessions SET messages = ? WHERE id = ?`,
      [
        JSON.stringify([
          { role: "model", content: "자기소개 부탁드립니다." },
          { role: "user", content: "안녕하세요, 백엔드 개발자입니다." },
        ]),
        ctx.aiSession1,
      ]
    );
    const noConsent = await anon.post(`/api/interview/${ctx.aiToken1}/complete`, {});
    assert.equal(noConsent.status, 403, noConsent.text);
    assert.equal(field(noConsent.body, "code"), "consent_required");
    await exec(`UPDATE interview_sessions SET messages = '[]' WHERE id = ?`, [ctx.aiSession1]);
  });

  it("CT-707 동의 이메일 불일치 403 email_mismatch", async () => {
    // 새 세션 발급 (동의 성공 시나리오 전용 — 앞 세션과 분리)
    const link = await adminA.post(`/api/candidates/${ctx.cAi}/interview-link`, {});
    assert.equal(link.status, 200, link.text);
    ctx.aiToken2 = String(field(link.body, "accessToken") ?? "");
    const r = await anon.post(`/api/interview/${ctx.aiToken2}/consent`, {
      consents,
      email: "someone-else@example.com",
    });
    assert.equal(r.status, 403, r.text);
    assert.equal(field(r.body, "code"), "email_mismatch");
  });

  it("CT-708 정상 동의 → 기록 + consentRequired 해제", async () => {
    const r = await anon.post(`/api/interview/${ctx.aiToken2}/consent`, {
      consents,
      email: AI_EMAIL,
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "ok"), true);
    assert.ok(field(r.body, "consentVersion"));
    const g = await anon.get(`/api/interview/${ctx.aiToken2}`);
    assert.equal(field(g.body, "consentRequired"), false);
  });

  it("CT-711 인성검사 — 출제/게이트/채점/멱등", async () => {
    await exec(`UPDATE organizations SET culture_fit_profile = ? WHERE id = ?`, [
      JSON.stringify({ idealTalent: "성실하고 주도적인 인재" }),
      ids.orgA,
    ]);
    try {
      const g = await anon.get(`/api/interview/${ctx.aiToken2}`);
      const personality = field<{ required: boolean; items?: Array<{ id: string; a: string; b: string }> }>(
        g.body,
        "personality"
      );
      assert.equal(personality?.required, true, g.text);
      const items = personality?.items ?? [];
      assert.ok(items.length > 0, "인성검사 문항 없음");
      assert.ok(items[0].id && items[0].a && items[0].b, "문항 형식 이상");
      assert.ok(!JSON.stringify(items[0]).includes("trait"), "특성 태그 노출");

      const gate = await anon.post(`/api/interview/${ctx.aiToken2}/chat`, {
        userMessage: "시작합니다",
      });
      assert.equal(gate.status, 403, gate.text);
      assert.equal(field(gate.body, "code"), "personality_required");

      const submit = await anon.post(`/api/interview/${ctx.aiToken2}/personality`, {
        responses: items.map((it) => ({ itemId: it.id, value: 1 as const })),
        elapsedMs: 60_000,
      });
      assert.equal(submit.status, 200, submit.text);
      const saved = await row<{ personality_profile: string | null }>(
        "SELECT personality_profile FROM interview_sessions WHERE access_token = ?",
        [ctx.aiToken2]
      );
      assert.ok(saved?.personality_profile, "채점 결과 미저장");

      const again = await anon.post(`/api/interview/${ctx.aiToken2}/personality`, {
        responses: items.map((it) => ({ itemId: it.id, value: 2 as const })),
        elapsedMs: 1_000,
      });
      assert.ok(again.status < 300, again.text);
      const saved2 = await row<{ personality_profile: string | null }>(
        "SELECT personality_profile FROM interview_sessions WHERE access_token = ?",
        [ctx.aiToken2]
      );
      assert.equal(saved2?.personality_profile, saved?.personality_profile, "재제출이 결과를 덮어씀 (멱등 위반)");
    } finally {
      await exec(`UPDATE organizations SET culture_fit_profile = NULL WHERE id = ?`, [ids.orgA]);
    }
  });

  it("CT-709 만료 세션 — GET expired / chat 400", async () => {
    ctx.cExp = await insertCandidate({
      orgId: ids.orgA,
      jobId: ids.jobA,
      name: "만료 후보",
      email: "cexp@example.com",
    });
    const token = `ct-expired-${RUN_TAG}`;
    await insertSession({ candidateId: ctx.cExp, accessToken: token, expiresAt: pastIso(HOUR) });
    const g = await anon.get(`/api/interview/${token}`);
    assert.equal(g.status, 200, g.text);
    assert.equal(field(g.body, "expired"), true);
    const chat = await anon.post(`/api/interview/${token}/chat`, { userMessage: "hi" });
    assert.equal(chat.status, 400, chat.text);
  });

  it("CT-710 cron 만료 처리 — pending 만료 자동 불합격", async () => {
    ctx.cCron = await insertCandidate({
      orgId: ids.orgA,
      jobId: ids.jobA,
      name: "크론 후보",
      email: "ccron@example.com",
    });
    const token = `ct-cron-${RUN_TAG}`;
    const sid = await insertSession({
      candidateId: ctx.cCron,
      accessToken: token,
      expiresAt: pastIso(HOUR),
    });
    const noAuth = await anon.get("/api/cron/expire-interviews");
    assert.equal(noAuth.status, 401, noAuth.text);
    const r = await anon.get("/api/cron/expire-interviews", {
      Authorization: `Bearer ${CRON_SECRET}`,
    });
    assert.equal(r.status, 200, r.text);
    const sess = await row<{ status: string }>(
      "SELECT status FROM interview_sessions WHERE id = ?",
      [sid]
    );
    assert.equal(sess?.status, "expired");
    const cand = await row<{ outcome: string | null; outcome_reason: string | null }>(
      "SELECT outcome, outcome_reason FROM candidates WHERE id = ?",
      [ctx.cCron]
    );
    assert.equal(cand?.outcome, "rejected");
    assert.equal(cand?.outcome_reason, "ai_link_expired");
  });

  it("CT-712 지원 취소 withdraw", async () => {
    ctx.cWd = await insertCandidate({
      orgId: ids.orgA,
      jobId: ids.jobA,
      name: "취소 후보",
      email: "cwd@example.com",
    });
    const token = `ct-withdraw-${RUN_TAG}`;
    const sid = await insertSession({
      candidateId: ctx.cWd,
      accessToken: token,
      expiresAt: futureIso(3 * DAY),
    });
    const r = await anon.post(`/api/interview/${token}/withdraw`, { email: "cwd@example.com" });
    assert.ok(r.status < 300, r.text);
    const sess = await row<{ status: string }>(
      "SELECT status FROM interview_sessions WHERE id = ?",
      [sid]
    );
    assert.equal(sess?.status, "expired");
    const cand = await row<{ outcome: string | null }>(
      "SELECT outcome FROM candidates WHERE id = ?",
      [ctx.cWd]
    );
    assert.equal(cand?.outcome, "withdrawn");
  });
});

// ─── CT-8. 후보자 데이터 보호 / 권리 ─────────────────────────────────────────

describe("CT-8 데이터 보호/권리", () => {
  it("CT-801 후보 상세 GET — resumeText 원문 비노출", async () => {
    const r = await adminA.get(`/api/candidates/${ctx.cAi}`);
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes('"resumeText"'), "resumeText 원문이 응답에 포함됨 (보안 회귀)");
  });

  it("CT-802 본인 데이터 열람 (me POST)", async () => {
    const r = await anon.post(`/api/interview/${ctx.aiToken2}/me`, { email: "cai@example.com" });
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "email"), "cai@example.com");
  });

  it("CT-803 본인 데이터 즉시 파기 (me DELETE) — 평가는 보존", async () => {
    const r = await anon.del(`/api/interview/${ctx.aiToken2}/me`, { email: "cai@example.com" });
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "ok"), true);
    const cand = await row<{
      phone: string | null;
      resume_masked_text: string | null;
      resume_file_path: string | null;
      screening_report: string | null;
    }>(
      "SELECT phone, resume_masked_text, resume_file_path, screening_report FROM candidates WHERE id = ?",
      [ctx.cAi]
    );
    assert.ok(cand);
    assert.ok(!cand.phone, "전화번호 잔존");
    assert.ok(!cand.resume_masked_text, "이력서 본문 잔존");
    assert.ok(!cand.resume_file_path, "파일 경로 잔존");
    assert.ok(cand.screening_report, "평가 결과가 함께 삭제됨 (§36 보존 원칙 위반)");
  });

  it("CT-804 후보 삭제 → row + 로컬 파일 삭제", async () => {
    assert.ok(ctx.candUploadFile, "업로드 파일 키 없음");
    const filePath = path.join(ROOT, "uploads", ctx.candUploadFile);
    assert.ok(existsSync(filePath), `업로드 파일이 애초에 없음: ${filePath}`);
    const r = await adminA.del(`/api/candidates/${ctx.candUpload}`);
    assert.equal(r.status, 204, r.text);
    assert.ok(!(await row("SELECT id FROM candidates WHERE id = ?", [ctx.candUpload])));
    assert.ok(!existsSync(filePath), "후보 삭제 후 파일 잔존");
  });

  it("CT-805 공고 삭제 → 소속 후보/세션 연쇄 정리", async () => {
    const j = await adminA.post("/api/jobs", { ...JOB_BODY, title: "CT 삭제용 공고" });
    assert.equal(j.status, 200, j.text);
    const jobId = Number(field(j.body, "id"));
    const cid = await insertCandidate({
      orgId: ids.orgA,
      jobId,
      name: "연쇄 후보",
      email: "cascade@example.com",
    });
    const sid = await insertSession({
      candidateId: cid,
      accessToken: `ct-cascade-${RUN_TAG}`,
      expiresAt: futureIso(DAY),
    });
    const r = await adminA.del(`/api/jobs/${jobId}`);
    assert.equal(r.status, 204, r.text);
    assert.ok(!(await row("SELECT id FROM candidates WHERE id = ?", [cid])), "후보 잔존");
    assert.ok(!(await row("SELECT id FROM interview_sessions WHERE id = ?", [sid])), "세션 잔존");
  });
});

// ─── CT-9. 대면 면접 일정 (지원자 응답) ──────────────────────────────────────

describe("CT-9 대면 일정", () => {
  it("CT-901 SMTP 미설정 일정 제시 → 503 명시 실패", async () => {
    ctx.cSched = await insertCandidate({
      orgId: ids.orgA,
      jobId: ids.jobA,
      name: "일정 후보",
      email: "csched@example.com",
      stage: "round1_candidate",
    });
    const r = await adminA.post(`/api/jobs/${ids.jobA}/schedule-propose`, {
      candidateIds: [ctx.cSched],
      slots: [{ start: futureIso(2 * DAY), end: futureIso(2 * DAY + HOUR) }],
    });
    assert.equal(r.status, 503, r.text);
    assert.equal(field(r.body, "code"), "smtp_not_configured");
  });

  it("CT-902 공개 일정 GET — 슬롯 노출", async () => {
    const slots = [
      { start: futureIso(2 * DAY), end: futureIso(2 * DAY + HOUR) },
      { start: futureIso(3 * DAY), end: futureIso(3 * DAY + HOUR) },
    ];
    await insertSchedule({
      candidateId: ctx.cSched,
      jobId: ids.jobA,
      orgId: ids.orgA,
      accessToken: ctx.schedToken,
      slots,
      expiresAt: futureIso(7 * DAY),
    });
    const r = await anon.get(`/api/schedule/${ctx.schedToken}`);
    assert.equal(r.status, 200, r.text);
    const proposed = field<Array<{ start: string }>>(r.body, "proposedSlots");
    assert.equal(proposed?.length, 2);
  });

  it("CT-903 지원자 슬롯 선택 → 확정 (메일 불가 환경에서도 성공)", async () => {
    const r = await anon.post(`/api/schedule/${ctx.schedToken}/select`, { slotIndex: 0 });
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "ok"), true);
    assert.ok(field(r.body, "selectedSlot"));
  });

  it("CT-904 재선택 409", async () => {
    const r = await anon.post(`/api/schedule/${ctx.schedToken}/select`, { slotIndex: 1 });
    assert.equal(r.status, 409, r.text);
  });
});

// ─── CT-10. 토큰 지갑 정합성 (lib 단위) ──────────────────────────────────────

describe("CT-10 지갑 정합성", () => {
  it("CT-1001 chargeFeature 멱등", async () => {
    const before = await walletBalance(ids.orgB);
    const r1 = await tokens.chargeFeature({
      orgId: ids.orgB,
      feature: "resume_upload",
      refType: "ct_unit",
      refId: 9001,
    });
    assert.equal(r1.cost, 5);
    assert.ok(!r1.alreadyCharged);
    const r2 = await tokens.chargeFeature({
      orgId: ids.orgB,
      feature: "resume_upload",
      refType: "ct_unit",
      refId: 9001,
    });
    assert.equal(r2.alreadyCharged, true);
    assert.equal(await walletBalance(ids.orgB), before - 5, "이중 차감");
    const led = (await ledgerRows(ids.orgB, "resume_upload")).filter(
      (l) => l.ref_type === "ct_unit"
    );
    assert.equal(led.length, 1);
  });

  it("CT-1002 refundFeature 멱등", async () => {
    const before = await walletBalance(ids.orgB);
    const r1 = await tokens.refundFeature({
      orgId: ids.orgB,
      feature: "resume_upload",
      refType: "ct_unit",
      refId: 9001,
    });
    assert.ok(r1.refunded, "환불 미실행"); // refunded = 환불액
    assert.equal(await walletBalance(ids.orgB), before + 5);
    const r2 = await tokens.refundFeature({
      orgId: ids.orgB,
      feature: "resume_upload",
      refType: "ct_unit",
      refId: 9001,
    });
    assert.ok(!r2.refunded, "이중 환불");
    assert.equal(await walletBalance(ids.orgB), before + 5);
  });

  it("CT-1003 chargeRepeatable 회차 분리 과금", async () => {
    const before = await walletBalance(ids.orgB);
    for (let i = 0; i < 3; i++) {
      await tokens.chargeRepeatable({
        orgId: ids.orgB,
        feature: "resume_upload",
        baseRefType: "ct_rep",
        refId: 9002,
      });
    }
    assert.equal(await walletBalance(ids.orgB), before - 15, "회차별 과금 불일치");
    const led = (await ledgerRows(ids.orgB, "resume_upload")).filter((l) =>
      String(l.ref_type).startsWith("ct_rep")
    );
    const refTypes = led.map((l) => l.ref_type).sort();
    assert.deepEqual(refTypes, ["ct_rep", "ct_rep_re1", "ct_rep_re2"]);
  });

  it("CT-1005 requireSpendableBalance 가드", async () => {
    const okB = await walletGuard.requireSpendableBalance(ids.orgB, {});
    assert.equal(okB.ok, true);
    const beforeA = await walletBalance(ids.orgA);
    await setWalletBalance(ids.orgA, 0);
    try {
      const denied = await walletGuard.requireSpendableBalance(ids.orgA, {});
      assert.equal(denied.ok, false);
      const sys = await walletGuard.requireSpendableBalance(ids.orgA, { isSystemAdmin: true });
      assert.equal(sys.ok, true, "system_admin 통과 실패");
      const noOrg = await walletGuard.requireSpendableBalance(null, {});
      assert.equal(noOrg.ok, true, "orgId null 통과 실패");
    } finally {
      await setWalletBalance(ids.orgA, beforeA);
    }
  });

  it("CT-1006 동일 ref 병렬 차감 ×5 → 1회만 반영", async () => {
    const before = await walletBalance(ids.orgB);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        tokens.chargeFeature({
          orgId: ids.orgB,
          feature: "resume_upload",
          refType: "ct_par",
          refId: 9003,
        })
      )
    );
    assert.equal(await walletBalance(ids.orgB), before - 5, "병렬 이중 차감");
    const led = (await ledgerRows(ids.orgB, "resume_upload")).filter(
      (l) => l.ref_type === "ct_par"
    );
    assert.equal(led.length, 1);
  });

  it("CT-1004 ledger 체인 == wallet 잔액 (최종 정합)", async () => {
    const led = await ledgerRows(ids.orgB);
    const sum = led.reduce((acc, l) => acc + Number(l.delta), 0);
    assert.equal(sum, await walletBalance(ids.orgB), "ledger 합계 ≠ 지갑 잔액");
    // balance_after 체인도 마지막 행과 일치해야 한다
    const last = led[led.length - 1];
    assert.equal(Number(last.balance_after), await walletBalance(ids.orgB));
  });
});

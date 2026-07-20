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
import { makeResumeDocx, makeResumePdf } from "./fixtures";
// CT-11 은 DB 를 타지 않는 순수 함수라 정적 import 로 충분하다(CT-10 과 달리 lib/db 미의존).
import { extractEducation } from "../../lib/education-extract";
import { extractPhotoFromBuffer } from "../../lib/photo-extract";
import { extractPII } from "../../lib/pii-extract";
import { maskText } from "../../lib/mask";
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
        referrer: "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=123",
        file: { buf: ctx.pdfB, name: `${RUN_TAG}-apply-b.pdf` },
      })
    );
    assert.equal(r.status, 200, r.text);
    assert.equal(field(r.body, "ok"), true);
    const cand = await row<{
      id: number;
      source: string;
      apply_referrer_host: string | null;
      applicant_consent_confirmed_at: string | null;
    }>(
      "SELECT id, source, apply_referrer_host, applicant_consent_confirmed_at FROM candidates WHERE job_id = ? AND email = ?",
      [ids.jobA, "apply1@example.com"]
    );
    assert.ok(cand, "지원자 row 미생성");
    ctx.candApply = Number(cand.id);
    assert.equal(cand.source, "apply_link");
    // referrer 는 호스트만 저장 (경로·쿼리 버림 — 유입 채용사이트 식별용)
    assert.equal(cand.apply_referrer_host, "www.saramin.co.kr");
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

/**
 * CT-11 이력서 추출 판정 (lib 단위 직접 호출)
 *
 * 2026-07-20 사고 회귀 방지 — 이력서 하나에서 두 오판이 동시에 났다:
 *  ① 스킬 줄 "한글/MS워드" 의 `MS` 가 석사로 잡혀 실제 학사 학력을 덮어씀
 *  ② 증명사진 대신 포트폴리오 스크린샷이 추출됨(면적 최대 선택 로직)
 * 둘 다 화면에 드러나기 전엔 조용히 틀리는 종류라 여기서 결과를 고정한다.
 */
describe("CT-11 이력서 추출 판정", () => {
  const resume = (body: string) => `홍길동\n${body}\n010-0000-0000`;

  it("CT-1101 스킬·경력 표현을 학위로 오탐하지 않는다", () => {
    // 전부 실제 이력서에 흔한 표현 — 학위 단서가 아니다
    for (const line of [
      "한글/MS워드", // ← 2026-07-20 사고 원인
      "MS Office, MS SQL, MS Teams 활용",
      "Scrum Master 자격 보유",
      "git master branch 운영",
      "Business Analyst(BA) 로 근무",
      "데이터 분석 사례를 정리했습니다",
      "매출 분석 사업 참여",
      "박 사원과 협업",
      "입학 사정관 전형 안내",
    ]) {
      assert.equal(extractEducation(resume(line)).level, null, `오탐: "${line}"`);
    }
  });

  it("CT-1102 실제 학위 표기는 그대로 인식한다", () => {
    const cases: [string, string][] = [
      ["서울대학교 컴퓨터공학 석사 졸업", "석사 졸업"],
      ["공학석사", "석사"],
      ["석사학위 취득", "석사"],
      ["석 사 졸업", "석사 졸업"], // PDF 자간 벌어짐
      ["Master's degree in Computer Science", "석사"],
      ["M.S. in Computer Engineering", "석사"],
      ["MBA 취득", "석사"],
      ["박사 졸업", "박사 졸업"],
      ["Ph.D in Physics", "박사"],
      ["Bachelor's degree", "학사"],
      ["B.S. in Computer Science", "학사"],
      ["컴퓨터공학부", "학사"],
      ["전문학사 졸업", "전문학사 졸업"],
      ["○○고등학교 졸업", "고졸"],
    ];
    for (const [line, expect] of cases) {
      assert.equal(extractEducation(resume(line)).level, expect, `정탐 실패: "${line}"`);
    }
  });

  it("CT-1103 스킬 섹션이 학력 섹션을 덮어쓰지 않는다", () => {
    // 사고 이력서의 실제 구조 — 학력(앞) + 보유기술(뒤)
    const text = [
      "□ 학력사항",
      "한신대학교",
      "컴퓨터공학부",
      "졸업",
      "□ 보유기술",
      "한글/MS워드",
    ].join("\n");
    const edu = extractEducation(text);
    assert.equal(edu.level, "학사", "스킬 줄이 학력을 덮어씀");
    assert.equal(edu.school, "한신대학교");
  });

  it("CT-1104 증명사진 = 본문 첫 인물형 이미지 (크기·ZIP 순서와 무관)", async () => {
    // 증명사진이 포트폴리오 스크린샷보다 작고, ZIP 에는 스크린샷이 먼저 저장된 배치.
    // 면적 최대(구 로직)나 ZIP 순서로 고르면 둘 다 스크린샷을 집는다.
    const docx = makeResumeDocx(
      [
        { file: "photo.png", w: 235, h: 302 }, // 본문 1번 = 증명사진
        { file: "screenshot.png", w: 532, h: 607 }, // 본문 2번 = 더 큰 스크린샷
      ],
      ["screenshot.png", "photo.png"] // ZIP 엔트리는 역순
    );
    const photo = await extractPhotoFromBuffer(docx, "resume.docx");
    assert.ok(photo, "사진을 추출하지 못함");
    assert.equal(photo.data.readUInt32BE(16), 235, "본문 첫 이미지가 아닌 것을 선택");
    assert.equal(photo.data.readUInt32BE(20), 302);
  });

  it("CT-1106 미기입 학위 행(빈 템플릿)을 최종학력으로 잡지 않는다", () => {
    // 표 양식 이력서는 셀 하나가 한 줄씩, 사이에 빈 줄을 두고 분해된다.
    // 마지막 "대학원(박사)" 행은 라벨 + YYYY.MM 플레이스홀더뿐인 미기입 템플릿 —
    // 라벨만 보고 판정하면 박사가 되고, 전공은 엉뚱한 학사 행에서 주워온다.
    const cell = (...v: string[]) => v.flatMap((x) => [x, ""]);
    const text = [
      ...cell("구    분", "입학년월", "졸업년월", "학교명", "전공", "졸업구분", "소재지"),
      ...cell("고등학교", "1997.03", "2001.02", "광영고등학교", "이과", "졸업", "서울"),
      ...cell("대학교", "2003.03", "2009.02", "수원대학교", "물리학과", "졸업", "경기"),
      ...cell("대학교", "(석사)", "2015.09", "2017.08", "숭실대학교", "IT융합학과", "졸업", "서울"),
      ...cell("졸업논문", "스마트폰을 이용한 통합 인증 관리 기법", "LAB."),
      ...cell("대학원", "(박사)", "YYYY.MM", "YYYY.MM", "", "", "", ""),
      ...cell("졸업논문", "", "LAB.", ""),
    ].join("\n");
    assert.equal(extractEducation(text).level, "석사", "빈 박사 행을 최종학력으로 채택함");
    // 학교·전공은 이 양식에서 여전히 부정확하다(학교 셀이 ±2줄 밖, 전공은 전체 fallback).
    // 탐색 범위를 행 전체로 넓혀 봤다가 실데이터 회귀 51건(학사→고졸 강등, 엉뚱한 학교)을
    // 내고 되돌렸다 — 개선하려면 픽스처가 아니라 실제 이력서 회귀 스캔으로 검증할 것.
  });

  it("CT-1107 생년월일 라벨 뒤 2자리 연도로 나이를 계산한다", () => {
    const age83 = new Date().getFullYear() - 1983;
    // "83.01.24" 처럼 2자리로 적는 표기 — 세기는 유효 나이 범위(14~90)로 판별한다
    for (const body of [
      "생년월일: 83.01.24",
      "생년월일 83.01.24",
      "생년월일: 83-01-24",
      "생일: 83년 1월 24일",
      // 표 양식 — 라벨과 값이 다른 셀로 떨어진다
      "성명\n\n생년월일\n\n연락처\n\n홍길동\n\n83.01.24\n\n010-1111-2222",
    ]) {
      assert.equal(extractPII(`홍길동\n${body}`).age, age83, `미인식: "${body}"`);
    }
    // 기존 표기도 유지
    assert.equal(extractPII("홍길동\n생년월일: 1983.01.24").age, age83);
    assert.equal(extractPII("홍길동\n93년생").age, new Date().getFullYear() - 1993);
    assert.equal(extractPII("홍길동\n나이: 30세").age, 30);
  });

  it("CT-1108 경력·자격증 날짜를 생년월일로 오인하지 않는다", () => {
    // 라벨 없는 날짜는 생년월일이 아니다 — 2자리 연도는 라벨이 있을 때만 인정
    assert.equal(extractPII("홍길동\n경력\n15.01.01 ~ 20.12.31 근무").age, null);
    assert.equal(extractPII("홍길동\n자격증\n빅데이터전문가 2025.06.03").age, null);
    // 라벨이 있으면 뒤에 경력 날짜가 있어도 라벨 쪽이 이긴다
    assert.equal(
      extractPII("홍길동\n생년월일: 83.01.24\n경력 2023.08.29 입사").age,
      new Date().getFullYear() - 1983
    );
  });

  it("CT-1109 추출이 인식하는 생년월일은 마스킹도 가린다", () => {
    // 추출/마스킹 불일치 = LLM 으로 원문 PII 유출 (GOTCHAS §0-7 사고 패턴)
    const leak = /83\s*[.\-/]\s*0?1\s*[.\-/]\s*24/;
    for (const text of [
      "홍길동\n생년월일: 83.01.24\n010-1111-2222",
      "성명\n\n생년월일\n\n연락처\n\n홍길동\n\n83.01.24\n\n010-1111-2222", // 표 양식
    ]) {
      assert.ok(extractPII(text).age != null, "추출이 인식 못 함");
      assert.ok(!leak.test(maskText(text)), "마스킹이 생년월일을 남김");
    }
    // 과잉 마스킹 금지 — 라벨 없는 경력 기간은 평가에 필요하므로 보존한다
    assert.match(maskText("경력사항\n15.01.01 ~ 20.12.31 근무"), /15\.01\.01/);
  });

  it("CT-1110 값이 라벨보다 먼저 오는 표 양식에서 본인 휴대폰을 고른다", () => {
    // 표 양식은 "값 → 라벨" 순서로 추출된다. 라벨 뒤만 보면 "휴대폰" 이 이메일을 건너뛰어
    // 다음 셀의 일반전화를 집어온다(candidate 111 — 휴대폰 대신 02 번호가 저장됨).
    assert.equal(
      extractPII("유소망\n010-7333-4819휴대폰somang4819@gmail.comEmail\n02-967-4819전화번호").phone,
      "010-7333-4819"
    );
    assert.equal(
      extractPII("홍길동\n02-967-4819전화번호\n010-7333-4819휴대폰").phone,
      "010-7333-4819"
    );
    // 기존 "라벨 → 값" 순서도 그대로
    assert.equal(extractPII("홍길동\n휴대폰: 010-1234-5678\n전화: 02-111-2222").phone, "010-1234-5678");
    assert.equal(extractPII("홍길동\n010-7777-8888\n경력사항").phone, "010-7777-8888");
    // 타인 번호 가드 유지 — 긴급연락처는 본인 번호를 덮지 않는다
    assert.equal(
      extractPII("홍길동\n휴대폰: 010-1111-2222\n긴급연락처: 010-3333-4444").phone,
      "010-1111-2222"
    );
  });

  it("CT-1111 채용포털 양식 '○○대학교(지역) 대학교(4년) 졸업' 을 정확히 읽는다", () => {
    // 실제 이력서 6건에서 사용자가 확인해 준 정답(2026-07-20). 판정 근거를 "학교명이
    // 따라오는가"로 넓혔을 때 전부 깨졌던 케이스다 — 학사→고졸/전문학사 강등,
    // "강원대학교(삼척)"→삼척대학교, 졸업·수료 상태 소실. 그 회귀를 여기서 고정한다.
    const cases: [string, string, string | null][] = [
      ["영산대학교(부산) 대학교(4년) 졸업", "학사 졸업", "영산대학교"],
      ["강원대학교(삼척) 대학교(4년) 졸업", "학사 졸업", "강원대학교"], // 괄호 안 지역명에 안 속아야
      ["동아대학교 대학교(4년) 졸업", "학사 졸업", "동아대학교"],
      ["한동대학교 대학교(4년) 졸업", "학사 졸업", "한동대학교"],
      // 학점은행제는 학교가 아니지만 이력서 학력란의 "학교명" 칸에 이렇게 적히고,
      // 사람이 만든 정답표(sample/이력서/candidate.xlsx)도 학교 자리에 둔다.
      ["학점은행제 대학교(4년) 졸업", "학사 졸업", "학점은행제"],
      ["한림대학교 대학원(박사) 수료", "박사 수료", "한림대학교"], // 수료 = 학위 없음, 상태 유지 필수
    ];
    for (const [line, expLevel, expSchool] of cases) {
      const e = extractEducation(`홍길동\n${line}\n010-0000-0000`);
      assert.equal(e.level, expLevel, `level 오판: "${line}"`);
      assert.equal(e.school, expSchool, `school 오판: "${line}"`);
    }
  });

  it("CT-1112 known 이름 마스킹이 본문을 파괴하지 않고, 조사·표양식 이름을 가린다", () => {
    // known.name 은 파일명 유래라 틀릴 수 있다. 구 구현(split/join, 경계 없음)은 이름이
    // "개발" 이면 "웹개발팀"→"웹[이름]팀" 으로 본문을 파괴하고, 동시에 라벨 없는 진짜 이름은
    // 그대로 LLM 에 나갔다. 앞 경계만 걸어 파괴는 막고 뒤(조사·호칭)는 열어 둔다.
    assert.match(
      maskText("웹개발팀에서 백엔드 근무", { known: { name: "개발" } }),
      /웹개발팀/,
      "부정확한 known 이름이 본문 단어를 삼킴"
    );
    // 조사·호칭이 붙어도 가려야 한다
    for (const body of ["홍길동은 개발자입니다", "홍길동님께 연락", "작성자 홍길동"]) {
      assert.ok(
        !maskText(body, { known: { name: "홍길동" } }).includes("홍길동"),
        `이름이 남음: "${body}"`
      );
    }
    // 표 양식(라벨과 값이 다른 줄) — DB 이름이 틀려도 본문 추출 이름으로 가린다
    const masked = maskText("성명\n\n이수현\n\n연락처\n\n010-1111-2222", {
      known: { name: "20240115 지원서류", extraNames: ["이수현"] },
    });
    assert.ok(!masked.includes("이수현"), "표 양식 이름이 마스킹되지 않음");
    // known 이 "(이름 미상)" 이면 치환 자체를 하지 않는다
    assert.match(
      maskText("백엔드 개발 경력 5년", { known: { name: "(이름 미상)" } }),
      /백엔드 개발 경력 5년/
    );
  });

  it("CT-1113 '총 경력 N년' 명시 표기만 경력으로 인정한다", () => {
    assert.equal(extractPII("홍길동\n총 경력 24년 4개월").careerYears, 24);
    assert.equal(extractPII("홍길동\n경력 총 27년").careerYears, 27);
    assert.equal(extractPII("홍길동\n총 30년\n경력사항").careerYears, 30);
    assert.equal(extractPII("홍길동\n총   경   력 17년10개월").careerYears, 17);
    // 개월은 버린다 — 표기 규칙이 내림("11년 10개월" → 11년)
    assert.equal(extractPII("홍길동\n총 경력 11년 10개월").careerYears, 11);
    // "총" 없는 문장 속 표기는 인정하지 않는다 — 신입이 자기소개에 "(경력1년반)" 이라
    // 쓴 실제 사례가 있었다(정답 0년). 표기가 없으면 null 로 두고 LLM 에 맡긴다.
    assert.equal(extractPII("홍길동\n풀스택 개발자입니다. (경력1년반)").careerYears, null);
    assert.equal(extractPII("홍길동\n신입 지원자입니다").careerYears, null);
  });

  it("CT-1105 인물형 이미지가 없으면 추출하지 않는다", async () => {
    // 가로형 배너·로고만 있는 이력서 — 아무거나 집으면 안 된다(화면은 이니셜 아바타 폴백)
    const docx = makeResumeDocx([
      { file: "banner.png", w: 900, h: 200 },
      { file: "logo.png", w: 640, h: 160 },
    ]);
    assert.equal(await extractPhotoFromBuffer(docx, "resume.docx"), null);
  });
});

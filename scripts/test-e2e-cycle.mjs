/**
 * A-6 로컬 풀 사이클 통합 E2E 검증.
 *
 * 시나리오:
 *   1. admin@company-a.test 로그인
 *   2. 첫 활성 공고에 consent 누락 업로드 시도 → 400
 *   3. consent=true + 실제 PDF 업로드 → 후보자 생성 + 큐 enqueue
 *   4. 서류 평가 완료까지 polling (gemini-2.5-flash)
 *   5. 면접 링크 발급 (interview 토큰 차감)
 *   6. 후보자로서 동의 제출
 *   7. 면접 채팅 3턴 (gemini-2.5-flash, thinking=128)
 *   8. 면접 종료 + 평가 생성 (gemini-2.5-flash)
 *   9. 최종 상태 검증 + 토큰 잔액 변동 확인
 *
 * 사용자는 결과만 보고, 필요시 UI 로 직접 한번 더 검증.
 */
import "./_load-env.mjs";
import fs from "node:fs/promises";

const BASE = "http://127.0.0.1:3003";
const ADMIN_EMAIL = "admin@company-a.test";
const ADMIN_PASS = "Test1234!";

const t0 = Date.now();
function log(msg) {
  const ms = String(Date.now() - t0).padStart(5, " ");
  console.log(`[${ms}ms] ${msg}`);
}
function fail(msg) {
  console.error(`\n❌ FAIL: ${msg}`);
  process.exit(1);
}

// ─────────── Step 1. 로그인 ───────────
log("Step 1: 로그인");
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: BASE },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
});
if (!loginRes.ok) fail(`로그인 실패 ${loginRes.status}: ${await loginRes.text()}`);
const cookie = (loginRes.headers.get("set-cookie") || "").split(";")[0];
if (!cookie) fail("쿠키 미발급");
log(`  ✅ 로그인 OK (cookie=${cookie.slice(0, 30)}…)`);

const H = { Cookie: cookie, Origin: BASE };

// ─────────── Step 2. 활성 공고·잔액 조회 ───────────
log("Step 2: 활성 공고 + 잔액 조회");
const jobsRes = await fetch(`${BASE}/api/jobs`, { headers: H });
const jobs = await jobsRes.json();
const job = jobs.find((j) => j.status === "active" && !j.passwordHash);
if (!job) fail("활성 공고 없음");
log(`  ✅ 공고 #${job.id} "${job.title}"`);

const walletRes = await fetch(`${BASE}/api/orgs/tokens`, { headers: H });
const wallet = await walletRes.json();
const balanceStart = wallet.balance;
log(`  💰 시작 잔액: ${balanceStart} 토큰`);

// ─────────── Step 3a. consent 누락 업로드 → 400 ───────────
log("Step 3a: consent 누락 업로드 → 400 기대");
{
  const fd = new FormData();
  const pdfBuf = await fs.readFile("test-fixtures/sample-resume.pdf");
  // Buffer 를 ArrayBuffer slice 로 정확히 노출 — new Uint8Array(buffer) 가 일부 환경에서
  // length-only 생성자로 오인되는 케이스 방어
  const ab = pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength);
  fd.append("file", new Blob([ab], { type: "application/pdf" }), "sample-resume.pdf");
  // applicantConsentConfirmed 일부러 누락
  const r = await fetch(`${BASE}/api/jobs/${job.id}/candidates`, {
    method: "POST",
    headers: H,
    body: fd,
  });
  if (r.status !== 400) fail(`expected 400, got ${r.status}`);
  const body = await r.json();
  if (body.code !== "applicant_consent_required")
    fail(`expected code=applicant_consent_required, got ${body.code}`);
  log(`  ✅ 400 + code=applicant_consent_required`);
}

// ─────────── Step 3b. consent=true 업로드 ───────────
log("Step 3b: consent=true 업로드");
let candidateId;
{
  const fd = new FormData();
  const pdfBuf = await fs.readFile("test-fixtures/sample-resume.pdf");
  const ab = pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength);
  fd.append("file", new Blob([ab], { type: "application/pdf" }), "sample-resume.pdf");
  fd.append("applicantConsentConfirmed", "true");
  const r = await fetch(`${BASE}/api/jobs/${job.id}/candidates`, {
    method: "POST",
    headers: H,
    body: fd,
  });
  if (!r.ok) fail(`업로드 실패 ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const ok = data.results.find((x) => x.ok);
  if (!ok) fail(`업로드 ok 없음: ${JSON.stringify(data)}`);
  candidateId = ok.candidateId;
  log(`  ✅ 후보자 #${candidateId} "${ok.name}" 등록`);
}

// ─────────── Step 4. 서류 평가 polling (gemini-2.5-flash) ───────────
log("Step 4: 서류 평가 완료 대기 (gemini-2.5-flash)");
const screenStart = Date.now();
let screeningDone = false;
for (let i = 0; i < 60; i++) {
  // 최대 60초
  await new Promise((r) => setTimeout(r, 1000));
  const r = await fetch(`${BASE}/api/candidates/${candidateId}`, { headers: H });
  if (!r.ok) continue;
  const data = await r.json();
  const c = data.candidate;
  if (c?.screeningReport) {
    const sec = ((Date.now() - screenStart) / 1000).toFixed(1);
    log(
      `  ✅ 평가 완료 ${sec}s: score=${c.screeningScore}, recommendation=${c.screeningReport.recommendation}`
    );
    log(`     강점: ${(c.screeningReport.strengths ?? []).slice(0, 2).join(" | ")}`);
    log(
      `     interview_focus: ${(c.screeningReport.interview_focus ?? []).slice(0, 2).join(" | ")}`
    );
    screeningDone = true;
    break;
  }
}
if (!screeningDone) fail("서류 평가 60초 내 미완료");

// ─────────── Step 5. 면접 링크 발급 ───────────
log("Step 5: 면접 링크 발급");
let interviewToken;
{
  const r = await fetch(`${BASE}/api/candidates/${candidateId}/interview-link`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ days: 7 }),
  });
  if (!r.ok) fail(`면접 링크 실패 ${r.status}: ${await r.text()}`);
  const data = await r.json();
  interviewToken = data.session?.accessToken || data.accessToken;
  if (!interviewToken) fail(`토큰 미반환: ${JSON.stringify(data)}`);
  log(`  ✅ 토큰 발급 (${interviewToken.slice(0, 12)}…)`);
}

// ─────────── Step 6. 동의 제출 (후보자) ───────────
log("Step 6: 후보자 동의 제출");
{
  const infoRes = await fetch(`${BASE}/api/interview/${interviewToken}`);
  const info = await infoRes.json();
  if (!info.consentRequired) fail("consent required 플래그 없음");
  log(`  consentItems: ${info.consentItems.map((x) => x.key).join(", ")}`);

  const consents = {};
  info.consentItems.forEach((item) => {
    if (item.required) consents[item.key] = true;
  });

  const r = await fetch(`${BASE}/api/interview/${interviewToken}/consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consents }),
  });
  if (!r.ok) fail(`동의 제출 실패 ${r.status}: ${await r.text()}`);
  log(`  ✅ 동의 ${Object.keys(consents).length}개 제출`);
}

// ─────────── Step 7. 면접 채팅 3턴 (gemini-2.5-flash) ───────────
log("Step 7: 면접 채팅 3턴 (gemini-2.5-flash, thinking=128)");
const candidateAnswers = [
  "안녕하세요. 카카오에서 5년 동안 메시징 플랫폼 백엔드를 개발했고, 가장 자랑스러운 일은 채팅방 검색 시스템을 RDB에서 Elasticsearch로 마이그레이션해서 응답시간을 15배 개선한 프로젝트입니다.",
  "Elasticsearch 도입 결정은 제가 주도했습니다. 당시 채팅방 검색이 평균 1.2초 걸렸는데, 사용자 이탈이 컸어요. RDB의 LIKE 검색은 인덱스 활용이 어렵고 텍스트 분석도 약해서 한계가 명확했습니다. Elasticsearch는 한국어 nori analyzer 가 있고 inverted index 로 부분 일치도 빨라서 후보로 정했습니다.",
  "가장 어려웠던 부분은 마이그레이션 중 데이터 정합성이었습니다. 기존 RDB와 ES 사이에 dual-write로 가다가, ES 에 잠시 누락이 생기면 사용자가 검색 결과 못 받는 케이스를 발견했어요. Kafka 기반으로 outbox pattern을 도입해서 RDB 트랜잭션 commit 후에 비동기로 ES 인덱싱하도록 바꿨습니다. 그 후 누락 0으로 안정화됐습니다.",
];

const turnTimings = [];
for (let turn = 0; turn < 3; turn++) {
  const turnStart = Date.now();
  const msg = candidateAnswers[turn];
  log(`  턴 ${turn + 1} (후보자): "${msg.slice(0, 50)}..."`);

  const r = await fetch(`${BASE}/api/interview/${interviewToken}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMessage: msg }),
  });
  if (!r.ok) fail(`chat 턴 ${turn + 1} 실패 ${r.status}: ${await r.text()}`);

  // 스트리밍 응답 누적
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let response = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    response += decoder.decode(value);
  }
  const turnMs = Date.now() - turnStart;
  turnTimings.push(turnMs);
  log(
    `    ← 면접관 (${turnMs}ms): "${response.replace(/\[INTERVIEW_END\]/g, "").slice(0, 80).replace(/\n/g, " ")}..."`
  );
  if (response.includes("[INTERVIEW_END]")) {
    log("    🔚 면접관이 종료 토큰 출력 — 정상");
    break;
  }
}

// ─────────── Step 8. 면접 종료 + 평가 (gemini-2.5-flash) ───────────
log("Step 8: 면접 종료 + 평가 생성 (gemini-2.5-flash)");
const evalStart = Date.now();
{
  const r = await fetch(`${BASE}/api/interview/${interviewToken}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) fail(`평가 실패 ${r.status}: ${await r.text()}`);
  const evalResult = await r.json();
  const evalMs = Date.now() - evalStart;
  log(`  ✅ 평가 ${(evalMs / 1000).toFixed(1)}s`);
  log(
    `     overall=${evalResult.overall_score}, recommendation=${evalResult.recommendation}`
  );
  log(`     summary: ${(evalResult.summary || "").slice(0, 100).replace(/\n/g, " ")}...`);
}

// ─────────── Step 9. 최종 상태 + 잔액 검증 ───────────
log("Step 9: 최종 상태 검증");
{
  const cRes = await fetch(`${BASE}/api/candidates/${candidateId}`, { headers: H });
  const data = await cRes.json();
  const c = data.candidate;
  log(`  candidate stage: ${c.stage}`);
  log(`  screening: ${c.screeningScore}`);
  log(`  interview sessions: ${data.sessions.length}`);
  const lastSession = data.sessions[0];
  if (lastSession?.evaluation) {
    log(`  interview eval: overall=${lastSession.evaluation.overall_score}, rec=${lastSession.evaluation.recommendation}`);
  }

  const wRes = await fetch(`${BASE}/api/orgs/tokens`, { headers: H });
  const w = await wRes.json();
  const spent = balanceStart - w.balance;
  log(`  💰 종료 잔액: ${w.balance} 토큰 (-${spent})`);
  log(`     ledger 마지막 3건:`);
  (w.ledger ?? []).slice(0, 3).forEach((l) => {
    log(`       ${l.reason} | ${l.delta > 0 ? "+" : ""}${l.delta} | balance_after=${l.balanceAfter}`);
  });
}

// ─────────── 요약 ───────────
const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
console.log("");
console.log("━".repeat(60));
console.log(`✅ A-6 풀 사이클 검증 통과 (${totalSec}s)`);
console.log("━".repeat(60));
console.log(`면접 턴 latency (gemini-2.5-flash, thinking=128):`);
turnTimings.forEach((ms, i) => console.log(`  턴 ${i + 1}: ${ms}ms`));
const avg = Math.round(turnTimings.reduce((a, b) => a + b, 0) / turnTimings.length);
console.log(`  평균: ${avg}ms`);
if (avg > 8000)
  console.log(
    `⚠️ 평균 ${avg}ms — thinking budget 더 낮춰야 UX 임계 통과 (목표 < 5000ms)`
  );
console.log("━".repeat(60));

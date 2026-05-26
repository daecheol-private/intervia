/**
 * /api/jobs/[id]/candidates 의 지원자 동의 게이트 회귀 테스트.
 *
 * dev 서버(localhost:3003)에 test-company-a 의 org_admin 으로 로그인해서,
 * 첫 활성 공고에 다음 시나리오를 실행:
 *   1. JSON manifest 요청 — applicantConsentConfirmed 누락 → 400
 *   2. JSON manifest 요청 — applicantConsentConfirmed=true + blobs 빈 배열 → 400 (파일 없음, 게이트는 통과)
 *   3. multipart 요청 — applicantConsentConfirmed 누락 → 400
 *
 * NOTE: 실제 파일 업로드까진 검증 안 함 (별도 시나리오). 게이트 동작만 격리 확인.
 */
import "./_load-env.mjs";

const BASE = "http://127.0.0.1:3003";

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
    },
    body: JSON.stringify({
      email: "admin@company-a.test",
      password: "Test1234!",
    }),
  });
  if (!r.ok) {
    throw new Error(`로그인 실패 (${r.status}): ${await r.text()}`);
  }
  const cookie = r.headers.get("set-cookie") ?? "";
  const session = cookie.split(";")[0];
  return session;
}

async function firstActiveJobId(cookie) {
  const r = await fetch(`${BASE}/api/jobs`, { headers: { Cookie: cookie } });
  if (!r.ok) throw new Error(`/api/jobs 실패 (${r.status})`);
  const rows = await r.json();
  const active = rows.find((j) => j.status === "active");
  if (!active) throw new Error("활성 공고 없음 — 테스트 공고 만들어주세요");
  return active.id;
}

async function callCandidatesJson(cookie, jobId, body) {
  return fetch(`${BASE}/api/jobs/${jobId}/candidates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: BASE,
    },
    body: JSON.stringify(body),
  });
}

async function callCandidatesMultipart(cookie, jobId, opts) {
  const fd = new FormData();
  if (opts.consent !== undefined) {
    fd.append("applicantConsentConfirmed", String(opts.consent));
  }
  // 최소한의 더미 파일 (실제 처리는 magic byte 검증에서 막힘 — 게이트보다 뒤)
  const blob = new Blob([new Uint8Array([0])], { type: "application/pdf" });
  fd.append("file", blob, "dummy.pdf");
  return fetch(`${BASE}/api/jobs/${jobId}/candidates`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: BASE },
    body: fd,
  });
}

function check(name, res, expect) {
  const ok = res.status === expect.status;
  console.log(
    `${ok ? "✅" : "❌"} ${name} → ${res.status} (expect ${expect.status})`
  );
  return ok;
}

async function main() {
  console.log("dev 서버 health check…");
  const h = await fetch(`${BASE}/api/health`);
  if (!h.ok) {
    console.error("❌ dev 서버 미가동 — npm run dev 필요");
    process.exit(1);
  }

  const cookie = await login();
  console.log(`로그인 OK: ${cookie.slice(0, 40)}…\n`);

  const jobId = await firstActiveJobId(cookie);
  console.log(`테스트 공고: id=${jobId}\n`);

  let allOk = true;

  // 시나리오 1: JSON manifest, consent 누락
  {
    const r = await callCandidatesJson(cookie, jobId, {
      blobs: [
        { url: "https://example.com/x.pdf", pathname: "x.pdf", size: 100 },
      ],
    });
    const body = await r.json().catch(() => ({}));
    const codeOk = body.code === "applicant_consent_required";
    const statusOk = check("JSON consent 누락 → 400", r, { status: 400 });
    console.log(`   code: ${body.code} ${codeOk ? "✅" : "❌"}\n`);
    if (!statusOk || !codeOk) allOk = false;
  }

  // 시나리오 2: JSON manifest, consent true + 빈 blobs → "파일 없음" 400
  // (게이트는 통과해야 — 다른 에러로 400 나야 정상)
  {
    const r = await callCandidatesJson(cookie, jobId, {
      applicantConsentConfirmed: true,
      blobs: [],
    });
    const text = await r.text();
    const passedGate = !text.includes("applicant_consent_required");
    const statusOk = check("JSON consent OK + 빈 blobs → 400", r, {
      status: 400,
    });
    console.log(
      `   게이트 통과 (다른 에러): ${passedGate ? "✅" : "❌"} (body=${text.slice(0, 80)})\n`
    );
    if (!statusOk || !passedGate) allOk = false;
  }

  // 시나리오 3: multipart, consent 누락
  {
    const r = await callCandidatesMultipart(cookie, jobId, {});
    const body = await r.json().catch(() => ({}));
    const codeOk = body.code === "applicant_consent_required";
    const statusOk = check("multipart consent 누락 → 400", r, { status: 400 });
    console.log(`   code: ${body.code} ${codeOk ? "✅" : "❌"}\n`);
    if (!statusOk || !codeOk) allOk = false;
  }

  if (!allOk) {
    console.error("❌ 일부 시나리오 실패");
    process.exit(1);
  }
  console.log("✅ 동의 게이트 모든 시나리오 통과");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});

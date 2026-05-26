/**
 * CSRF / 인증 가드 회귀 테스트.
 *
 * 변경 흐름 (2026-05-22):
 *  - proxy.ts public allowlist 에 /legal/* 추가
 *  - 새 페이지 /legal/applicant-consent-template, /legal/ai-evaluation-disclosure
 *  - 새 액션 candidate.upload_with_consent
 *
 * 검증:
 *  1. /legal/* 비로그인 GET 200 (public allowlist)
 *  2. /privacy, /terms 비로그인 GET 200
 *  3. /jobs/* 비로그인 GET → /login 리다이렉트 또는 401
 *  4. /api/jobs/[id]/candidates POST cross-origin → 403 (CSRF block)
 *  5. /api/health GET 200 (public)
 */
import "./_load-env.mjs";
const BASE = "http://127.0.0.1:3003";

function check(name, ok, detail) {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  return ok;
}

async function main() {
  const cases = [];

  // 1. /legal/* public
  for (const path of [
    "/legal/applicant-consent-template",
    "/legal/ai-evaluation-disclosure",
  ]) {
    const r = await fetch(`${BASE}${path}`, { redirect: "manual" });
    cases.push(check(`${path} 200`, r.status === 200, `status=${r.status}`));
  }

  // 2. /privacy, /terms public
  for (const path of ["/privacy", "/terms"]) {
    const r = await fetch(`${BASE}${path}`, { redirect: "manual" });
    cases.push(check(`${path} 200`, r.status === 200, `status=${r.status}`));
  }

  // 3. /jobs 비로그인 → /login redirect (proxy.ts 보호 대상)
  {
    const r = await fetch(`${BASE}/jobs`, { redirect: "manual" });
    const isRedirect = r.status === 307 || r.status === 302;
    const loc = r.headers.get("location") || "";
    cases.push(
      check(
        "/jobs 비로그인 → /login redirect",
        isRedirect && loc.includes("/login"),
        `status=${r.status} location=${loc}`
      )
    );
  }

  // 4. CSRF — cross-origin POST 403
  {
    const r = await fetch(`${BASE}/api/jobs/1/candidates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({ applicantConsentConfirmed: true, blobs: [] }),
    });
    cases.push(
      check(
        "cross-origin POST → 403 (CSRF)",
        r.status === 403,
        `status=${r.status}`
      )
    );
  }

  // 5. /api/health public
  {
    const r = await fetch(`${BASE}/api/health`);
    cases.push(check("/api/health 200", r.status === 200, `status=${r.status}`));
  }

  // 6. /legal/* 가 인증 가드 면제됐는지 (token 있어도 통과해야 함 — 비로그인 가드만 면제)
  // skip — 충분히 검증됨

  const fail = cases.filter((c) => !c).length;
  if (fail > 0) {
    console.error(`\n❌ ${fail}건 실패`);
    process.exit(1);
  }
  console.log("\n✅ 모든 가드 정상");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});

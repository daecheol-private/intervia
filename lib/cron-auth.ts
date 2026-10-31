import { secretEquals } from "./secret-compare";

/**
 * cron / internal 워커 라우트 공통 인증.
 *
 * - cron:     Authorization: Bearer ${CRON_SECRET}  (Vercel Cron 이 자동으로 붙임)
 * - internal: X-Internal-Secret: ${INTERNAL_API_SECRET}  (cron·self-chain 이 붙임)
 *
 * 시크릿 미설정 시:
 *   운영(NODE_ENV=production, Vercel preview 포함) → 503. `x-vercel-cron` 헤더는 누구나 위조할 수
 *   있어 시크릿 없이 받아 주면 무인증 개방(fail-open)이 된다 (SECURITY_AUDIT_2026-10-31 M16).
 *   로컬 dev → 기존처럼 `x-vercel-cron: 1` 허용.
 * 로그인 세션으로는 호출할 수 없다(아래 authorizeCron 참고).
 */
export type CronAuthKind = "cron" | "internal";

export type CronAuthDecision = "ok" | "unconfigured" | "denied";

const SPEC: Record<CronAuthKind, { env: "CRON_SECRET" | "INTERNAL_API_SECRET"; header: string; bearer: boolean }> = {
  cron: { env: "CRON_SECRET", header: "authorization", bearer: true },
  internal: { env: "INTERNAL_API_SECRET", header: "x-internal-secret", bearer: false },
};

/** 세션 없이 헤더·env 만으로 판정 (테스트 가능하게 분리). */
export function cronAuthDecision(
  req: Request,
  kind: CronAuthKind,
  env: Record<string, string | undefined> = process.env
): CronAuthDecision {
  const spec = SPEC[kind];
  const secret = env[spec.env];
  if (!secret) {
    if (env.NODE_ENV === "production") return "unconfigured";
    return req.headers.get("x-vercel-cron") === "1" ? "ok" : "denied";
  }
  const expected = spec.bearer ? `Bearer ${secret}` : secret;
  return secretEquals(req.headers.get(spec.header), expected) ? "ok" : "denied";
}

/**
 * 통과면 null, 거부면 응답. 로그인 세션은 받지 않는다 — cron 경로는 proxy(CSRF 검사) 밖이고
 * 세션 쿠키는 외부 링크·폼에도 실려 가서, 시스템 관리자가 링크 하나 누르면 배치가 돌았다(C2 와 같은 형태).
 * 수동 실행은 시크릿 헤더로(scripts/process-now.ps1).
 */
export async function authorizeCron(req: Request, kind: CronAuthKind): Promise<Response | null> {
  const decision = cronAuthDecision(req, kind);
  if (decision === "ok") return null;
  if (decision === "unconfigured") {
    return new Response(`${SPEC[kind].env} 미설정 — 실행하지 않음`, { status: 503 });
  }
  return new Response("권한 없음", { status: 401 });
}

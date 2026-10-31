/**
 * URL·문자열 속 무인증 접근 토큰 마스킹 — 오류 비콘(클라이언트)과 error-reporter(서버)가 공유.
 * 클라이언트 번들에도 들어가므로 node 모듈·서버 의존성 import 금지.
 *
 * 토큰 형식: p_/sr_/inv_/v_/np_/s_/tk_/sch_/ap_ + hex/base64url, unsubscribe 는 prefix 없는 base64url.
 */

// 다음 세그먼트가 토큰인 라우트 (페이지 + /api 공통). view·phone 은 중간 고정 세그먼트.
const TOKEN_PARENT_SEGMENTS = new Set([
  "interview",
  "apply",
  "invite",
  "invites",
  "schedule",
  "shared",
  "view",
  "unsubscribe",
  "phone",
  "verify-phone",
]);

// prefix 토큰. 꼬리에 대문자/숫자 1개 이상 요구 — idx_candidates_org_id 같은 식별자 오탐 방지.
export const PREFIXED_TOKEN_RE = /\b[a-z]{1,4}_(?=[A-Za-z0-9_-]*[A-Z0-9])[A-Za-z0-9_-]{16,}/g;

function isOpaqueSegment(seg: string): boolean {
  return seg.length >= 20 && /^[A-Za-z0-9_-]+$/.test(seg) && /[0-9]/.test(seg);
}

function redactPathname(pathname: string): string {
  const parts = pathname.split("/");
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    const prev = parts[i - 1]?.toLowerCase() ?? "";
    if (
      (TOKEN_PARENT_SEGMENTS.has(prev) && !TOKEN_PARENT_SEGMENTS.has(seg.toLowerCase())) ||
      isOpaqueSegment(seg) ||
      new RegExp(PREFIXED_TOKEN_RE.source).test(seg)
    ) {
      parts[i] = "[token]";
    }
  }
  return parts.join("/");
}

/** 비콘용 — query·hash 를 버리고 토큰 세그먼트를 가린 pathname 만. */
export function safePathname(pathname: string): string {
  return redactPathname(pathname.split(/[?#]/)[0] ?? "");
}

/**
 * 서버용 — 절대/상대 URL 모두. 토큰 세그먼트 마스킹 + query 값 전부 [redacted](키는 유지) + hash 제거.
 * 파싱 불가하면 query·hash 를 잘라낸 경로만.
 */
export function redactUrl(raw: string): string {
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  try {
    const u = new URL(raw, "http://x.invalid");
    const keys = [...new Set([...u.searchParams.keys()])];
    const query = keys.length ? "?" + keys.map((k) => `${encodeURIComponent(k)}=[redacted]`).join("&") : "";
    const path = redactPathname(u.pathname) + query;
    return isAbsolute ? `${u.protocol}//${u.host}${path}` : path;
  } catch {
    return redactPathname(raw.split(/[?#]/)[0] ?? "");
  }
}

/** 자유 문자열(오류 메시지·스택) 속 URL 경로 토큰·query 토큰·prefix 토큰 마스킹. */
export function redactTokensInText(s: string): string {
  return s
    .replace(
      /\/(interview|apply|invites?|schedule|shared(?:\/view)?|unsubscribe|verify\/phone|verify-phone)\/[^/?#\s"'<>]+/gi,
      "/$1/[token]"
    )
    .replace(
      /([?&](?:token|t|code|key|secret|sig|signature|access_token)=)[^&#\s"'<>]+/gi,
      "$1[redacted]"
    )
    .replace(PREFIXED_TOKEN_RE, "[token]");
}

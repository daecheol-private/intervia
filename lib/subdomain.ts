/**
 * 법인 지원 페이지 서브도메인 ({sub}.intervia.kr) — 순수 함수만.
 * proxy.ts(미들웨어 번들)가 import 하므로 DB·node API 접근 금지.
 *
 * 사칭 방지가 핵심 설계: 서브도메인은 자유 입력이 아니라 법인의 email_domain
 * 첫 라벨에서만 자동 유도된다 (가입 시 회사 메일 소유가 검증되므로 라벨의
 * 정당성이 담보됨). 자유 지정 기능을 추가하지 말 것 — samsung.intervia.kr
 * 선점 같은 사칭 경로가 열린다.
 */

// 지원 페이지를 서빙하는 기본 호스트들. 이 서브도메인만 지원 페이지로 인정.
const BASE_HOSTS = ["intervia.kr", "localhost"];

// 인프라·브랜드·혼동 유발 라벨 — 법인 서브도메인으로 발급 금지
const RESERVED = new Set([
  "www", "api", "app", "apps", "admin", "administrator", "root", "system",
  "mail", "email", "webmail", "smtp", "imap", "pop", "mx", "ns", "ns1", "ns2",
  "ftp", "cdn", "static", "assets", "img", "images", "files", "blob",
  "dev", "test", "staging", "demo", "beta", "preview", "sandbox",
  "blog", "docs", "doc", "help", "support", "status", "notice",
  "dashboard", "console", "portal", "my", "account", "login", "signup", "auth",
  "secure", "vpn", "git", "intervia", "official",
  "career", "careers", "job", "jobs", "apply", "recruit", "interview", "hr",
]);

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/** 발급 가능한 서브도메인 라벨인지 (형식 + 예약어). */
export function isValidSubdomainLabel(label: string): boolean {
  return label.length >= 2 && LABEL_RE.test(label) && !RESERVED.has(label);
}

/**
 * 법인 email_domain 에서 서브도메인 후보를 유도.
 * "expernet.co.kr" → "expernet". 유도 불가(공용 도메인 null·예약어·형식 위반)면 null.
 */
export function deriveSubdomain(emailDomain: string | null | undefined): string | null {
  if (!emailDomain) return null;
  const label = emailDomain.trim().toLowerCase().split(".")[0];
  return isValidSubdomainLabel(label) ? label : null;
}

/**
 * Host 헤더에서 법인 서브도메인 추출. 기본 호스트(apex·www)나 무관한 호스트
 * (vercel.app 프리뷰 등)는 null. 한 레벨 라벨만 인정 (a.b.intervia.kr 은 무시).
 */
export function subdomainFromHost(hostHeader: string | null | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.toLowerCase().split(":")[0];
  for (const base of BASE_HOSTS) {
    if (host === base || host === "www." + base) return null;
    if (host.endsWith("." + base)) {
      const sub = host.slice(0, -(base.length + 1));
      if (!sub || sub.includes(".") || sub === "www") return null;
      return sub;
    }
  }
  return null;
}

/**
 * 서브도메인 지원 페이지 활성 여부.
 * 운영은 와일드카드 DNS(*.intervia.kr)가 준비된 뒤 SUBDOMAIN_APPLY_ENABLED=1 로
 * 켠다 — 그 전엔 휴면(기존 apex 링크 그대로). dev 는 기본 켜짐({sub}.localhost).
 */
export function subdomainApplyEnabled(): boolean {
  const v = process.env.SUBDOMAIN_APPLY_ENABLED;
  if (v === "1") return true;
  if (v === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/** 지원 페이지 기본 호스트 — dev 는 localhost 강제 (APP_BASE_URL 이 운영값인 로컬 env 대비). */
export function applyBaseOrigin(): { protocol: "http" | "https"; host: string } {
  if (process.env.NODE_ENV !== "production")
    return { protocol: "http", host: "localhost:3003" };
  let host = "intervia.kr";
  try {
    host = new URL(process.env.APP_BASE_URL ?? "https://intervia.kr").host;
  } catch {
    // env 오염 시 정본 도메인 유지
  }
  if (host.startsWith("www.")) host = host.slice(4);
  return { protocol: "https", host };
}

/** 지원 페이지 정본 URL. subdomain null 이면 apex. */
export function applyUrlFor(subdomain: string | null, token: string): string {
  const { protocol, host } = applyBaseOrigin();
  const h = subdomain ? `${subdomain}.${host}` : host;
  return `${protocol}://${h}/apply/${encodeURIComponent(token)}`;
}

/** AI 면접 페이지 정본 URL. subdomain null 이면 apex(기존 동작). */
export function interviewUrlFor(subdomain: string | null, token: string): string {
  const { protocol, host } = applyBaseOrigin();
  const h = subdomain ? `${subdomain}.${host}` : host;
  return `${protocol}://${h}/interview/${encodeURIComponent(token)}`;
}

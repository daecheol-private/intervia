/**
 * 지원 링크 유입 출처 (referrer 자동 감지) — 순수 함수만 (클라이언트·서버 공용).
 *
 * 채용사이트가 noreferrer 를 붙이거나 인앱 브라우저(사람인 앱·카카오톡 등)로 열면
 * referrer 가 아예 오지 않으므로 best-effort — 없으면 "지원 링크"로만 표시된다.
 */

// 알려진 채용사이트 도메인 → 표시 라벨. 서브도메인 포함 suffix 매칭.
const KNOWN_SITES: [string, string][] = [
  ["saramin.co.kr", "사람인"],
  ["jobkorea.co.kr", "잡코리아"],
  ["albamon.com", "알바몬"],
  ["alba.co.kr", "알바천국"],
  ["wanted.co.kr", "원티드"],
  ["jobplanet.co.kr", "잡플래닛"],
  ["incruit.com", "인크루트"],
  ["work24.go.kr", "고용24"],
  ["work.go.kr", "고용24"],
  ["linkedin.com", "LinkedIn"],
  ["indeed.com", "Indeed"],
  ["catch.co.kr", "캐치"],
  ["jasoseol.com", "자소설닷컴"],
  ["rocketpunch.com", "로켓펀치"],
  ["rememberapp.co.kr", "리멤버"],
  ["peoplenjob.com", "피플앤잡"],
  ["gamejob.co.kr", "게임잡"],
];

/**
 * document.referrer 원문에서 저장할 호스트만 추출.
 * 자기 자신(정본 redirect·서브도메인 meta refresh 경유)·로컬은 출처가 아니므로 null.
 */
export function normalizeReferrerHost(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let host: string;
  try {
    host = new URL(raw.slice(0, 2000)).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || host.length > 253) return null;
  for (const self of ["intervia.kr", "localhost", "vercel.app"])
    if (host === self || host.endsWith("." + self)) return null;
  if (host === "127.0.0.1") return null;
  return host;
}

/** 호스트 → 표시 라벨. 알려진 사이트는 한글명, 그 외는 www. 뗀 호스트 그대로. */
export function applySourceLabel(host: string | null | undefined): string | null {
  if (!host) return null;
  for (const [domain, label] of KNOWN_SITES)
    if (host === domain || host.endsWith("." + domain)) return label;
  return host.replace(/^www\./, "");
}

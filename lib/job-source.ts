/**
 * 공고 자동 채우기(URL 임포트) 출처 URL 헬퍼.
 *
 * 저장은 임포트에 **성공했을 때만** — 실패한 URL 이 "원본 공고"로 남지 않게 한다.
 * 클라이언트가 보낸 값이므로 서버에서 http(s) 여부·길이를 다시 검증한다.
 */

const MAX_SOURCE_URL = 500;

/** 저장 가능한 출처 URL 이면 정리해서 반환, 아니면 null. */
export function normalizeSourceUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > MAX_SOURCE_URL) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

/** 화면 표시용 짧은 라벨 — "saramin.co.kr/zf_user/jobs/view". 파싱 실패 시 원문. */
export function sourceUrlLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    const label = `${host}${path}`;
    return label.length > 60 ? `${label.slice(0, 60)}…` : label;
  } catch {
    return url;
  }
}

/**
 * 공용·SaaS 이메일 도메인 — 회사 단독 도메인이 아니라서 자동 법인 매칭을 사용하지 않음.
 * 가입 시 사업자번호 필수 (#26 가드).
 *
 * 카테고리:
 *  - 일반 웹메일 (gmail/naver/...)
 *  - SaaS·임시메일 호스팅 (mailinator/temp-mail/...)
 *  - 한국 통신사·포털 메일
 *  - 비즈니스 메일 호스팅 (회사가 도메인을 빌려쓰는 케이스도 있음 — 안전 측 분류)
 */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  // 글로벌 메이저 웹메일
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.kr",
  "yahoo.co.jp",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "tutanota.com",
  "tutamail.com",
  "fastmail.com",
  "fastmail.fm",
  "zoho.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "mail.ru",
  // 한국 포털·통신사
  "naver.com",
  "daum.net",
  "hanmail.net",
  "kakao.com",
  "nate.com",
  "korea.com",
  "hanafos.com",
  "chol.com",
  "freechal.com",
  "empal.com",
  "lycos.co.kr",
  "dreamwiz.com",
  "paran.com",
  "netsgo.com",
  // 중국·일본·동남아 메이저
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "sina.cn",
  "sohu.com",
  "foxmail.com",
  "yeah.net",
  "139.com",
  "189.cn",
  "wo.com.cn",
  "ymail.com",
  "rocketmail.com",
  "googlemail.co.uk",
  // 일회용·익명·임시 메일 (사칭 위험 큼)
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "10minutemail.com",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "throwaway.email",
  "yopmail.com",
  "trashmail.com",
  "trashmail.net",
  "maildrop.cc",
  "getairmail.com",
  "sharklasers.com",
  "spam4.me",
  "fakeinbox.com",
  "dispostable.com",
  "moakt.com",
  "mohmal.com",
  "emailondeck.com",
  "33mail.com",
  "anonbox.net",
  // 흔한 SaaS·교육·정부 공용 도메인 (한국)
  "korea.kr", // 정부 공용
  "go.kr",
  "ac.kr", // 학교 — 회사 도메인 아님
  "edu",
  "student.com",
]);

export function getEmailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).toLowerCase().trim();
  return d || null;
}

export function isPublicDomain(domain: string | null): boolean {
  if (!domain) return true;
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * 사업자번호 마스킹 — 인증 전(공개) 응답에서 전체 번호 노출 방지.
 * XXX-XX-XXXXX 중 세무서·구분(앞 5자리)만 남기고 일련번호(뒤 5자리)는 가린다.
 * 법인 식별(중복 등록 안내)에는 충분하되, 사칭·사기에 쓰일 전체 번호는 넘기지 않음.
 */
export function maskBizNo(biz: string | null | undefined): string | null {
  if (!biz) return null;
  const digits = biz.replace(/\D/g, "");
  if (digits.length < 10) return "****";
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-*****`;
}

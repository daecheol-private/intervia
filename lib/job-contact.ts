import { getEmailDomain, isValidEmail } from "./email-domain";

/**
 * 공고 "채용 담당자 이메일"(recruitingContactEmail) 검증.
 *
 * 이 이메일은 §37의2 안내문의 [채용 담당 연락처] 자리에 들어가 지원자에게 공개되며,
 * 지원자가 AI 평가 거부·이의제기를 할 연락처다. 그래서:
 *  - 필수 + 이메일 형식
 *  - 회사 도메인(expectedDomain)과 동일해야 함 — 개인메일(gmail 등)로 새어 책임주체가
 *    흐려지는 것을 막는다. expectedDomain 이 null(예: system_admin)이면 도메인 제한 생략.
 */
export function validateRecruitingContactEmail(
  raw: unknown,
  expectedDomain: string | null
): { ok: true; email: string } | { ok: false; message: string } {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { ok: false, message: "채용 담당자 이메일을 입력하세요." };
  if (!isValidEmail(email))
    return { ok: false, message: "올바른 이메일 형식이 아닙니다." };
  if (expectedDomain) {
    const dom = getEmailDomain(email);
    if (dom !== expectedDomain.toLowerCase())
      return {
        ok: false,
        message: `회사 이메일 도메인(@${expectedDomain})만 사용할 수 있습니다.`,
      };
  }
  return { ok: true, email };
}

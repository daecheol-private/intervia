/**
 * 비밀번호 정책 (사용자 결정 2026-05-18 갱신):
 *   - 최소 10자 (PIPA 안전성 확보조치 기준: 3종 조합 시 8자, 2종 조합 시 10자 이상)
 *   - 영문 대문자 / 영문 소문자 / 숫자 / 특수문자 4종 중 3종 이상
 *   - HIBP (Have I Been Pwned) 유출 비밀번호 차단 — k-anonymity 방식, API 키 X
 *
 * 사용:
 *   const r = await validatePassword(plain);
 *   if (!r.ok) return new Response(r.errors.join("\n"), { status: 400 });
 *
 * HIBP 실패 (네트워크/타임아웃) 는 비치명적 — 통과시킴. 환경변수 SKIP_HIBP=1 로 off.
 */
import { createHash } from "node:crypto";

export const MIN_LENGTH = 10;
export const MIN_CATEGORIES = 3;
export const MAX_LENGTH = 200; // bcrypt 72바이트 한도 + 일부 여유

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export function validatePasswordPolicy(password: string): ValidationResult {
  const errors: string[] = [];

  if (typeof password !== "string") {
    return { ok: false, errors: ["비밀번호가 비어 있습니다."] };
  }
  if (password.length < MIN_LENGTH) {
    errors.push(`비밀번호는 최소 ${MIN_LENGTH}자 이상이어야 합니다.`);
  }
  if (password.length > MAX_LENGTH) {
    errors.push(`비밀번호는 최대 ${MAX_LENGTH}자까지 가능합니다.`);
  }

  const categories = countCategories(password);
  if (categories < MIN_CATEGORIES) {
    errors.push(
      `영문 대문자/영문 소문자/숫자/특수문자 중 ${MIN_CATEGORIES}종 이상 포함해야 합니다 (현재 ${categories}종).`
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function countCategories(s: string): number {
  let n = 0;
  if (/[A-Z]/.test(s)) n++;
  if (/[a-z]/.test(s)) n++;
  if (/\d/.test(s)) n++;
  // 특수문자: ASCII 33-126 중 영숫자 제외 + 공백·tab 도 특수 취급
  if (/[^A-Za-z0-9]/.test(s)) n++;
  return n;
}

/**
 * HIBP 유출 비밀번호 검사 (k-anonymity).
 * SHA-1 해시의 앞 5자만 전송 → 응답 list 에서 나머지 35자 매칭.
 * 비밀번호 자체는 절대 외부로 안 나감.
 */
export async function checkPwnedPassword(
  password: string
): Promise<{ ok: true; pwnedCount: number }> {
  if (process.env.SKIP_HIBP === "1") return { ok: true, pwnedCount: 0 };

  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: { "Add-Padding": "true" }, // 응답 패딩 (트래픽 패턴 분석 방어)
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) return { ok: true, pwnedCount: 0 }; // 비치명적
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const [hashSuffix, countStr] = line.split(":");
      if (hashSuffix?.trim().toUpperCase() === suffix) {
        const count = parseInt(countStr?.trim() ?? "0", 10);
        if (count > 0) return { ok: true, pwnedCount: count };
      }
    }
    return { ok: true, pwnedCount: 0 };
  } catch {
    // 네트워크 실패 → 통과시킴 (사용자 가입 막지 않음)
    return { ok: true, pwnedCount: 0 };
  }
}

/**
 * 전체 검증: 정책 + HIBP. 호출 단일 진입점.
 */
export async function validatePassword(
  password: string
): Promise<ValidationResult> {
  const policyResult = validatePasswordPolicy(password);
  if (!policyResult.ok) return policyResult;

  const hibp = await checkPwnedPassword(password);
  if (hibp.pwnedCount > 0) {
    return {
      ok: false,
      errors: [
        `이 비밀번호는 외부 유출 사례에서 ${hibp.pwnedCount.toLocaleString()}회 발견되었습니다. 다른 비밀번호를 사용해 주세요.`,
      ],
    };
  }
  return { ok: true };
}

/** UI 에서 보여줄 정책 요약 (한국어). */
export const POLICY_DESCRIPTION = [
  `최소 ${MIN_LENGTH}자 이상`,
  `영문 대/소문자·숫자·특수문자 중 ${MIN_CATEGORIES}종 이상 조합`,
  "유출된 비밀번호 차단 (외부 DB 자동 검증)",
] as const;

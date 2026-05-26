"use client";

/**
 * 비밀번호 강도 인디케이터. 정책 (lib/password-policy.ts) 의 클라이언트 미러.
 *
 * HIBP 는 클라이언트에서 안 부름 (서버에서 최종 검증). 정책 충족 여부만 실시간 시각화.
 */

const MIN_LENGTH = 10;
const MIN_CATEGORIES = 3;

type Check = { label: string; ok: boolean };

function evaluate(password: string): Check[] {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const categories = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean)
    .length;

  return [
    {
      label: `${MIN_LENGTH}자 이상 (현재 ${password.length}자)`,
      ok: password.length >= MIN_LENGTH,
    },
    {
      label: `영문 대/소·숫자·특수문자 중 ${MIN_CATEGORIES}종 이상 (현재 ${categories}종)`,
      ok: categories >= MIN_CATEGORIES,
    },
  ];
}

export function PasswordStrength({ password }: { password: string }) {
  if (!password) {
    return (
      <ul className="text-[11px] text-slate-400 mt-1 space-y-0.5">
        <li>· {MIN_LENGTH}자 이상</li>
        <li>· 영문 대/소·숫자·특수문자 중 {MIN_CATEGORIES}종 이상</li>
        <li>· 유출된 비밀번호 차단 (제출 시 자동 검증)</li>
      </ul>
    );
  }
  const checks = evaluate(password);
  return (
    <ul className="text-[11px] mt-1 space-y-0.5">
      {checks.map((c, i) => (
        <li key={i} className={c.ok ? "text-primary" : "text-ink-soft"}>
          {c.ok ? "✓" : "·"} {c.label}
        </li>
      ))}
      <li className="text-slate-400">· 유출 검사는 제출 시 서버에서 수행</li>
    </ul>
  );
}

export function passwordMeetsPolicy(password: string): boolean {
  return evaluate(password).every((c) => c.ok);
}

/**
 * 클래스 병합 유틸 — 외부 의존성(clsx/twMerge) 없이 falsy 값만 걸러 join.
 * Tailwind 충돌 해소(twMerge)는 하지 않으므로, 같은 속성을 덮어쓸 때는 호출부에서
 * 중복 클래스를 넣지 않도록 주의. 프리미티브 내부에선 충돌 없는 조합만 사용한다.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}

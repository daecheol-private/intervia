/**
 * 직급/연차(경력 요건) — 최소/최대 연차 range ↔ 텍스트 변환.
 * DB jobs.level 은 자유 텍스트 그대로 유지 — 폼·임포트에서만 range 로 다루고
 * 저장 시 formatCareerLevel 로 직렬화한다 (기존 공고의 구 버킷 라벨도 parse 가 해석).
 */

export type CareerRange = {
  /** 최소 연차. null = 경력무관 */
  min: number | null;
  /** 최대 연차. null = 상한 없음("N년 이상") */
  max: number | null;
};

export const CAREER_ANY = "경력무관";
export const CAREER_MAX_YEARS = 50;

/** 숫자/문자 입력을 0~50 정수 연차로. 해석 불가면 null. */
export function clampYears(v: unknown): number | null {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v)
        : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(CAREER_MAX_YEARS, Math.max(0, Math.round(n)));
}

/** range → 저장·표시 텍스트. 예: 신입 / 신입~5년 / 3~7년 / 10년 이상 / 경력무관 */
export function formatCareerLevel(r: CareerRange): string {
  const min = clampYears(r.min);
  let max = clampYears(r.max);
  if (min == null) return CAREER_ANY;
  if (max != null && max < min) max = null; // 뒤집힌 입력은 상한 없음으로 정규화
  if (max == null) return min === 0 ? CAREER_ANY : `${min}년 이상`;
  if (min === 0) return max === 0 ? "신입" : `신입~${max}년`;
  return min === max ? `${min}년` : `${min}~${max}년`;
}

/**
 * 텍스트 → range. formatCareerLevel 출력의 역변환이면서,
 * 구 5버킷 라벨("3~5년차 (중급)")·임포트 자유 텍스트("신입~경력 5년")도 최대한 해석.
 */
export function parseCareerLevel(text: string | null | undefined): CareerRange {
  const t = (text ?? "").trim();
  if (!t || t.includes("무관")) return { min: null, max: null };
  let m = t.match(/신입\s*[~〜∼–-]\s*(?:경력\s*)?(\d+)/);
  if (m) return { min: 0, max: clampYears(m[1]) };
  m = t.match(/(\d+)\s*[~〜∼–-]\s*(\d+)/);
  if (m) return { min: clampYears(m[1]), max: clampYears(m[2]) };
  m = t.match(/(\d+)\s*년\s*이상/);
  if (m) return { min: clampYears(m[1]), max: null };
  if (t.includes("신입")) return { min: 0, max: 0 };
  m = t.match(/(\d+)\s*년/);
  if (m) return { min: clampYears(m[1]), max: clampYears(m[1]) };
  return { min: null, max: null };
}

/** 폼 입력 상태 (checkbox + 숫자 input 2개, 값은 문자열). */
export type CareerInputs = { any: boolean; min: string; max: string };

export function careerInputsFrom(text: string | null | undefined): CareerInputs {
  const r = parseCareerLevel(text);
  return {
    any: r.min == null,
    min: r.min != null ? String(r.min) : "",
    max: r.max != null ? String(r.max) : "",
  };
}

export function careerInputsToText(c: CareerInputs): string {
  if (c.any) return CAREER_ANY;
  // 최소 미입력 + 최대만 입력 = "신입~최대"
  return formatCareerLevel({ min: clampYears(c.min) ?? 0, max: clampYears(c.max) });
}

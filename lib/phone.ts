/**
 * 전화번호 비교용 정규화 — 숫자만 남긴다.
 * 표시·저장은 원본을 쓰고, 중복 판정(사전 precheck + 제출 시)에만 사용한다.
 * 예: "010-1234-5678", "010 1234 5678", "(010)1234.5678" → "01012345678"
 */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^0-9]/g, "");
}

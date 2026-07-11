import { COMPANY_INFO } from "./site-info";

/**
 * 사용자 노출 오류 참조 코드 — 장애 안내문과 함께 표시하고, 같은 코드를 서버 로그에 남겨
 * 고객센터 문의(코드 첨부) 시 로그에서 발생 시각·원인을 역추적한다.
 * 시각 기반 + 랜덤 (충돌 확률만 낮으면 충분 — 보안 토큰 아님).
 */
export function newErrorRef(): string {
  const t = Date.now().toString(36).toUpperCase().slice(-5);
  const r = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `E-${t}${r}`;
}

/** 일시 장애 표준 안내문 (지원자·운영자 공용). */
export function transientErrorMessage(ref: string): string {
  return (
    "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. " +
    `문제가 계속되면 고객센터(${COMPANY_INFO.email})에 아래 오류 코드와 함께 문의해 주세요.\n` +
    `오류 코드: ${ref}`
  );
}

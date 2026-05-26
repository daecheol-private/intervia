/**
 * (DEPRECATED 2026-05-26)
 *
 * 이 스크립트는 직접 Gemini API (Google AI Studio) 의 Tier 1 자동승급을 위한
 * Pro 호출 반복기였습니다. 2026-05-26 모든 LLM 호출이 Vertex AI 서울 (flash) 로
 * 통합되면서 더 이상 의미가 없습니다.
 *
 * Vertex AI 는 GCP 결제 계정에 직접 청구되며 별도 "Tier 1 승급" 개념이 없습니다.
 * Quota 가 부족하면 Google Cloud Console → IAM/Quotas 에서 신청하세요.
 *
 * 호출 가능 여부 sanity check 는 `node scripts/test-gemini.mjs` 사용.
 */
console.error(
  "❌ DEPRECATED — 직접 Gemini API 제거로 본 스크립트는 더 이상 동작하지 않습니다.\n" +
    "   대체: node scripts/test-gemini.mjs (Vertex AI 3종 task 호출 검증)"
);
process.exit(1);

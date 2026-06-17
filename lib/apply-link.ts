/**
 * 공고별 공개 지원 링크 — /apply/[token].
 *
 * 후보자(비로그인)가 사람인·잡코리아 등에서 "지원하기" 로 넘어와 직접 이력서를 올리는 통로.
 * HR 이 공고에서 링크를 발급하면 job_postings.apply_token 이 채워지고, 그 토큰으로
 * 공개 페이지가 공고를 찾는다. 토큰은 추측 불가능해야 한다(공개 URL = 사실상의 인증).
 */
import { randomBytes } from "node:crypto";

/** 추측 불가능한 공개 지원 토큰. */
export function generateApplyToken(): string {
  return "ap_" + randomBytes(18).toString("base64url");
}

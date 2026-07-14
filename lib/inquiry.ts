/**
 * 고객센터 문의 공통 상수 — API(서버)와 폼·인박스 UI(클라이언트)가 함께 사용.
 *
 * 서버 의존성 없음(순수 상수)이라 "use client" 컴포넌트에서도 import 가능.
 */

export const INQUIRY_SOURCES = ["org_user", "candidate", "applicant"] as const;
export type InquirySource = (typeof INQUIRY_SOURCES)[number];

export const INQUIRY_STATUSES = ["open", "in_progress", "resolved"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/** 로그인 고객(org_admin/member) 문의 분류. */
export const ORG_CATEGORIES = [
  "bug",
  "billing",
  "howto",
  "account",
  "etc",
] as const;

/** 비로그인 후보자 면접 중 신고 분류. */
export const CANDIDATE_CATEGORIES = [
  "interview_error",
  "display",
  "access",
  "etc",
] as const;

/** 비로그인 지원자 지원 링크 페이지 신고 분류. */
export const APPLICANT_CATEGORIES = [
  "upload_error",
  "apply_error",
  "etc",
] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  bug: "버그·오류",
  billing: "결제·토큰",
  howto: "사용법 문의",
  account: "계정·로그인",
  interview_error: "면접 진행 오류",
  display: "화면 표시 문제",
  access: "면접 접속 불가",
  upload_error: "이력서 업로드 오류",
  apply_error: "지원서 제출 오류",
  etc: "기타",
};

export const STATUS_LABEL: Record<InquiryStatus, string> = {
  open: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

export const SOURCE_LABEL: Record<InquirySource, string> = {
  org_user: "고객",
  candidate: "후보자",
  applicant: "지원자",
};

export const MESSAGE_MIN = 5;
export const MESSAGE_MAX = 5000;

/** 선택 입력 연락 전화번호 최대 길이 (국가번호·구분자 포함 여유). */
export const PHONE_MAX = 40;

/** source 에 따라 허용되는 분류 코드인지 검증 (서버용). */
export function isValidCategory(source: InquirySource, category: string): boolean {
  const set =
    source === "org_user"
      ? ORG_CATEGORIES
      : source === "applicant"
        ? APPLICANT_CATEGORIES
        : CANDIDATE_CATEGORIES;
  return (set as readonly string[]).includes(category);
}

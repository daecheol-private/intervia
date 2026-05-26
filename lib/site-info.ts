/**
 * 회사·DPO·처리위탁 정보 — 처리방침/이용약관/메일 등에서 공통 사용.
 *
 * 변경 시 effective date 도 함께 갱신.
 * 향후 (1-2-6) DB 로 이전 시 이 모듈을 통해 한 곳에서 조회.
 */

export const SITE_INFO = {
  serviceName: "Intervia",
  serviceDescription: "AI 기반 채용 면접 플랫폼",
  baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3002",
} as const;

export const COMPANY_INFO = {
  name: "Intervia",
  representative: "강대철",
  bizRegistrationNo: "추후 등록 예정",
  address: "서울특별시 강서구 양천로 28길 29 마곡우림필유 101동 110호",
  phone: "010-7496-2696",
  email: "daecheol1983@gmail.com",
} as const;

export const DPO_INFO = {
  name: "강대철",
  title: "대표 (개인정보보호책임자 겸직)",
  email: "daecheol1983@gmail.com",
  phone: "010-7496-2696",
} as const;

/** 자동화 의사결정·이의제기 수신처. 현재는 DPO 와 동일. */
export const APPEAL_CONTACT = {
  email: DPO_INFO.email,
  description:
    "AI 평가 결과에 대한 설명 요청·이의제기는 위 이메일로 본인 확인 가능한 정보(이메일·면접 일자)와 함께 보내주세요. 영업일 기준 7일 이내 답변드립니다.",
} as const;

/** 처리위탁 업체 — PIPA §26 공개 의무. */
export type Processor = {
  name: string;
  purpose: string;
  items: string;
  country: string;
  retention: string;
};

export const PROCESSORS: readonly Processor[] = [
  {
    name: "Google Cloud (Vertex AI · Gemini)",
    purpose: "AI 서류 평가, AI 면접 채팅, 면접 응답 평가",
    items: "식별가능정보 자동 마스킹 처리한 이력서 텍스트 및 면접 대화록",
    country: "대한민국 (서울 리전 asia-northeast3) — 국외이전 없음",
    retention: "API 요청 처리 즉시 (Google 정책: 학습 미사용)",
  },
  {
    name: "Vercel Inc.",
    purpose: "웹 호스팅 및 서버리스 실행 환경",
    items: "서비스 전체 트래픽 및 요청 로그",
    country: "미국",
    retention: "30일 (로그 자동 폐기)",
  },
  {
    name: "Turso (chiselstrike, Inc.)",
    purpose: "데이터베이스 (사용자·후보자·평가 결과 저장)",
    items: "이름·이메일·이력서 정보·평가 결과",
    country: "일본 (도쿄 리전)",
    retention: "본 처리방침의 보유기간 정책과 동일",
  },
  {
    name: "Vercel Blob",
    purpose: "이력서 파일 저장소",
    items: "이력서 원본 파일 (PDF/DOCX)",
    country: "미국",
    retention: "합·불 결정 시점 즉시 폐기",
  },
  {
    name: "Have I Been Pwned (Troy Hunt)",
    purpose: "비밀번호 유출 검사 (k-anonymity)",
    items: "비밀번호 SHA-1 해시 앞 5자 (비밀번호 자체는 미전송)",
    country: "호주",
    retention: "조회 즉시 (저장 안 됨)",
  },
  {
    name: "SMTP 발송 서버 (법인별 설정)",
    purpose: "면접 안내 메일 발송",
    items: "후보자 이메일 주소, 면접 안내 본문",
    country: "법인이 등록한 SMTP 서버 위치",
    retention: "발송 즉시 (SMTP 서버 정책에 따름)",
  },
] as const;

/** 정책 본문 versioning — 본문 변경 시 effective date 올림. */
export const PRIVACY_EFFECTIVE_DATE = "2026-05-26";
export const TERMS_EFFECTIVE_DATE = "2026-05-22";

/** 가입 시 동의 시점 기록용 버전 식별자. 본문 개정 시 함께 갱신. */
export const PRIVACY_VERSION = "1.2.0-2026-05-26"; // 모든 LLM Vertex 서울 통합 — Google 미국 처리 항목 제거
export const TERMS_VERSION = "1.1.1-2026-05-22";

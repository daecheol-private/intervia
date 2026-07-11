/**
 * 회사·DPO·처리위탁 정보 — 처리방침/이용약관/메일 등에서 공통 사용.
 *
 * 변경 시 effective date 도 함께 갱신.
 * 향후 (1-2-6) DB 로 이전 시 이 모듈을 통해 한 곳에서 조회.
 */

export const SITE_INFO = {
  serviceName: "Intervia",
  serviceDescription: "AI 기반 채용 면접 플랫폼",
  baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3003",
} as const;

// 사업자(법적 주체) 정보 — 처리방침/약관/AI공개 하단 §10 표시 + 푸터 공통 사용.
//   name = 사업자 상호(법적 회사명, 본문의 '이하 "회사"'). 서비스 브랜드명은 serviceName.
//   구조: "아임인(대표 박은숙)이 운영하는 Intervia 서비스" (사업자등록 2026-06, 개인·일반과세).
//   address/phone 가 빈 문자열이면 화면에서 그 줄을 숨긴다(미확정 표기 노출 방지).
//   전자상거래법 §10 표시의무는 통신판매(유료 판매) 개시 시점에 발생 — 주소·전화는 그때까지 정비.
export const COMPANY_INFO = {
  name: "아임인", // 사업자 상호(법적 회사명)
  serviceName: "Intervia", // 운영 서비스 브랜드명
  representative: "박은숙",
  bizRegistrationNo: "496-57-01198",
  mailOrderSalesNo: "2026-서울강서-1773", // 통신판매업 신고번호(강서구청 지역경제과, 2026 신고) — 전자상거래법 §10 표시의무
  openDate: "2026-06-22", // 개업연월일 — 국세청 진위확인 API·org 레코드용(비공개 표시)
  address: "서울특별시 강서구 양천로28길 29, 101동 110호", // 사업장(자택) 주소 — 공개 표시 결정(자택 전체)
  phone: "0505-008-0222", // 대표 연락처(0505 안심번호 — 개인 휴대폰 대신 노출, 명의위장 리스크 완화)
  email: "admin.intervia@gmail.com",
} as const;

export const DPO_INFO = {
  name: "박은숙",
  title: "대표 (개인정보보호책임자 겸직)",
  email: "admin.intervia@gmail.com",
  phone: "", // 처리방침상 연락처는 이메일로 충분 — 개인 휴대폰 미노출
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
  contact: string; // 개인정보 문의처 (이메일 또는 privacy 정책 URL) — §28의8 이전받는 자 연락처
};

export const PROCESSORS: readonly Processor[] = [
  {
    name: "Google Cloud (Vertex AI · Gemini)",
    purpose: "AI 서류 평가, AI 면접 채팅, 면접 응답 평가",
    items:
      "식별가능정보 자동 마스킹 처리한 이력서 텍스트 및 면접 대화록. " +
      "스캔(이미지) PDF의 경우 텍스트 추출(OCR)을 위해 마스킹 전 원본이 전달될 수 있음(법인이 OCR을 허용한 경우에 한함). " +
      "장애 시 일본 임시 처리 대상은 마스킹된 텍스트만이며, 스캔 원본·음성 데이터는 항상 국내에서만 처리됨",
    country:
      "대한민국 (서울 리전 asia-northeast3) 원칙 — 서울 리전 장애 시에 한해 일본 (도쿄 리전 asia-northeast1) 임시 처리",
    retention: "API 요청 처리 즉시 (Google 정책: 학습 미사용)",
    contact: "https://policies.google.com/privacy",
  },
  {
    name: "Vercel Inc.",
    purpose: "웹 호스팅 및 서버리스 실행 환경",
    items: "서비스 전체 트래픽 및 요청 로그",
    country: "미국",
    retention: "30일 (로그 자동 폐기)",
    contact: "privacy@vercel.com",
  },
  {
    name: "Turso (chiselstrike, Inc.)",
    purpose: "데이터베이스 (사용자·후보자·평가 결과 저장)",
    items: "이름·이메일·이력서 정보·평가 결과",
    country: "일본 (도쿄 리전)",
    retention: "본 처리방침의 보유기간 정책과 동일",
    contact: "https://turso.tech/privacy-policy",
  },
  {
    name: "Vercel Blob",
    purpose: "이력서 파일 저장소",
    items: "이력서 원본 파일 (PDF/DOCX)",
    country: "미국",
    retention: "합·불 결정 시점 즉시 폐기",
    contact: "privacy@vercel.com",
  },
  {
    name: "Have I Been Pwned (Troy Hunt)",
    purpose: "비밀번호 유출 검사 (k-anonymity)",
    items: "비밀번호 SHA-1 해시 앞 5자 (비밀번호 자체는 미전송)",
    country: "호주",
    retention: "조회 즉시 (저장 안 됨)",
    contact: "https://haveibeenpwned.com/Privacy",
  },
  {
    name: "Resend (Resend, Inc.)",
    purpose: "시스템 기본 이메일 발송 (면접 안내·결과 통보·계정 인증 메일)",
    items: "후보자·사용자 이메일 주소 및 메일 본문",
    country: "미국",
    retention: "발송 처리 즉시 (본문 미보관, 발송 로그는 Resend 정책에 따름)",
    contact: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "법인 자체 SMTP 서버 (법인이 등록한 경우)",
    purpose: "면접 안내·결과 통보 메일 발송 (법인이 자체 SMTP 등록 시 Resend 대신 사용)",
    items: "후보자 이메일 주소, 면접 안내 본문",
    country: "법인이 등록한 SMTP 서버 위치",
    retention: "발송 즉시 (SMTP 서버 정책에 따름)",
    contact: "법인이 등록한 메일 서버 운영 주체의 문의처",
  },
] as const;

/** 정책 본문 versioning — 본문 변경 시 effective date 올림. */
export const PRIVACY_EFFECTIVE_DATE = "2026-07-12";
export const TERMS_EFFECTIVE_DATE = "2026-06-30";

/** 가입 시 동의 시점 기록용 버전 식별자. 본문 개정 시 함께 갱신. */
export const PRIVACY_VERSION = "1.5.0-2026-07-12"; // AI 처리 장애 폴백 국외이전 고지 신설(§28의8): 서울 리전 장애 시에 한해 마스킹 텍스트만 Google LLC 일본 도쿄 리전 임시 처리 가능, 스캔 원본·음성은 항상 국내. 시행일: §12 7일 공지 기준 07-18 예정이었으나 서비스 개시 전(기존 정보주체 부재)이라 게시 즉시 시행으로 조정(사용자 결정 2026-07-12). (이전: 1.4.1 — 사업자정보 확정 기재 + 개인정보보호책임자 박은숙)
export const TERMS_VERSION = "1.3.0-2026-06-30"; // 제7조에 토큰 유효기간(유상=충전일+5년·경과 시 소멸)·양도/환금 불가 조항 신설 — PG 결제 연동 요건(전자상거래법 표시사항). 결제 라이브 전 확정이라 소급 불리 이슈 없음. (이전: 1.2.3 — 사업자정보 확정 기재)

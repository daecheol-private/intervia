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
  address: "서울특별시 강서구 양천로28길 29, 101동 110호", // 사업장(자택) 주소 — 신고 주소 전문 유지. 푸터에서는 '사업자정보' 토글 안에 넣어 상시 노출만 피한다(Footer.tsx)
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
    name: "(주) 엑스퍼넷",
    purpose:
      "메일 발송 서버 운영 (면접 안내·결과 통보·계정 인증 메일 발송) — 기본 발송 경로",
    items: "후보자·사용자 이메일 주소 및 메일 본문",
    country: "대한민국",
    retention: "발송 처리 즉시 (본문 미보관, 서버 발송 로그는 해당 서버 정책에 따름)",
    contact: "본 처리방침 §10 개인정보 보호책임자",
  },
  {
    name: "Resend (Resend, Inc.)",
    purpose:
      "이메일 발송의 대체 경로 (기본 발송 서버 점검·장애 시에 한해 면접 안내·결과 통보·계정 인증 메일 발송)",
    items: "후보자·사용자 이메일 주소 및 메일 본문",
    country: "미국",
    retention: "발송 처리 즉시 (본문 미보관, 발송 로그는 Resend 정책에 따름)",
    contact: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "법인 자체 SMTP 서버 (법인이 등록한 경우)",
    purpose: "면접 안내·결과 통보 메일 발송 (법인이 자체 SMTP 를 등록한 경우 그 서버로 발송)",
    items: "후보자 이메일 주소, 면접 안내 본문",
    country: "법인이 등록한 SMTP 서버 위치",
    retention: "발송 즉시 (SMTP 서버 정책에 따름)",
    contact: "법인이 등록한 메일 서버 운영 주체의 문의처",
  },
] as const;

/** 정책 본문 versioning — 본문 변경 시 effective date 올림. */
export const PRIVACY_EFFECTIVE_DATE = "2026-07-17";
export const TERMS_EFFECTIVE_DATE = "2026-09-04";

/** 가입 시 동의 시점 기록용 버전 식별자. 본문 개정 시 함께 갱신. */
// (버전 무변경) 2026-07-25 — 메일 발송 주 경로가 국내 서버로 전환되어 §5 PROCESSORS·본문에서
// Resend 를 '대체 발송 경로(점검·장애 시)'로 성격 정정. 국외이전 축소·정확화라 재동의 불요로
// 판단해 버전 유지(사용자 결정). ⚠️ 주 발송 서버 수탁자 행은 위탁 근거 확정 후 추가 — USER_TODO C-4-2.
export const PRIVACY_VERSION = "1.6.0-2026-07-17"; // §3 보유기간 표에 로그인 세션 기록(접속 IP·User-Agent) 행 신설 — §2 수집항목엔 있었으나 보유기간이 표에 없어 법정 기재사항(PIPA §30①2호) 누락 상태였다. 실제 파기도 함께 이행(cleanupExpiredSessions 를 일일 cron 에 배선 — 기존엔 해당 토큰 재요청 시에만 lazy 삭제라 무기한 잔존). 파기 강화라 정보주체에 불리한 변경이 아니어서 재동의 불요. 시행일: §12 7일 공지 기준 07-24 예정이었으나 서비스 개시 전(기존 정보주체 부재)이라 게시 즉시 시행으로 조정(사용자 결정 2026-07-17 — 1.5.0 과 동일 논리). (이전: 1.5.0 — AI 처리 장애 폴백 국외이전 고지 신설)
export const TERMS_VERSION = "1.5.0-2026-09-04"; // §7-2 환불 청구 기한을 "언제든"(무기한) → 결제일로부터 1년 이내로 한정 — 토스페이먼츠 가맹 심사 요건(2026-09-04 회신: "무기한 환불이 가능한 형태는 심사 불가"). §7 토큰 유효기간이 이미 1년이라 무기한 환급 조항은 그와 모순이었고, 유효기간이 지나면 잔액이 소멸해 환급 대상 자체가 없다 — 실질 불이익 없는 정합성 정정. §8 장애 보상은 "토큰 환불" → "토큰 복구"로 표현 정정(현금 환급은 §7-2로 귀속), §7 단가 인상·§10 해지·§12 개정 조항의 환급도 §7-2 참조로 기한 귀속. 형식상 불리한 변경(§12 30일 공지 대상)이나 운영 DB 확인 결과 유상 충전 이력 0건(payment_orders: failed 4건뿐, charge ledger 0) → 통지 대상 부재로 게시 즉시 시행(1.4.0 과 동일 논리). 유상 충전이 시작된 뒤 환불 기한을 더 줄이려면 §12 30일 공지 필요. (이전: 1.4.0 — 제7조 토큰 유효기간 5년 → 1년 — 토스페이먼츠 가맹 심사 요건(서비스 제공기간 1년 초과 시 입점 불가, 2026-08-18 담당자 회신). 형식상 불리한 변경(§12 30일 공지 대상)이나 카드결제 dormant 로 유상 충전 이력이 없어 통지 대상 부재 → 게시 즉시 시행(1.6.0 개인정보처리방침과 동일 논리). 유상 충전이 시작된 뒤 유효기간을 더 줄이려면 §12 30일 공지 필요. (이전: 1.3.0 — 토큰 유효기간·양도/환금 불가 조항 신설)

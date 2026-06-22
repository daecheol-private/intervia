// 오픈베타 가격 정책 — 단일 소스 (정가·할인가·기간·표시문구).
// ⚠️ 클라이언트 컴포넌트에서도 import 하므로 서버 전용(db 등) 의존을 두지 말 것.
//
// 표시/과금 규칙:
// - LIST_PRICING       : 정가(앵커). UI 에 취소선으로 노출해 기준가(AI 면접 3,000원)를 유지한다.
// - BETA_PRICING       : 오픈베타 할인가 — AI 면접·대면 면접 평가만 30→10 토큰(3,000→1,000원).
//                        이력서 평가(300원)는 그대로(이미 장벽이 아니라 인하 실익 없음).
// - EFFECTIVE_PRICING  : 실제 차감 단가. lib/tokens.ts 의 DEFAULT_PRICING 이 이 값을 쓴다.
//
// 종료 / 연장:
// - 가격은 날짜로 자동 복귀하지 않는다 (자정에 고객 단가가 갑자기 3배 되는 사고 방지).
//   · 베타 종료: BETA.active=false 로 바꾸면 즉시 정가(LIST_PRICING)로 복귀.
//   · 기간 연장: endsAtLabel 만 수정 (표시용 라벨).
// - ⚠️ 운영 token_pricing 테이블에 override 행이 있으면 getPricing 에서 그 값이 우선한다.
//   현재는 override 없음 = 코드 기본값(베타가)이 적용된다. 배포 후 /admin/pricing 또는
//   /org/tokens 에서 AI 면접이 10 토큰으로 보이는지 확인할 것. 30 으로 보이면 override 가 있는
//   것이므로 /admin/pricing 에서 10 으로 저장하면 된다.

type Key =
  | "job_post"
  | "resume_upload"
  | "interview"
  | "interview_question_gen"
  | "offline_interview";

export const TOKEN_KRW = 100; // 100원 = 1 토큰

/** 정가(앵커) — 베타 종료 후 복귀 단가. */
export const LIST_PRICING: Record<Key, number> = {
  job_post: 0,
  resume_upload: 3,
  interview: 30,
  interview_question_gen: 0,
  offline_interview: 30,
};

/** 오픈베타 표시 정보. 종료 시 active=false. */
export const BETA = {
  active: true,
  label: "오픈베타",
  endsAtLabel: "2026년 7월 31일",
  note: "오픈베타 기간이며, 기간·가격은 변동될 수 있습니다.",
} as const;

/** 오픈베타 적용 단가 — AI 면접·대면 면접 평가만 인하. */
export const BETA_PRICING: Record<Key, number> = {
  ...LIST_PRICING,
  interview: 10,
  offline_interview: 10,
};

/** 실제 차감 단가 — 베타 활성 시 할인가, 아니면 정가. */
export const EFFECTIVE_PRICING: Record<Key, number> = BETA.active
  ? BETA_PRICING
  : LIST_PRICING;

/** 정가 대비 베타 할인 중인 기능인지 (UI 취소선 판단용). */
export function isBetaDiscounted(key: Key): boolean {
  return BETA.active && EFFECTIVE_PRICING[key] < LIST_PRICING[key];
}

// ──────────────── 토큰 충전 패키지 ────────────────
// 결제(토스) 충전 시 선택 가능한 KRW 금액 — 단일 소스.
// /org/tokens 카드 표시 + checkout 라우트의 허용 금액 검증이 같은 목록을 쓴다
// (클라이언트가 임의 금액으로 주문 생성하는 것을 차단).
// ⚠️ bonusPct 는 표시용 — 실제 지급 토큰은 서버의 calcTokensForKrw(=CHARGE_BONUS_TIERS)가
//    권위. 두 값은 일치해야 한다(여기 금액 구간 ↔ lib/tokens.ts CHARGE_BONUS_TIERS).
export const CHARGE_PACKAGES: ReadonlyArray<{
  krw: number;
  bonusPct: number;
  popular?: boolean;
}> = [
  { krw: 50_000, bonusPct: 0 },
  { krw: 100_000, bonusPct: 5 },
  { krw: 300_000, bonusPct: 10, popular: true },
  { krw: 500_000, bonusPct: 15 },
  { krw: 1_000_000, bonusPct: 20 },
];

/** checkout 허용 금액인지 — 임의 금액 주문 차단용. */
export function isAllowedChargeAmount(krw: number): boolean {
  return CHARGE_PACKAGES.some((p) => p.krw === krw);
}

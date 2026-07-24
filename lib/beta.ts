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

/**
 * 부가가치세 — 충전은 'VAT 별도' 정책. 패키지 표시가(krw)는 공급가액이고,
 * 실제 카드 결제액 = 공급가 × (1 + VAT_RATE). payment_orders.amount_krw 에는 공급가를
 * 저장(토큰 계산·tokens 컬럼 기준)하고, 토스에 청구·대조하는 금액은 항상 withVat() 로 파생한다.
 * 한국 부가세 10% 고정 — 모든 CHARGE_PACKAGES 가 ×1.1 정수로 떨어진다(5만→5.5만 …).
 */
export const VAT_RATE = 0.1;
export function withVat(supplyKrw: number): number {
  return Math.round(supplyKrw * (1 + VAT_RATE));
}

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
  endsAtLabel: "2026년 8월 31일",
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

// ──────────────── 토큰 충전 패키지 / 충전 보너스 ────────────────
// 결제(토스) 충전 시 선택 가능한 KRW 금액 + 구간별 보너스 % — 단일 소스.
// /org/tokens 카드 표시 + 랜딩 + checkout 라우트의 허용 금액 검증 + 서버 지급 계산이
// 모두 같은 목록을 쓴다 (클라이언트가 임의 금액으로 주문 생성하는 것을 차단).
//
// 오픈베타 동안은 가격 인하(30→10)와 같은 방식으로 충전 보너스도 ×배 해서 지급한다.
//   · BETA.active=true + BETA_BONUS_MULTIPLIER=2 → 정가 보너스(5/10/15/20%)의 2배.
//   · 베타 종료(BETA.active=false): 자동으로 정가 보너스(LIST_CHARGE_BONUS)로 복귀.
// CHARGE_PACKAGES.bonusPct 는 실제 적용(베타 반영) %, listBonusPct 는 정가 %(UI 취소선용).
//
// ⚠️ bonusPct 와 서버 지급(calcTokensForKrw=CHARGE_BONUS_TIERS)은 둘 다 여기서 파생되므로
//    표시와 실제 지급이 항상 일치한다 — 한쪽만 고치지 말 것.

/** 오픈베타 충전 보너스 배수 — 베타 동안 보너스 토큰 N배. 종료 시 정가로 자동 복귀. */
export const BETA_BONUS_MULTIPLIER = 2;

/** 정가(앵커) 충전 보너스 — krw 결제 구간별 %. 베타 종료 후 복귀값. */
const LIST_CHARGE_BONUS: ReadonlyArray<{
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

/** 실제 충전 패키지 — 베타 활성 시 보너스 배수를 적용한 값. */
export const CHARGE_PACKAGES: ReadonlyArray<{
  krw: number;
  /** 실제 적용 보너스 % (베타 반영). 서버 지급·UI 표시 모두 이 값. */
  bonusPct: number;
  /** 정가 보너스 % (UI 취소선·비교용). */
  listBonusPct: number;
  popular?: boolean;
}> = LIST_CHARGE_BONUS.map((p) => ({
  krw: p.krw,
  listBonusPct: p.bonusPct,
  bonusPct: BETA.active ? p.bonusPct * BETA_BONUS_MULTIPLIER : p.bonusPct,
  popular: p.popular,
}));

/** 충전 보너스가 배수 적용(부스트) 중인지 — UI '2배 혜택' 배너 판단용. */
export const CHARGE_BONUS_BOOSTED = BETA.active && BETA_BONUS_MULTIPLIER > 1;

/**
 * 충전 보너스 구간 — 서버 지급 계산(lib/tokens.ts calcTokensForKrw)의 권위 소스.
 * CHARGE_PACKAGES(=베타 반영)에서 파생하므로 UI 표시와 항상 일치한다.
 * calcTokensForKrw 는 `krw >= minKrw` 인 첫 구간을 쓰므로 minKrw 내림차순 + 맨 끝 0% 백스톱.
 * bonusPct 는 정수 % — 지급은 `Math.floor(base * bonusPct / 100)` (부동소수 드리프트 방지).
 */
export const CHARGE_BONUS_TIERS: ReadonlyArray<{
  minKrw: number;
  bonusPct: number;
}> = [
  ...[...CHARGE_PACKAGES]
    .filter((p) => p.bonusPct > 0)
    .sort((a, b) => b.krw - a.krw)
    .map((p) => ({ minKrw: p.krw, bonusPct: p.bonusPct })),
  { minKrw: 0, bonusPct: 0 },
];

/** checkout 허용 금액인지 — 임의 금액 주문 차단용. */
export function isAllowedChargeAmount(krw: number): boolean {
  return CHARGE_PACKAGES.some((p) => p.krw === krw);
}

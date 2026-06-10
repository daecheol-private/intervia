import { db } from "./db";
import { tokenWallets, tokenLedger, tokenPricing } from "./schema";
import { and, desc, eq, lt, sql } from "drizzle-orm";

export type FeatureKey =
  | "job_post"
  | "resume_upload"
  | "interview"
  | "interview_question_gen";
export type LedgerReason =
  | "charge"
  | "job_post"
  | "resume_upload"
  | "interview"
  | "interview_question_gen"
  | "job_extend"
  | "refund"
  | "admin_adjust";

// 100원당 1 토큰 기준 — 정책 변경 시 /admin/pricing 에서 override.
// 공고 1,000원 / 이력서 200원 / 면접 1,000원 / 면접 문제 생성 500원.
const DEFAULT_PRICING: Record<FeatureKey, number> = {
  job_post: 10,
  resume_upload: 2,
  interview: 10,
  interview_question_gen: 5,
};

// 법인 최초 등록 시 1회 자동 지급 — 무료 체험용 (5만원).
// 기존 법인 합류(invite/join-request)에는 지급 X. 함수는 orgId 기준 멱등.
export const WELCOME_BONUS_TOKENS = 500;

/**
 * 충전 보너스 정책 — KRW 결제액에 따라 추가 지급 토큰 계산.
 * 100원당 1 토큰 + 구간별 보너스.
 */
export const CHARGE_BONUS_TIERS: ReadonlyArray<{
  minKrw: number;
  bonusRatio: number;
}> = [
  { minKrw: 1_000_000, bonusRatio: 0.2 }, // 100만원+ → 20%
  { minKrw: 500_000, bonusRatio: 0.15 }, // 50만원+ → 15%
  { minKrw: 300_000, bonusRatio: 0.1 }, // 30만원+ → 10%
  { minKrw: 100_000, bonusRatio: 0.05 }, // 10만원+ → 5%
  { minKrw: 0, bonusRatio: 0 },
];

/** KRW 금액 → 지급 토큰 (기본 + 보너스) 계산. */
export function calcTokensForKrw(krw: number): {
  base: number;
  bonus: number;
  total: number;
  bonusRatio: number;
} {
  if (krw <= 0) return { base: 0, bonus: 0, total: 0, bonusRatio: 0 };
  const base = Math.floor(krw / 100);
  const tier =
    CHARGE_BONUS_TIERS.find((t) => krw >= t.minKrw) ??
    CHARGE_BONUS_TIERS[CHARGE_BONUS_TIERS.length - 1];
  const bonus = Math.floor(base * tier.bonusRatio);
  return { base, bonus, total: base + bonus, bonusRatio: tier.bonusRatio };
}

export async function getPricing(key: FeatureKey): Promise<number> {
  const [row] = await db
    .select({ cost: tokenPricing.cost })
    .from(tokenPricing)
    .where(eq(tokenPricing.featureKey, key));
  return row?.cost ?? DEFAULT_PRICING[key];
}

export async function getAllPricing(): Promise<Record<FeatureKey, number>> {
  const rows = await db.select().from(tokenPricing);
  const map: Record<FeatureKey, number> = { ...DEFAULT_PRICING };
  for (const r of rows) {
    map[r.featureKey as FeatureKey] = r.cost;
  }
  return map;
}

/**
 * 법인 최초 등록 시 무료 체험 토큰 지급. 멱등 — 같은 orgId 에 두 번 호출해도 한 번만 지급.
 * 호출 위치: `/api/orgs` (신규 법인 생성) 1곳만. 기존 법인 합류 경로에서는 호출 X.
 */
export async function grantWelcomeBonus(
  orgId: number,
  userId: number | null
): Promise<{ granted: number; balance: number }> {
  // 이미 welcome bonus 받았으면 skip
  const [existing] = await db
    .select({ id: tokenLedger.id })
    .from(tokenLedger)
    .where(
      and(
        eq(tokenLedger.orgId, orgId),
        eq(tokenLedger.reason, "admin_adjust"),
        eq(tokenLedger.refType, "welcome_bonus")
      )
    );
  if (existing) {
    const b = await getBalance(orgId);
    return { granted: 0, balance: b };
  }
  const { balance, applied } = await writeLedgerIdempotent({
    orgId,
    delta: WELCOME_BONUS_TOKENS,
    reason: "admin_adjust",
    refType: "welcome_bonus",
    refId: orgId,
    userId,
    memo: `법인 최초 등록 무료 체험 ${WELCOME_BONUS_TOKENS} 토큰`,
  });
  return { granted: applied ? WELCOME_BONUS_TOKENS : 0, balance };
}

/**
 * 결제 충전 — 기본 토큰 + 보너스 토큰을 한 번에 ledger 에 적재.
 * 멱등: 같은 paymentOrderId 로 두 번 호출해도 한 번만 적립.
 */
export async function applyChargePayment(args: {
  orgId: number;
  paymentOrderId: number;
  amountKrw: number;
  userId?: number | null;
}): Promise<{
  alreadyApplied: boolean;
  base: number;
  bonus: number;
  balance: number;
}> {
  const [existing] = await db
    .select({ id: tokenLedger.id })
    .from(tokenLedger)
    .where(
      and(
        eq(tokenLedger.orgId, args.orgId),
        eq(tokenLedger.reason, "charge"),
        eq(tokenLedger.refType, "payment_order"),
        eq(tokenLedger.refId, args.paymentOrderId)
      )
    );
  if (existing) {
    const b = await getBalance(args.orgId);
    return { alreadyApplied: true, base: 0, bonus: 0, balance: b };
  }
  const { base, bonus, total, bonusRatio } = calcTokensForKrw(args.amountKrw);
  if (total <= 0) {
    const b = await getBalance(args.orgId);
    return { alreadyApplied: false, base: 0, bonus: 0, balance: b };
  }
  const { balance, applied } = await writeLedgerIdempotent({
    orgId: args.orgId,
    delta: total,
    reason: "charge",
    refType: "payment_order",
    refId: args.paymentOrderId,
    userId: args.userId,
    memo:
      bonus > 0
        ? `${args.amountKrw.toLocaleString()}원 충전 (기본 ${base} + 보너스 ${bonus} = ${total} 토큰, 보너스 ${Math.round(bonusRatio * 100)}%)`
        : `${args.amountKrw.toLocaleString()}원 충전 (${base} 토큰)`,
  });
  // race — 동시 webhook 이 먼저 적립한 경우 이중 적립 방지
  if (!applied) {
    return { alreadyApplied: true, base: 0, bonus: 0, balance };
  }
  return { alreadyApplied: false, base, bonus, balance };
}

export async function ensureWallet(orgId: number): Promise<number> {
  const [row] = await db
    .select({ balance: tokenWallets.balance })
    .from(tokenWallets)
    .where(eq(tokenWallets.orgId, orgId));
  if (row) return row.balance;
  await db.insert(tokenWallets).values({ orgId, balance: 0 });
  return 0;
}

export async function getBalance(orgId: number): Promise<number> {
  return ensureWallet(orgId);
}

async function writeLedger(args: {
  orgId: number;
  delta: number;
  reason: LedgerReason;
  refType?: string | null;
  refId?: number | null;
  userId?: number | null;
  memo?: string | null;
}): Promise<number> {
  // H4 — 원자적 차감/증가. SELECT-then-UPDATE 패턴은 두 동시 호출이 같은 current 를 읽고
  // 둘 다 같은 next 로 덮어쓰는 race 발생 (실제 차감은 1회만 적용된 결과). 단일 UPDATE
  // + RETURNING balance 로 race 차단. 멱등 가드는 호출자 (chargeFeature 등) 에서 처리.
  await ensureWallet(args.orgId);
  const updated = await db
    .update(tokenWallets)
    .set({
      balance: sql`${tokenWallets.balance} + ${args.delta}`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tokenWallets.orgId, args.orgId))
    .returning({ balance: tokenWallets.balance });
  const next = updated[0]?.balance ?? 0;
  await db.insert(tokenLedger).values({
    orgId: args.orgId,
    delta: args.delta,
    reason: args.reason,
    refType: args.refType ?? null,
    refId: args.refId ?? null,
    balanceAfter: next,
    createdByUserId: args.userId ?? null,
    memo: args.memo ?? null,
  });
  return next;
}

/**
 * 멱등 ledger 적재 — INSERT 를 먼저 시도(token_ledger_idem_uq 부분 유니크 인덱스가 게이트).
 * UNIQUE 위반이면 이미 적용된 것 → **지갑 변경 없이** applied=false 반환 (동시 중복 요청 race 의
 * 이중 차감/이중 적립 차단). 성공한 호출만 지갑을 원자적으로 갱신하고 balanceAfter 를 보정한다.
 *
 * 대상: chargeFeature / refundFeature / grantWelcomeBonus / applyChargePayment
 * (모두 refType 가 non-null 이고 'manual_refund' 가 아니라 인덱스 커버 범위).
 */
export async function writeLedgerIdempotent(args: {
  orgId: number;
  delta: number;
  reason: LedgerReason;
  refType: string;
  refId: number;
  userId?: number | null;
  memo?: string | null;
}): Promise<{ balance: number; applied: boolean }> {
  await ensureWallet(args.orgId);
  let ledgerId: number;
  try {
    const ins = await db
      .insert(tokenLedger)
      .values({
        orgId: args.orgId,
        delta: args.delta,
        reason: args.reason,
        refType: args.refType,
        refId: args.refId,
        balanceAfter: 0, // 지갑 갱신 후 보정
        createdByUserId: args.userId ?? null,
        memo: args.memo ?? null,
      })
      .returning({ id: tokenLedger.id });
    ledgerId = ins[0].id;
  } catch (e) {
    if (/unique constraint/i.test(String(e))) {
      return { balance: await getBalance(args.orgId), applied: false };
    }
    throw e;
  }
  const updated = await db
    .update(tokenWallets)
    .set({
      balance: sql`${tokenWallets.balance} + ${args.delta}`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tokenWallets.orgId, args.orgId))
    .returning({ balance: tokenWallets.balance });
  const next = updated[0]?.balance ?? 0;
  await db
    .update(tokenLedger)
    .set({ balanceAfter: next })
    .where(eq(tokenLedger.id, ledgerId));
  return { balance: next, applied: true };
}

/**
 * 기능 사용 시 차감. pricing 시점 기준. 잔액 마이너스 허용 (후불).
 * 이미 동일 (refType, refId, reason) 으로 차감된 적 있으면 중복 차감 방지.
 */
export async function chargeFeature(args: {
  orgId: number;
  feature: FeatureKey;
  refType: string;
  refId: number;
  userId?: number | null;
  memo?: string | null;
}): Promise<{ cost: number; balance: number; alreadyCharged: boolean }> {
  const [existing] = await db
    .select({ id: tokenLedger.id })
    .from(tokenLedger)
    .where(
      and(
        eq(tokenLedger.orgId, args.orgId),
        eq(tokenLedger.reason, args.feature),
        eq(tokenLedger.refType, args.refType),
        eq(tokenLedger.refId, args.refId)
      )
    );
  if (existing) {
    const b = await getBalance(args.orgId);
    return { cost: 0, balance: b, alreadyCharged: true };
  }

  const cost = await getPricing(args.feature);
  const prevBalance = await getBalance(args.orgId);
  const { balance, applied } = await writeLedgerIdempotent({
    orgId: args.orgId,
    delta: -cost,
    reason: args.feature,
    refType: args.refType,
    refId: args.refId,
    userId: args.userId,
    memo: args.memo,
  });
  // race — 동시 요청이 먼저 차감함. 중복 차감 아님.
  if (!applied) {
    return { cost: 0, balance, alreadyCharged: true };
  }
  // 잔액이 양수 → 0 이하로 떨어지는 순간 1회만 알림 (스팸 방지)
  if (prevBalance > 0 && balance <= 0) {
    void (async () => {
      try {
        const { notifyOrgAdmins } = await import("./notifications");
        await notifyOrgAdmins(
          args.orgId,
          {
            type: "low_balance",
            title: `토큰 잔액이 부족합니다 (현재 ${balance} 토큰). 충전이 필요합니다.`,
            href: "/org/tokens",
            payload: { orgId: args.orgId, balance },
          },
          // 충전 전까지 메일·평가 기능 정지 — 관리자에게 메일로도 통지.
          { email: true }
        );
      } catch {
        /* 알림 실패는 차감 자체에 영향 없음 */
      }
    })();
  }
  return { cost, balance, alreadyCharged: false };
}

/**
 * 후차감(성공마다) — 같은 (feature, refId) 에 대해 작업이 성공할 때마다 **매번** 차감한다.
 * 기존 차감 횟수 N 을 세어 회차별 refType(`{baseRefType}` / `{baseRefType}_re{N}`)으로 분리하므로
 * 재평가/재생성이 성공할 때마다 1건씩 과금된다(첫 성공 N=0 → baseRefType 그대로).
 * 같은 회차의 동시 중복 요청은 token_ledger_idem_uq 가 이중 차감을 차단(멱등 백스톱).
 *
 * 1회성(공고 생성 등)은 기존 chargeFeature 를 그대로 쓰고, 재평가/재생성이 매번 과금되어야
 * 하는 기능(AI 면접 평가·면접 문제 생성)만 이 함수를 쓴다.
 */
export async function chargeRepeatable(args: {
  orgId: number;
  feature: FeatureKey;
  baseRefType: string;
  refId: number;
  userId?: number | null;
  memo?: string | null;
}): Promise<{ cost: number; balance: number; alreadyCharged: boolean }> {
  const prior = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(tokenLedger)
    .where(
      and(
        eq(tokenLedger.orgId, args.orgId),
        eq(tokenLedger.reason, args.feature),
        eq(tokenLedger.refId, args.refId),
        lt(tokenLedger.delta, 0)
      )
    );
  const n = Number(prior[0]?.c ?? 0);
  const refType = n === 0 ? args.baseRefType : `${args.baseRefType}_re${n}`;
  return chargeFeature({
    orgId: args.orgId,
    feature: args.feature,
    refType,
    refId: args.refId,
    userId: args.userId,
    memo: args.memo,
  });
}

/**
 * 차감 환불. 동일 (refType, refId, feature) 의 가장 최근 차감 금액만큼 +로 ledger 추가.
 * 이미 환불된 적 있으면 no-op.
 */
export async function refundFeature(args: {
  orgId: number;
  feature: FeatureKey;
  refType: string;
  refId: number;
  userId?: number | null;
  memo?: string | null;
}): Promise<{ refunded: number; balance: number }> {
  const [charge] = await db
    .select()
    .from(tokenLedger)
    .where(
      and(
        eq(tokenLedger.orgId, args.orgId),
        eq(tokenLedger.reason, args.feature),
        eq(tokenLedger.refType, args.refType),
        eq(tokenLedger.refId, args.refId)
      )
    )
    .orderBy(desc(tokenLedger.id))
    .limit(1);
  if (!charge) {
    const b = await getBalance(args.orgId);
    return { refunded: 0, balance: b };
  }

  const [existingRefund] = await db
    .select({ id: tokenLedger.id })
    .from(tokenLedger)
    .where(
      and(
        eq(tokenLedger.orgId, args.orgId),
        eq(tokenLedger.reason, "refund"),
        eq(tokenLedger.refType, args.refType),
        eq(tokenLedger.refId, args.refId)
      )
    );
  if (existingRefund) {
    const b = await getBalance(args.orgId);
    return { refunded: 0, balance: b };
  }

  const amount = -charge.delta; // delta는 음수
  const { balance, applied } = await writeLedgerIdempotent({
    orgId: args.orgId,
    delta: amount,
    reason: "refund",
    refType: args.refType,
    refId: args.refId,
    userId: args.userId,
    memo: args.memo ?? `refund for ${args.feature}`,
  });
  return { refunded: applied ? amount : 0, balance };
}

/**
 * 시스템 관리자 수동 충전/조정. delta는 음수도 가능.
 */
export async function adjustTokens(args: {
  orgId: number;
  delta: number;
  userId: number;
  memo?: string | null;
}): Promise<{ balance: number }> {
  const balance = await writeLedger({
    orgId: args.orgId,
    delta: args.delta,
    reason: "admin_adjust",
    userId: args.userId,
    memo: args.memo ?? null,
  });
  return { balance };
}

/**
 * 시스템 관리자 수동 환불. `adjustTokens` 와 다른 점:
 *   - ledger reason 이 명확히 `refund` (집계·감사 시 일반 조정과 구분)
 *   - 사유 (reason) 필수. 5자 이상.
 *   - 원본 ledger id 옵션 — 어떤 거래 환불인지 추적 (refType="manual_refund", refId=원본 ledger.id)
 *   - delta 는 부호 자유:
 *     + 양수: 토큰을 다시 적립 (예: 호의 환불, 서비스 장애 보상)
 *     - 음수: 토큰을 회수 (예: 결제 취소 → 외부로 환불해줬으니 토큰 회수)
 *
 * 멱등 X — 같은 사용자가 같은 이유로 두 번 호출하면 두 번 적용됨.
 * 운영 가드: API 라우트에서 sysadmin role 확인 + 감사 로그 작성 필수.
 */
export async function refundTokens(args: {
  orgId: number;
  delta: number;
  reason: string;
  userId: number;
  sourceLedgerId?: number | null;
}): Promise<{ balance: number; ledgerId: number }> {
  const reason = args.reason.trim();
  if (reason.length < 5) {
    throw new Error("환불 사유는 5자 이상이어야 합니다.");
  }
  if (!Number.isInteger(args.delta) || args.delta === 0) {
    throw new Error("환불 수량은 0이 아닌 정수여야 합니다.");
  }
  const current = await ensureWallet(args.orgId);
  const next = current + args.delta;
  await db
    .update(tokenWallets)
    .set({ balance: next, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(tokenWallets.orgId, args.orgId));
  const inserted = await db
    .insert(tokenLedger)
    .values({
      orgId: args.orgId,
      delta: args.delta,
      reason: "refund",
      refType: "manual_refund",
      refId: args.sourceLedgerId ?? null,
      balanceAfter: next,
      createdByUserId: args.userId,
      memo: reason,
    })
    .returning({ id: tokenLedger.id });
  return { balance: next, ledgerId: inserted[0].id };
}

export async function listLedger(
  orgId: number,
  limit = 100
): Promise<
  {
    id: number;
    delta: number;
    reason: LedgerReason;
    refType: string | null;
    refId: number | null;
    balanceAfter: number;
    memo: string | null;
    createdAt: string;
  }[]
> {
  const rows = await db
    .select({
      id: tokenLedger.id,
      delta: tokenLedger.delta,
      reason: tokenLedger.reason,
      refType: tokenLedger.refType,
      refId: tokenLedger.refId,
      balanceAfter: tokenLedger.balanceAfter,
      memo: tokenLedger.memo,
      createdAt: tokenLedger.createdAt,
    })
    .from(tokenLedger)
    .where(eq(tokenLedger.orgId, orgId))
    .orderBy(desc(tokenLedger.id))
    .limit(limit);
  return rows as Awaited<ReturnType<typeof listLedger>>;
}

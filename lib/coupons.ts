import { randomInt } from "crypto";
import { db } from "./db";
import { couponGroups, coupons, tokenLedger, tokenWallets } from "./schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { isUniqueViolation, isTransientDbError } from "./db-errors";
import { ensureWallet, getBalance } from "./tokens";

// 동시 등록(SQLITE_BUSY) 짧은 재시도 — writeLedgerIdempotent 와 동일 정책.
// 원자적 단일사용 UPDATE + 부분 유니크 인덱스가 이중 지급을 막으므로 재시도는 안전.
const TX_RETRY = { attempts: 6, baseMs: 25, jitterMs: 25 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 코드 생성/등록 상한 — 거대 입력으로 인한 부하·오버플로 방지.
export const MAX_COUPON_COUNT = 10_000;
export const MAX_COUPON_TOKENS = 1_000_000;

/** 16자리(4-4-4-4) 숫자 코드 생성 — crypto 난수. 대시 없이 raw 로 저장. */
export function generateCouponCode(): string {
  let s = "";
  for (let i = 0; i < 16; i++) s += randomInt(0, 10).toString();
  return s;
}

/** 입력 코드 정규화 — 숫자만 남기고 16자리면 반환, 아니면 null. (붙여넣기·대시 자동 처리) */
export function normalizeCouponCode(raw: string): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 16 ? digits : null;
}

/** 저장된 16자리 코드를 4-4-4-4 표시 형식으로. */
export function formatCouponCode(code: string): string {
  return code.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, "$1-$2-$3-$4");
}

/** 현재 KST 날짜 'YYYY-MM-DD'. valid_from/until 의 포함 비교용(문자열 사전 비교). */
function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export type RedeemErrorCode = "invalid" | "expired" | "group_redeemed" | "rate_limited";
export type RedeemResult =
  | { ok: true; granted: number; balance: number; groupName: string }
  | { ok: false; code: RedeemErrorCode };

export const REDEEM_ERROR_MESSAGE: Record<RedeemErrorCode, string> = {
  invalid: "유효하지 않은 쿠폰입니다. 코드를 다시 확인해 주세요.",
  expired: "등록 기간이 지났거나 중단된 쿠폰입니다.",
  group_redeemed: "이미 등록하신 쿠폰입니다. 같은 쿠폰은 법인당 1개만 등록할 수 있습니다.",
  rate_limited: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
};

/**
 * 쿠폰 그룹 + 코드 N개 생성. 시스템 관리자 전용(라우트에서 권한·step-up 검증).
 * 코드 충돌(천문학적 확률)은 유니크 인덱스 + 청크 재생성으로 흡수.
 */
export async function createCouponGroup(args: {
  name: string;
  tokenAmount: number;
  count: number;
  validFrom: string | null;
  validUntil: string | null;
  createdByUserId: number;
}): Promise<{ groupId: number; created: number }> {
  const [g] = await db
    .insert(couponGroups)
    .values({
      name: args.name,
      tokenAmount: args.tokenAmount,
      validFrom: args.validFrom,
      validUntil: args.validUntil,
      createdByUserId: args.createdByUserId,
    })
    .returning({ id: couponGroups.id });

  // 메모리 내 중복 제거 후 청크 단위 bulk insert. 유니크 충돌 시 그 청크만 재생성.
  const codes = new Set<string>();
  while (codes.size < args.count) codes.add(generateCouponCode());
  const all = [...codes];
  const CHUNK = 200;
  for (let i = 0; i < all.length; i += CHUNK) {
    let chunk = all.slice(i, i + CHUNK);
    for (let attempt = 0; ; attempt++) {
      try {
        await db
          .insert(coupons)
          .values(chunk.map((code) => ({ groupId: g.id, code })));
        break;
      } catch (e) {
        if (isUniqueViolation(e) && attempt < 5) {
          // 기존 코드와 충돌한 청크를 새 코드로 재생성 후 재시도.
          chunk = chunk.map(() => generateCouponCode());
          continue;
        }
        throw e;
      }
    }
  }
  return { groupId: g.id, created: args.count };
}

/**
 * 쿠폰 등록(redeem) — 원자적. 검증 → 조건부 단일사용 UPDATE → 토큰 지급(원장+지갑)을
 * 한 트랜잭션으로 묶어 이중 지급·부분 적용을 차단한다.
 *
 * 토큰 지급은 grantWelcomeBonus 와 동일하게 reason='admin_adjust' + refType='coupon'
 * + refId=쿠폰.id 로 적재 — token_ledger_idem_uq 가 같은 코드 이중 지급을 막는 백스톱.
 * "법인당 그룹 1개"는 coupons 의 부분 유니크 인덱스(coupon_group_org_uq)가 최종 강제.
 */
export async function redeemCoupon(args: {
  orgId: number;
  code: string;
  userId: number;
}): Promise<RedeemResult> {
  const code = normalizeCouponCode(args.code);
  if (!code) return { ok: false, code: "invalid" };

  const [row] = await db
    .select({
      couponId: coupons.id,
      status: coupons.status,
      redeemedByOrgId: coupons.redeemedByOrgId,
      groupId: couponGroups.id,
      groupName: couponGroups.name,
      tokenAmount: couponGroups.tokenAmount,
      groupStatus: couponGroups.status,
      validFrom: couponGroups.validFrom,
      validUntil: couponGroups.validUntil,
    })
    .from(coupons)
    .innerJoin(couponGroups, eq(couponGroups.id, coupons.groupId))
    .where(eq(coupons.code, code));

  // 존재하지 않거나 이미 타 법인이 사용 → 코드 존재 노출 최소화 위해 일괄 'invalid'.
  if (!row) return { ok: false, code: "invalid" };

  // 그룹 비활성/기간 종료 — 코드 보유 후 막힌 경우라 'expired' 로 안내.
  if (row.groupStatus !== "active") return { ok: false, code: "expired" };
  const today = kstToday();
  if (row.validFrom && today < row.validFrom) return { ok: false, code: "expired" };
  if (row.validUntil && today > row.validUntil) return { ok: false, code: "expired" };

  if (row.status !== "unused") {
    return {
      ok: false,
      code: row.redeemedByOrgId === args.orgId ? "group_redeemed" : "invalid",
    };
  }

  // 같은 그룹을 이미 등록했는지 사전 확인(친절한 메시지용). 최종 방어는 아래 유니크 인덱스.
  const [dup] = await db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.groupId, row.groupId), eq(coupons.redeemedByOrgId, args.orgId))
    );
  if (dup) return { ok: false, code: "group_redeemed" };

  await ensureWallet(args.orgId);
  const grant = row.tokenAmount;
  const memo = `쿠폰 등록 — ${row.groupName} (${grant} 토큰)`;

  for (let attempt = 0; ; attempt++) {
    try {
      const result = await db.transaction(async (tx) => {
        // 조건부 단일사용 — status='unused' 일 때만 1행 갱신. 동시 등록 race 의 락 포인트.
        // redeemedByOrgId 세팅이 coupon_group_org_uq 를 건드리면(같은 그룹 다른 코드 동시
        // 등록) 트랜잭션이 UNIQUE 위반으로 롤백 → group_redeemed 로 귀결.
        const claimed = await tx
          .update(coupons)
          .set({
            status: "used",
            redeemedByOrgId: args.orgId,
            redeemedByUserId: args.userId,
            redeemedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(and(eq(coupons.id, row.couponId), eq(coupons.status, "unused")))
          .returning({ id: coupons.id });
        if (claimed.length !== 1) {
          // 동시 요청이 먼저 가져감 → 지급 없이 중단.
          return null;
        }
        // 토큰 지급 — 원장(멱등 게이트) → 지갑 → balanceAfter 보정.
        const ins = await tx
          .insert(tokenLedger)
          .values({
            orgId: args.orgId,
            delta: grant,
            reason: "admin_adjust",
            refType: "coupon",
            refId: row.couponId,
            balanceAfter: 0,
            createdByUserId: args.userId,
            memo,
          })
          .returning({ id: tokenLedger.id });
        const updated = await tx
          .update(tokenWallets)
          .set({
            balance: sql`${tokenWallets.balance} + ${grant}`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(tokenWallets.orgId, args.orgId))
          .returning({ balance: tokenWallets.balance });
        const next = updated[0]?.balance ?? 0;
        await tx
          .update(tokenLedger)
          .set({ balanceAfter: next })
          .where(eq(tokenLedger.id, ins[0].id));
        return next;
      });

      if (result == null) {
        // 코드를 동시 요청이 선점 — 같은 법인이면 group_redeemed, 아니면 invalid.
        const [after] = await db
          .select({ orgId: coupons.redeemedByOrgId })
          .from(coupons)
          .where(eq(coupons.id, row.couponId));
        return {
          ok: false,
          code: after?.orgId === args.orgId ? "group_redeemed" : "invalid",
        };
      }
      return { ok: true, granted: grant, balance: result, groupName: row.groupName };
    } catch (e) {
      // 그룹당 1개 유니크 또는 원장 멱등 위반 → 이미 등록한 것으로 처리.
      if (isUniqueViolation(e)) return { ok: false, code: "group_redeemed" };
      if (isTransientDbError(e) && attempt < TX_RETRY.attempts) {
        await sleep(TX_RETRY.baseMs * (attempt + 1) + Math.random() * TX_RETRY.jitterMs);
        continue;
      }
      throw e;
    }
  }
}

/** 그룹 비활성화 — 미등록 코드의 신규 등록만 차단. 이미 등록·지급된 토큰엔 영향 없음. */
export async function disableCouponGroup(groupId: number): Promise<boolean> {
  const r = await db
    .update(couponGroups)
    .set({ status: "disabled" })
    .where(eq(couponGroups.id, groupId))
    .returning({ id: couponGroups.id });
  return r.length === 1;
}

export type CouponGroupSummary = {
  id: number;
  name: string;
  tokenAmount: number;
  validFrom: string | null;
  validUntil: string | null;
  status: "active" | "disabled";
  createdAt: string;
  total: number;
  used: number;
};

/** 그룹 목록 + 코드 총수/사용수 집계. */
export async function listCouponGroups(): Promise<CouponGroupSummary[]> {
  const rows = await db
    .select({
      id: couponGroups.id,
      name: couponGroups.name,
      tokenAmount: couponGroups.tokenAmount,
      validFrom: couponGroups.validFrom,
      validUntil: couponGroups.validUntil,
      status: couponGroups.status,
      createdAt: couponGroups.createdAt,
      total: sql<number>`COUNT(${coupons.id})`,
      used: sql<number>`SUM(CASE WHEN ${coupons.status} = 'used' THEN 1 ELSE 0 END)`,
    })
    .from(couponGroups)
    .leftJoin(coupons, eq(coupons.groupId, couponGroups.id))
    .groupBy(couponGroups.id)
    .orderBy(desc(couponGroups.id));
  return rows.map((r) => ({
    ...r,
    total: Number(r.total ?? 0),
    used: Number(r.used ?? 0),
  })) as CouponGroupSummary[];
}

export type CouponCodeRow = {
  id: number;
  code: string;
  status: "unused" | "used" | "revoked";
  redeemedOrgName: string | null;
  redeemedAt: string | null;
};

/** 그룹 상세 — 코드 목록 + 사용 법인. (organizations 를 동적 import 로 조인) */
export async function getCouponGroupDetail(groupId: number): Promise<{
  group: CouponGroupSummary | null;
  codes: CouponCodeRow[];
}> {
  const { organizations } = await import("./schema");
  const [group] = (await db
    .select({
      id: couponGroups.id,
      name: couponGroups.name,
      tokenAmount: couponGroups.tokenAmount,
      validFrom: couponGroups.validFrom,
      validUntil: couponGroups.validUntil,
      status: couponGroups.status,
      createdAt: couponGroups.createdAt,
      total: sql<number>`(SELECT COUNT(*) FROM coupons WHERE coupons.group_id = ${couponGroups.id})`,
      used: sql<number>`(SELECT COUNT(*) FROM coupons WHERE coupons.group_id = ${couponGroups.id} AND coupons.status = 'used')`,
    })
    .from(couponGroups)
    .where(eq(couponGroups.id, groupId))) as unknown as CouponGroupSummary[];

  if (!group) return { group: null, codes: [] };

  const codes = await db
    .select({
      id: coupons.id,
      code: coupons.code,
      status: coupons.status,
      redeemedOrgName: organizations.name,
      redeemedAt: coupons.redeemedAt,
    })
    .from(coupons)
    .leftJoin(organizations, eq(organizations.id, coupons.redeemedByOrgId))
    .where(eq(coupons.groupId, groupId))
    .orderBy(coupons.id);

  return {
    group: {
      ...group,
      total: Number(group.total ?? 0),
      used: Number(group.used ?? 0),
    },
    codes: codes as CouponCodeRow[],
  };
}

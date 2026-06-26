import { db } from "./db";
import { paymentOrders } from "./schema";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { applyChargePayment } from "./tokens";
import { getTossPaymentByOrderId, makeTossOrderId, TossError } from "./toss";
import { withVat } from "./beta";
import { reportError } from "./error-reporter";

/**
 * 결제 미아(stale pending) 자가치유 — confirm 이 브라우저 리다이렉트(success 페이지 fetch)에만
 * 의존하기 때문에, 사용자가 결제 직후 창을 닫거나 네트워크가 끊기면 다음 두 갭이 생긴다:
 *   ① 토스에선 승인(DONE·실제 출금)됐는데 우리 DB 는 pending → "돈은 나갔는데 토큰 미지급" (위험)
 *   ② 토스에서 인증만 하고 승인 전 이탈 → 출금은 없지만 우리 DB 에 pending 이 영영 남음 (위생)
 *
 * 이 워커가 pending 주문을 토스에 **조회**(출금 안 일으킴)해서
 *   - DONE: paid 로 확정 + applyChargePayment(멱등)로 토큰 지급 → ① 치유
 *   - CANCELED/ABORTED/EXPIRED: failed 로 정리
 *   - 결제 흔적 없음(null) + 충분히 오래됨: failed 로 정리 → ② 위생
 *   - IN_PROGRESS/WAITING/READY: 그대로 둠 — **cron 이 승인(출금)하지 않는다** (사용자 의도 없는 결제 방지)
 *
 * TOSS_SECRET_KEY 미설정(결제 미연동·dormant)이면 아무것도 하지 않고 즉시 반환한다.
 */

// 너무 최근(MIN_AGE 미만)은 정상 결제 흐름이 아직 진행 중일 수 있어 건드리지 않는다.
const MIN_AGE_MIN = 15;
// 토스 조회가 의미 있는 상한. 이보다 오래된 pending 은 토스에서도 만료라 별도 정리(아래 null 경로)로 흡수.
const MAX_AGE_HOURS = 72;
// 결제 흔적이 전혀 없는(=인증 전 이탈) pending 을 failed 로 정리하는 기준 나이.
const ABANDON_HOURS = 24;
// 한 회차 처리량 상한 — 토스 조회는 주문당 1 외부호출이라 과도한 폭주를 막는다.
const BATCH = 50;

export type ReconcileResult = {
  configured: boolean;
  checked: number;
  healed: number; // DONE 인데 미지급 → 지급
  failed: number; // 취소/만료/포기 → failed
  skipped: number; // 아직 진행 중 / 아직 정리 시점 아님
  errors: number; // 토스 일시오류·금액불일치 (다음 회차 재시도)
};

// SQLite CURRENT_TIMESTAMP 는 'YYYY-MM-DD HH:MM:SS' (UTC). JS Date 로 안전 파싱.
function ageMs(createdAt: string): number {
  const iso = createdAt.includes("T")
    ? createdAt
    : createdAt.replace(" ", "T") + "Z";
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Date.now() - t;
}

async function markFailed(id: number, paymentKey?: string): Promise<boolean> {
  const updated = await db
    .update(paymentOrders)
    .set({ status: "failed", ...(paymentKey ? { providerRef: paymentKey } : {}) })
    .where(and(eq(paymentOrders.id, id), eq(paymentOrders.status, "pending")))
    .returning({ id: paymentOrders.id });
  return updated.length > 0;
}

export async function reconcilePendingPayments(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    configured: true,
    checked: 0,
    healed: 0,
    failed: 0,
    skipped: 0,
    errors: 0,
  };
  if (!process.env.TOSS_SECRET_KEY?.trim()) {
    return { ...result, configured: false };
  }

  // pending + toss + 생성 15분~72시간 사이. 최근/초과분은 제외(초과분 정리는 null 경로가 처리).
  const rows = await db
    .select()
    .from(paymentOrders)
    .where(
      and(
        eq(paymentOrders.status, "pending"),
        eq(paymentOrders.provider, "toss"),
        lt(paymentOrders.createdAt, sql`datetime('now', ${`-${MIN_AGE_MIN} minutes`})`),
        gt(paymentOrders.createdAt, sql`datetime('now', ${`-${MAX_AGE_HOURS} hours`})`)
      )
    )
    .limit(BATCH);

  for (const order of rows) {
    result.checked++;
    const orderId = makeTossOrderId(order.id);

    let lookup;
    try {
      lookup = await getTossPaymentByOrderId(orderId);
    } catch (e) {
      // 토스 일시오류 — 이 주문은 다음 회차에 재시도. 한 건 실패가 배치 전체를 막지 않게.
      result.errors++;
      if (!(e instanceof TossError) || e.code !== "NETWORK") {
        await reportError(e, { where: "reconcilePendingPayments", orderId });
      }
      continue;
    }

    if (lookup === null) {
      // 토스에 결제 흔적 없음 = 결제창 인증 전 이탈. 충분히 오래됐으면 failed 로 정리.
      if (ageMs(order.createdAt) > ABANDON_HOURS * 3_600_000) {
        if (await markFailed(order.id)) result.failed++;
      } else {
        result.skipped++;
      }
      continue;
    }

    if (lookup.status === "DONE") {
      // 토스 totalAmount 는 실제 결제액(공급가+VAT). order.amountKrw 는 공급가라 withVat 로 대조.
      // 금액 불일치는 자동 지급 금지 — 위변조/오류 신호. 보고만 하고 사람이 본다.
      const expectedPaid = withVat(order.amountKrw);
      if (lookup.totalAmount !== expectedPaid) {
        result.errors++;
        await reportError(
          new Error(
            `reconcile 금액 불일치: order ${order.id} 기대 ${expectedPaid} vs 토스 ${lookup.totalAmount}`
          ),
          { where: "reconcilePendingPayments", orderId }
        );
        continue;
      }
      // 출금됐는데 미지급 → 자가치유. paid 확정(조건부)은 pending 일 때만 1회.
      await db
        .update(paymentOrders)
        .set({ status: "paid", providerRef: lookup.paymentKey })
        .where(
          and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "pending"))
        );
      // 멱등 — 동시에 success 페이지가 먼저 지급했어도 이중 적립 없음.
      await applyChargePayment({
        orgId: order.orgId,
        paymentOrderId: order.id,
        amountKrw: order.amountKrw,
        userId: order.createdByUserId,
      });
      result.healed++;
      continue;
    }

    if (
      lookup.status === "CANCELED" ||
      lookup.status === "PARTIAL_CANCELED" ||
      lookup.status === "ABORTED" ||
      lookup.status === "EXPIRED"
    ) {
      if (await markFailed(order.id, lookup.paymentKey || undefined)) result.failed++;
      continue;
    }

    // IN_PROGRESS / WAITING_FOR_DEPOSIT / READY — 아직 승인 전. cron 은 승인하지 않는다.
    result.skipped++;
  }

  return result;
}

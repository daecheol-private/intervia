import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { db } from "@/lib/db";
import { paymentOrders } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { reverseChargePayment } from "@/lib/tokens";
import { cancelTossPayment, makeTossOrderId, TossError } from "@/lib/toss";
import { logAudit } from "@/lib/audit";
import { withVat } from "@/lib/beta";

export const runtime = "nodejs";

/**
 * 결제 취소(전액 환불) — 카드사 환불 + 지급 토큰 회수. system_admin + step-up 전용.
 *
 * 상태머신(이중환불·부분실패 방지):
 *  1) paid 인지 확인. cancelled 면 멱등(토큰 회수만 보장), 그 외엔 400.
 *  2) 조건부 claim: paid→cancelled 를 한 번만 성공시켜(returning) 토스 취소를 한 번만 부른다.
 *  3) 토스 취소 성공(또는 이미취소) → 토큰 회수(멱등). 그 외 토스 실패 → paid 로 되돌리고 402.
 * 토큰 회수는 reverseChargePayment 가 paymentOrderId 기준 멱등 — 크래시/재시도에도 한 번만.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });
  const pw = requirePasswordChanged(me);
  if (pw) return pw;
  const stepUp = await requireStepUp();
  if (stepUp) return stepUp;

  const { id } = await params;
  const paymentId = Number(id);
  if (!Number.isInteger(paymentId))
    return new Response("결제 ID 형식 오류", { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason ?? "").trim();
  if (reason.length < 5)
    return new Response("환불 사유는 5자 이상 입력하세요.", { status: 400 });

  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.id, paymentId));
  if (!order) return new Response("결제를 찾을 수 없습니다.", { status: 404 });

  // 이미 취소된 주문 — 멱등: 토큰 회수만 보장하고 성공 반환.
  if (order.status === "cancelled") {
    const r = await reverseChargePayment({
      orgId: order.orgId,
      paymentOrderId: order.id,
      tokens: order.tokens,
      amountKrw: withVat(order.amountKrw),
      userId: me!.id,
    });
    return Response.json({
      ok: true,
      alreadyCancelled: true,
      refundedKrw: withVat(order.amountKrw),
      reversedTokens: r.reversed,
      balance: r.balance,
    });
  }
  if (order.status !== "paid")
    return new Response(
      `환불할 수 있는 결제가 아닙니다 (현재 상태: ${order.status}).`,
      { status: 400 }
    );
  if (!order.providerRef)
    return new Response("결제 키가 없어 취소할 수 없습니다.", { status: 400 });
  const paymentKey = order.providerRef;

  // 조건부 claim — paid 일 때만 cancelled 로. 한 요청만 통과(이중 토스취소 방지).
  const claimed = await db
    .update(paymentOrders)
    .set({ status: "cancelled" })
    .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "paid")))
    .returning({ id: paymentOrders.id });
  if (claimed.length === 0)
    return new Response("이미 처리 중이거나 취소된 결제입니다.", {
      status: 409,
    });

  // 토스 결제취소(전액). 이미 취소된 결제(ALREADY_CANCELED_PAYMENT)면 성공으로 간주.
  try {
    await cancelTossPayment({
      paymentKey,
      cancelReason: reason,
      idempotencyKey: `cancel-${makeTossOrderId(order.id)}`,
    });
  } catch (e) {
    const code = e instanceof TossError ? e.code : "UNKNOWN";
    if (code !== "ALREADY_CANCELED_PAYMENT") {
      // 취소 실패 — paid 로 되돌려 재시도 가능하게. 토큰 회수 안 함.
      await db
        .update(paymentOrders)
        .set({ status: "paid" })
        .where(eq(paymentOrders.id, order.id));
      const message =
        e instanceof TossError ? e.message : "결제 취소에 실패했습니다.";
      return Response.json({ ok: false, code, message }, { status: 402 });
    }
  }

  // 토스 취소 확정 → 지급 토큰 회수(멱등).
  const r = await reverseChargePayment({
    orgId: order.orgId,
    paymentOrderId: order.id,
    tokens: order.tokens,
    amountKrw: order.amountKrw,
    userId: me!.id,
  });

  logAudit(req, {
    actor: me,
    action: "payment.cancel",
    resourceType: "organization",
    resourceId: order.orgId,
    orgId: order.orgId,
    metadata: {
      paymentOrderId: order.id,
      amountKrw: order.amountKrw,
      reversedTokens: r.reversed,
      reason,
      balanceAfter: r.balance,
    },
  });

  return Response.json({
    ok: true,
    refundedKrw: order.amountKrw,
    reversedTokens: r.reversed,
    balance: r.balance,
  });
}

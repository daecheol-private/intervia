import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { db } from "@/lib/db";
import { paymentOrders } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { applyChargePayment } from "@/lib/tokens";
import { confirmTossPayment, parseTossOrderId, TossError } from "@/lib/toss";
import { withVat } from "@/lib/beta";

export const runtime = "nodejs";

/**
 * 결제 성공 리다이렉트 후 호출 — 토스 승인 + 토큰 지급.
 *
 * 보안 2중:
 *  ① 금액은 클라이언트가 보낸 amount 가 아니라 DB(payment_orders.amount_krw)를 쓴다.
 *  ② 토스가 paymentKey↔orderId↔amount 가 실제 결제와 일치하는지 다시 검증한다.
 * 멱등: applyChargePayment 가 paymentOrderId 기준이라 새로고침/재호출에도 이중 지급 없음.
 * 이미 paid 인 주문은 승인 API 를 다시 부르지 않고 단락(토스 ALREADY_PROCESSED 회피)하며,
 * 그 자리에서 applyChargePayment 를 다시 호출해 "결제됐는데 토큰 미지급" 상태를 자가 치유한다.
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const pw = requirePasswordChanged(me);
  if (pw) return pw;
  if (me!.role !== "org_admin")
    return new Response("법인 관리자만 결제할 수 있습니다.", { status: 403 });

  let body: { paymentKey?: unknown; orderId?: unknown; amount?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("잘못된 요청입니다.", { status: 400 });
  }
  const paymentKey = typeof body.paymentKey === "string" ? body.paymentKey : "";
  const orderIdStr = typeof body.orderId === "string" ? body.orderId : "";
  if (!paymentKey || !orderIdStr)
    return new Response("결제 정보가 누락되었습니다.", { status: 400 });

  const paymentOrderId = parseTossOrderId(orderIdStr);
  if (!paymentOrderId)
    return new Response("주문번호 형식이 올바르지 않습니다.", { status: 400 });

  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(eq(paymentOrders.id, paymentOrderId));

  // 존재하지 않거나 내 법인 주문이 아니면 노출 없이 404 (org_admin 은 orgId 필수).
  if (!order || order.orgId !== me!.orgId)
    return new Response("주문을 찾을 수 없습니다.", { status: 404 });

  // 이미 처리된 주문 — 상태별 분기 (승인 API 재호출 금지).
  if (order.status === "paid") return applyAndRespond(order, me!.id);
  if (order.status === "cancelled")
    return new Response("취소된 주문입니다.", { status: 400 });
  if (order.status === "failed")
    return new Response(
      "이미 실패한 주문입니다. 충전 페이지에서 다시 결제해 주세요.",
      { status: 400 }
    );

  // pending — 클라이언트가 보낸 금액이 주문 결제액(공급가+VAT)과 다르면 위변조 의심, 즉시 차단.
  if (Number(body.amount) !== withVat(order.amountKrw))
    return new Response("결제 금액이 주문과 일치하지 않습니다.", {
      status: 400,
    });

  try {
    // amount 는 DB 공급가에 VAT 를 더한 실제 결제액(권위) — 클라이언트 입력을 신뢰하지 않는다.
    const result = await confirmTossPayment({
      paymentKey,
      orderId: orderIdStr,
      amount: withVat(order.amountKrw),
    });
    if (result.status !== "DONE") {
      return new Response(
        `결제가 완료되지 않았습니다 (상태: ${result.status}).`,
        { status: 402 }
      );
    }
  } catch (e) {
    const code = e instanceof TossError ? e.code : "UNKNOWN";
    const message =
      e instanceof TossError ? e.message : "결제 승인에 실패했습니다.";
    // 승인 실패 — 주문을 failed 로 기록(재결제 시 새 주문 생성). 토큰 미지급.
    await db
      .update(paymentOrders)
      .set({ status: "failed", providerRef: paymentKey })
      .where(eq(paymentOrders.id, order.id));
    return Response.json({ ok: false, code, message }, { status: 402 });
  }

  // 승인 성공 — 먼저 paid 로 확정한 뒤 토큰 지급(멱등). 지급 실패 시에도 재호출이 자가 치유.
  await db
    .update(paymentOrders)
    .set({ status: "paid", providerRef: paymentKey })
    .where(eq(paymentOrders.id, order.id));
  return applyAndRespond(order, me!.id);
}

async function applyAndRespond(
  order: typeof paymentOrders.$inferSelect,
  userId: number
) {
  const r = await applyChargePayment({
    orgId: order.orgId,
    paymentOrderId: order.id,
    amountKrw: order.amountKrw,
    userId,
  });
  return Response.json({
    ok: true,
    alreadyApplied: r.alreadyApplied,
    // granted 는 주문의 토큰값(고정) — 새로고침/재확인 시 alreadyApplied 라도 0 으로 보이지 않게.
    granted: order.tokens,
    balance: r.balance,
    amountKrw: order.amountKrw, // 공급가
    paidAmountKrw: withVat(order.amountKrw), // 실제 카드 결제액(VAT 포함)
  });
}

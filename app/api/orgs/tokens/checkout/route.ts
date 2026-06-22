import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { db } from "@/lib/db";
import { paymentOrders } from "@/lib/schema";
import { isAllowedChargeAmount } from "@/lib/beta";
import { calcTokensForKrw } from "@/lib/tokens";
import { makeTossOrderId } from "@/lib/toss";

export const runtime = "nodejs";

/**
 * 토큰 충전 결제 시작 — pending 주문을 만들고 토스 결제창에 넘길 orderId 를 반환한다.
 * 실제 토큰 지급은 결제 성공 후 /confirm 에서 멱등 처리.
 *
 * 권한: org_admin 만 (결제는 법인 관리자 책임. 멤버는 충전요청 메일로).
 * 금액: 허용 패키지(CHARGE_PACKAGES)로만 — 클라이언트가 임의 금액 주문 생성 차단.
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const pw = requirePasswordChanged(me);
  if (pw) return pw;

  if (me!.role !== "org_admin")
    return new Response("법인 관리자만 결제할 수 있습니다.", { status: 403 });
  if (!me!.orgId)
    return new Response("소속 법인이 없습니다.", { status: 400 });

  let body: { amountKrw?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("잘못된 요청입니다.", { status: 400 });
  }
  const amountKrw = Number(body.amountKrw);
  if (!Number.isSafeInteger(amountKrw) || !isAllowedChargeAmount(amountKrw))
    return new Response("허용되지 않은 충전 금액입니다.", { status: 400 });

  const tokens = calcTokensForKrw(amountKrw).total;

  const [order] = await db
    .insert(paymentOrders)
    .values({
      orgId: me!.orgId,
      amountKrw,
      tokens,
      status: "pending",
      provider: "toss",
      createdByUserId: me!.id,
    })
    .returning({ id: paymentOrders.id });

  return Response.json({
    orderId: makeTossOrderId(order.id),
    amount: amountKrw,
    orderName: `Intervia 토큰 충전 ${amountKrw.toLocaleString()}원`,
    customerEmail: me!.email,
    customerName: me!.name,
  });
}

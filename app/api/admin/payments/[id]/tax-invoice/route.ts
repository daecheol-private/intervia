import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { db } from "@/lib/db";
import { paymentOrders } from "@/lib/schema";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * 계좌이체 세금계산서 발행 체크/해제 — system_admin. 발행 자체는 홈택스에서 하고 여기엔 표시만 남긴다.
 * 입금확인된 계좌이체만 대상(카드는 카드 매출전표가 증빙이라 같은 거래에 세금계산서를 따로 발행하지 않는다).
 */
export async function PATCH(
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

  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) return new Response("결제 ID 형식 오류", { status: 400 });

  const body = (await req.json().catch(() => null)) as { issued?: unknown } | null;
  if (typeof body?.issued !== "boolean")
    return new Response("issued(true/false)가 필요합니다.", { status: 400 });

  const [o] = await db
    .select({
      id: paymentOrders.id,
      orgId: paymentOrders.orgId,
      provider: paymentOrders.provider,
      confirmedAt: paymentOrders.confirmedAt,
      taxInvoiceIssuedAt: paymentOrders.taxInvoiceIssuedAt,
    })
    .from(paymentOrders)
    .where(eq(paymentOrders.id, orderId));
  if (!o) return new Response("결제를 찾을 수 없습니다.", { status: 404 });
  if (o.provider !== "transfer")
    return new Response(
      "카드 결제는 카드 매출전표가 증빙이라 세금계산서 발행 대상이 아닙니다.",
      { status: 400 }
    );
  if (!o.confirmedAt)
    return new Response("입금확인 전 주문입니다.", { status: 409 });

  // 이미 체크된 건을 다시 체크해도 처음 발행 시각을 유지한다.
  const issuedAt = body.issued ? (o.taxInvoiceIssuedAt ?? new Date().toISOString()) : null;
  await db
    .update(paymentOrders)
    .set({ taxInvoiceIssuedAt: issuedAt, taxInvoiceIssuedBy: body.issued ? me!.id : null })
    .where(eq(paymentOrders.id, o.id));

  logAudit(req, {
    actor: me,
    action: body.issued ? "payment.tax_invoice_issued" : "payment.tax_invoice_unmarked",
    resourceType: "payment_order",
    resourceId: o.id,
    orgId: o.orgId,
  });
  return Response.json({ ok: true, taxInvoiceIssuedAt: issuedAt });
}

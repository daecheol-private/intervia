import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import {
  notifyTransferCheckRequested,
  requestTransferCheck,
  toTransferView,
} from "@/lib/bank-transfer";

export const runtime = "nodejs";

/** 고객 "입금 완료 · 확인 요청" — 운영자 Slack 에 입금확인 버튼 알림(10분에 한 번). org_admin 전용. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const pw = requirePasswordChanged(me);
  if (pw) return pw;
  if (me!.role !== "org_admin")
    return new Response("법인 관리자만 요청할 수 있습니다.", { status: 403 });
  const orgId = me!.orgId;
  if (!orgId) return new Response("소속 법인이 없습니다.", { status: 400 });

  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) return new Response("주문 번호 형식 오류", { status: 400 });

  const r = await requestTransferCheck(orderId, orgId);
  if (!r.ok) return new Response(r.error, { status: r.status });

  const order = r.order;
  if (r.sent) {
    logAudit(req, {
      actor: me,
      action: "payment.transfer_notify",
      resourceType: "payment_order",
      resourceId: order.id,
      orgId,
    });
    after(() =>
      notifyTransferCheckRequested(order).catch((e) =>
        console.error("[transfer] 확인 요청 통지 실패:", e)
      )
    );
  }
  return Response.json({ ok: true, sent: r.sent, order: toTransferView(order) });
}

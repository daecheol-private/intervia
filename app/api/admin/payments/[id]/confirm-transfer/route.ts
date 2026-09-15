import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { logAudit } from "@/lib/audit";
import { postSlack } from "@/lib/slack";
import {
  confirmTransferDeposit,
  notifyTransferConfirmed,
  transferConfirmedSlackMessage,
} from "@/lib/bank-transfer";

export const runtime = "nodejs";

/**
 * 계좌이체 입금확인(관리자 결제 내역 화면) — Slack 버튼을 못 쓸 때의 예비 경로.
 * system_admin + step-up. 지급은 Slack 경로와 같은 confirmTransferDeposit(멱등).
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
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) return new Response("결제 ID 형식 오류", { status: 400 });

  const r = await confirmTransferDeposit({
    orderId,
    confirmedBy: `admin:${me!.id}`,
    actorUserId: me!.id,
  });
  if (!r.ok) return new Response(r.error, { status: r.status });

  const { order, granted, balance } = r;
  logAudit(req, {
    actor: me,
    action: "payment.transfer_confirm",
    resourceType: "payment_order",
    resourceId: order.id,
    orgId: order.orgId,
    metadata: { via: "admin", granted, tokens: order.tokens },
  });
  if (granted) {
    after(async () => {
      await postSlack(await transferConfirmedSlackMessage(order, "관리자 화면", balance));
      await notifyTransferConfirmed(order, balance).catch((e) =>
        console.error("[admin] 충전 완료 통지 실패:", e)
      );
    });
  }
  return Response.json({ ok: true, granted, tokens: order.tokens, balance });
}

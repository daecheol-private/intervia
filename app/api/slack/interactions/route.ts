import { after } from "next/server";
import { logAudit } from "@/lib/audit";
import { isSlackApprover, respondSlack, verifySlackSignature } from "@/lib/slack";
import {
  TRANSFER_CONFIRM_ACTION,
  confirmTransferDeposit,
  notifyTransferConfirmed,
  transferConfirmedSlackMessage,
} from "@/lib/bank-transfer";

export const runtime = "nodejs";

type BlockActionsPayload = {
  type?: string;
  user?: { id?: string };
  response_url?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
};

/**
 * Slack 앱 Interactivity Request URL — 버튼 클릭 콜백(현재: 계좌이체 입금확인).
 * 인증은 세션이 아니라 Slack 서명(SLACK_SIGNING_SECRET), 처리 권한은 SLACK_APPROVER_USER_IDS.
 * Slack 은 3초 안에 200 을 기대한다 — 지급(DB)까지만 동기로 끝내고 메시지 교체·메일은 after().
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  if (
    !verifySlackSignature({
      rawBody,
      timestamp: req.headers.get("x-slack-request-timestamp"),
      signature: req.headers.get("x-slack-signature"),
    })
  )
    return new Response("invalid signature", { status: 401 });

  let payload: BlockActionsPayload;
  try {
    payload = JSON.parse(new URLSearchParams(rawBody).get("payload") ?? "");
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const action = payload.actions?.[0];
  // 관리자 화면 링크 버튼 등 처리할 게 없는 클릭.
  if (payload.type !== "block_actions" || !action || action.action_id !== TRANSFER_CONFIRM_ACTION)
    return new Response(null, { status: 200 });

  const responseUrl = payload.response_url;
  const slackUser = payload.user?.id;
  if (!isSlackApprover(slackUser)) {
    after(() =>
      respondSlack(responseUrl, {
        response_type: "ephemeral",
        replace_original: false,
        text: "입금확인 권한이 없습니다. SLACK_APPROVER_USER_IDS 에 등록된 사람만 처리할 수 있습니다.",
      })
    );
    return new Response(null, { status: 200 });
  }

  const orderId = Number(action.value);
  if (!Number.isInteger(orderId)) return new Response(null, { status: 200 });

  const r = await confirmTransferDeposit({
    orderId,
    confirmedBy: `slack:${slackUser}`,
    actorUserId: null,
  });
  if (!r.ok) {
    const error = r.error;
    after(() =>
      respondSlack(responseUrl, {
        response_type: "ephemeral",
        replace_original: false,
        text: `처리하지 못했습니다: ${error}`,
      })
    );
    return new Response(null, { status: 200 });
  }

  const { order, granted, balance } = r;
  logAudit(req, {
    actorRole: "system",
    action: "payment.transfer_confirm",
    resourceType: "payment_order",
    resourceId: order.id,
    orgId: order.orgId,
    metadata: { via: "slack", slackUser, granted, tokens: order.tokens },
  });
  after(async () => {
    const msg = await transferConfirmedSlackMessage(order, `<@${slackUser}>`, balance);
    await respondSlack(responseUrl, { replace_original: true, ...msg });
    if (granted)
      await notifyTransferConfirmed(order, balance).catch((e) =>
        console.error("[slack] 충전 완료 통지 실패:", e)
      );
  });
  return new Response(null, { status: 200 });
}

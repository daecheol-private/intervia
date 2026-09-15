/**
 * 계좌이체 충전 — 카드 1회 결제 한도(VAT 포함 10만원)를 넘는 충전.
 *
 * 흐름: 고객 신청(payment_orders provider="transfer", pending) → 화면·메일 입금 안내 + 운영자 Slack
 *   → 고객 입금 후 "확인 요청"(deposit_notified_at) → Slack [입금확인] 버튼(예비: 관리자 결제 내역 화면)
 *   → confirmTransferDeposit: pending→paid 조건부 전환 + applyChargePayment(주문 기준 멱등) → 완료 메일·인앱 알림.
 * 입금 여부는 사람이 통장에서 확인한다(은행 연동 없음). 입금 기한이 지나도 자동 취소하지 않는다.
 */
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "./db";
import { organizations, paymentOrders, users, type PaymentOrder } from "./schema";
import { applyChargePayment, calcTokensForKrw } from "./tokens";
import { withVat } from "./beta";
import { BANK_TRANSFER_ACCOUNT, SITE_INFO } from "./site-info";
import { addDays, parseDbTimestamp } from "./utils";
import { EMAIL_BRAND, escapeHtml, isSmtpAvailable, sendMail, wrapEmailCard } from "./mailer";
import { createNotification, resolveMailBaseUrl } from "./notifications";
import { isSlackInteractive, postSlack, slackEscape, type SlackMessage } from "./slack";

/** 입금 기한(일) — 안내용. 지나도 자동 취소하지 않는다. */
export const TRANSFER_DEPOSIT_DAYS = 7;
/** 확인 요청 재알림 최소 간격 — 연타해도 Slack 이 도배되지 않게. */
const NOTIFY_COOLDOWN_MS = 10 * 60_000;
/** Slack 입금확인 버튼 action_id — /api/slack/interactions 가 이 값으로 분기. */
export const TRANSFER_CONFIRM_ACTION = "transfer_confirm";

/** 입금자명(받는 분 통장 표시) — 은행 앱에서 잘리지 않게 짧게. */
export function transferDepositorName(orderId: number): string {
  return `IV${orderId}`;
}

export type TransferOrderView = {
  id: number;
  /** 공급가 */
  amountKrw: number;
  /** 입금액(VAT 포함) */
  payKrw: number;
  tokens: number;
  status: PaymentOrder["status"];
  depositorName: string;
  dueAt: string;
  depositNotifiedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
};

export function toTransferView(o: PaymentOrder): TransferOrderView {
  return {
    id: o.id,
    amountKrw: o.amountKrw,
    payKrw: withVat(o.amountKrw),
    tokens: o.tokens,
    status: o.status,
    depositorName: transferDepositorName(o.id),
    dueAt: addDays(parseDbTimestamp(o.createdAt), TRANSFER_DEPOSIT_DAYS).toISOString(),
    depositNotifiedAt: o.depositNotifiedAt,
    confirmedAt: o.confirmedAt,
    createdAt: o.createdAt,
  };
}

export async function createTransferOrder(opts: {
  orgId: number;
  userId: number;
  amountKrw: number;
}): Promise<PaymentOrder> {
  const [order] = await db
    .insert(paymentOrders)
    .values({
      orgId: opts.orgId,
      amountKrw: opts.amountKrw,
      tokens: calcTokensForKrw(opts.amountKrw).total,
      status: "pending",
      provider: "transfer",
      createdByUserId: opts.userId,
    })
    .returning();
  return order;
}

/** 법인의 최근 계좌이체 주문(최신 10건) — 충전 화면의 입금 안내·확인 요청용. */
export async function listTransferOrders(orgId: number): Promise<TransferOrderView[]> {
  const rows = await db
    .select()
    .from(paymentOrders)
    .where(and(eq(paymentOrders.orgId, orgId), eq(paymentOrders.provider, "transfer")))
    .orderBy(desc(paymentOrders.id))
    .limit(10);
  return rows.map(toTransferView);
}

export type TransferCheckResult =
  | { ok: true; order: PaymentOrder; sent: boolean }
  | { ok: false; status: number; error: string };

/** 고객 "입금 완료 · 확인 요청" — 운영자 알림은 10분에 한 번만(sent). */
export async function requestTransferCheck(
  orderId: number,
  orgId: number
): Promise<TransferCheckResult> {
  const [o] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, orderId));
  if (!o || o.orgId !== orgId || o.provider !== "transfer")
    return { ok: false, status: 404, error: "주문을 찾을 수 없습니다." };
  if (o.status === "paid")
    return { ok: false, status: 409, error: "이미 입금이 확인되어 충전된 주문입니다." };
  if (o.status !== "pending") return { ok: false, status: 409, error: "취소된 주문입니다." };

  // deposit_notified_at 은 toISOString() 저장 — 같은 ISO 끼리 비교해야 사전순 = 시간순.
  const cutoff = new Date(Date.now() - NOTIFY_COOLDOWN_MS).toISOString();
  const [updated] = await db
    .update(paymentOrders)
    .set({ depositNotifiedAt: new Date().toISOString() })
    .where(
      and(
        eq(paymentOrders.id, o.id),
        eq(paymentOrders.status, "pending"),
        or(isNull(paymentOrders.depositNotifiedAt), lt(paymentOrders.depositNotifiedAt, cutoff))
      )
    )
    .returning();
  return updated ? { ok: true, order: updated, sent: true } : { ok: true, order: o, sent: false };
}

export type ConfirmTransferResult =
  | { ok: true; order: PaymentOrder; granted: boolean; balance: number }
  | { ok: false; status: number; error: string };

/**
 * 입금확인 → 토큰 지급. Slack 버튼·관리자 화면 공용.
 * 두 번 눌러도 한 번만 지급된다: pending→paid 조건부 전환 + 원장 멱등(주문 기준).
 * 이미 paid 인데 지급 직전에 죽었던 주문은 다시 누르면 지급된다(자가 치유).
 */
export async function confirmTransferDeposit(opts: {
  orderId: number;
  confirmedBy: string;
  actorUserId: number | null;
}): Promise<ConfirmTransferResult> {
  const [o] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, opts.orderId));
  if (!o || o.provider !== "transfer")
    return { ok: false, status: 404, error: "계좌이체 주문을 찾을 수 없습니다." };

  let order = o;
  if (o.status === "pending") {
    const [claimed] = await db
      .update(paymentOrders)
      .set({ status: "paid", confirmedAt: new Date().toISOString(), confirmedBy: opts.confirmedBy })
      .where(and(eq(paymentOrders.id, o.id), eq(paymentOrders.status, "pending")))
      .returning();
    if (claimed) order = claimed;
    else {
      const [fresh] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, o.id));
      if (fresh) order = fresh;
    }
  }
  if (order.status !== "paid") return { ok: false, status: 409, error: "취소된 주문입니다." };

  const r = await applyChargePayment({
    orgId: order.orgId,
    paymentOrderId: order.id,
    amountKrw: order.amountKrw,
    userId: opts.actorUserId,
    promisedTokens: order.tokens,
  });
  return { ok: true, order, granted: !r.alreadyApplied, balance: r.balance };
}

// ── 통지 (메일·Slack·인앱) ──────────────────────────────────────────────────────

type OrderContext = {
  orgName: string;
  bizNo: string | null;
  requester: { id: number; email: string } | null;
};

async function orderContext(o: PaymentOrder): Promise<OrderContext> {
  const [org] = await db
    .select({ name: organizations.name, bizNo: organizations.bizRegistrationNo })
    .from(organizations)
    .where(eq(organizations.id, o.orgId));
  const [requester] = o.createdByUserId
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, o.createdByUserId))
    : [];
  return {
    orgName: org?.name ?? `법인#${o.orgId}`,
    bizNo: org?.bizNo ?? null,
    requester: requester ?? null,
  };
}

const kstDate = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);

const adminPaymentsUrl = (o: PaymentOrder) =>
  `${resolveMailBaseUrl()}/admin/orgs/${o.orgId}/payments`;

/** Slack 요약 — 법인명·금액·입금자명만(개인정보 없음). */
function slackSummary(o: PaymentOrder, orgName: string): string {
  return [
    `법인: *${slackEscape(orgName)}*`,
    `입금액: *${withVat(o.amountKrw).toLocaleString()}원* (공급가 ${o.amountKrw.toLocaleString()}원 + VAT)`,
    `입금자명: *${transferDepositorName(o.id)}* · 지급 토큰 ${o.tokens.toLocaleString()}`,
  ].join("\n");
}

function infoTable(rows: Array<[string, string]>): string {
  const trs = rows
    .map(([k, v], i) => {
      const border = i === 0 ? "" : "border-top:1px solid #e2e8f0;";
      return `<tr><td style="padding:10px 16px;font-size:12px;color:#64748b;width:90px;${border}">${escapeHtml(k)}</td><td style="padding:10px 16px;font-size:13px;color:${EMAIL_BRAND.ink};font-weight:600;${border}">${escapeHtml(v)}</td></tr>`;
    })
    .join("");
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;margin:0 0 16px;">${trs}</table>`;
}

function ctaButton(href: string, label: string): string {
  return `<div style="text-align:center;margin:8px 0;"><a href="${href}" style="display:inline-block;padding:12px 28px;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">${escapeHtml(label)}</a></div>`;
}

/** 신청 직후 — 운영자 Slack + 신청자에게 입금 안내 메일. */
export async function notifyTransferCreated(o: PaymentOrder): Promise<void> {
  const ctx = await orderContext(o);
  await postSlack({
    text: `🏦 계좌이체 충전 신청 — ${ctx.orgName} ${withVat(o.amountKrw).toLocaleString()}원`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*🏦 계좌이체 충전 신청* · 주문 #${o.id}\n${slackSummary(o, ctx.orgName)}\n고객이 입금 후 "확인 요청"을 누르면 입금확인 버튼이 담긴 알림이 한 번 더 옵니다.`,
        },
      },
    ],
  });

  if (!ctx.requester || !(await isSmtpAvailable(null))) return;
  const v = toTransferView(o);
  const pay = v.payKrw.toLocaleString();
  const due = kstDate(new Date(v.dueAt));
  const tokensUrl = `${resolveMailBaseUrl()}/org/tokens`;
  const taxLine = ctx.bizNo
    ? `세금계산서는 법인 설정에 등록된 사업자등록번호(${ctx.bizNo})로 발행해 드립니다.`
    : "세금계산서 발행을 위해 법인 설정에 사업자등록번호를 등록해 주세요.";
  const rows: Array<[string, string]> = [
    ["은행", BANK_TRANSFER_ACCOUNT.bank],
    ["계좌번호", BANK_TRANSFER_ACCOUNT.number],
    ["예금주", BANK_TRANSFER_ACCOUNT.holder],
    ["입금액", `${pay}원 (공급가 ${o.amountKrw.toLocaleString()}원 + VAT ${(v.payKrw - o.amountKrw).toLocaleString()}원)`],
    ["입금자명", v.depositorName],
    ["입금 기한", `${due}까지`],
    ["충전 토큰", `${o.tokens.toLocaleString()} 토큰`],
  ];
  const innerHtml = `
    <h2 style="margin:8px 0 12px;font-size:18px;color:${EMAIL_BRAND.ink};line-height:1.4;">계좌이체 충전 신청이 접수되었습니다</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.7;">아래 계좌로 입금하신 뒤 토큰 페이지에서 <strong>입금 완료 · 확인 요청</strong>을 눌러 주세요. 담당자가 입금을 확인하면 토큰이 바로 충전되고 메일로 알려 드립니다.</p>
    ${infoTable(rows)}
    <p style="margin:0 0 8px;font-size:13px;color:#334155;line-height:1.6;">입금자명(받는 분 통장 표시)을 <strong>${escapeHtml(v.depositorName)}</strong>(으)로 적어 주시면 더 빨리 확인됩니다.</p>
    <p style="margin:0 0 20px;font-size:13px;color:#334155;line-height:1.6;">${escapeHtml(taxLine)}</p>
    ${ctaButton(tokensUrl, "토큰 페이지에서 확인 요청하기")}
  `;
  const text = `계좌이체 충전 신청이 접수되었습니다.

아래 계좌로 입금하신 뒤 토큰 페이지에서 "입금 완료 · 확인 요청"을 눌러 주세요.
담당자가 입금을 확인하면 토큰이 바로 충전되고 메일로 알려 드립니다.

${rows.map(([k, val]) => `${k}: ${val}`).join("\n")}

입금자명(받는 분 통장 표시)을 ${v.depositorName}(으)로 적어 주시면 더 빨리 확인됩니다.
${taxLine}

확인 요청: ${tokensUrl}`;
  await sendMail({
    to: ctx.requester.email,
    subject: `[${SITE_INFO.serviceName}] 계좌이체 충전 입금 안내 — ${pay}원`,
    html: wrapEmailCard({ innerHtml }),
    text,
    orgId: null,
    audience: "org",
    kind: "transfer_guide",
  });
}

/** 고객 "확인 요청" — 운영자 Slack 에 입금확인 버튼. 서명 키가 없으면 관리자 화면 링크만. */
export async function notifyTransferCheckRequested(o: PaymentOrder): Promise<void> {
  const ctx = await orderContext(o);
  const adminUrl = adminPaymentsUrl(o);
  const pay = withVat(o.amountKrw).toLocaleString();
  const depositor = transferDepositorName(o.id);
  await postSlack({
    text: `💰 입금 확인 요청 — ${ctx.orgName} ${pay}원 (${depositor})`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*💰 입금 확인 요청* · 주문 #${o.id}\n${slackSummary(o, ctx.orgName)}\n토스뱅크 입금 내역에서 입금자명과 금액을 확인한 뒤 눌러 주세요.`,
        },
      },
      isSlackInteractive()
        ? {
            type: "actions",
            elements: [
              {
                type: "button",
                style: "primary",
                action_id: TRANSFER_CONFIRM_ACTION,
                value: String(o.id),
                text: { type: "plain_text", text: "입금확인 · 토큰 지급" },
                confirm: {
                  title: { type: "plain_text", text: "입금확인" },
                  text: {
                    type: "mrkdwn",
                    text: `*${depositor} · ${pay}원* 입금을 확인했나요?\n확인하면 ${o.tokens.toLocaleString()} 토큰이 바로 지급됩니다.`,
                  },
                  confirm: { type: "plain_text", text: "지급" },
                  deny: { type: "plain_text", text: "취소" },
                },
              },
              {
                type: "button",
                action_id: "transfer_open_admin",
                url: adminUrl,
                text: { type: "plain_text", text: "관리자 화면" },
              },
            ],
          }
        : {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Slack 버튼 미설정(SLACK_SIGNING_SECRET) — 관리자 화면에서 입금확인: ${adminUrl}`,
              },
            ],
          },
    ],
  });
}

/** 입금확인 결과 Slack 메시지 — 버튼 알림을 이 내용으로 교체(관리자 화면에서 처리했으면 새로 게시). */
export async function transferConfirmedSlackMessage(
  o: PaymentOrder,
  by: string,
  balance: number
): Promise<SlackMessage> {
  const ctx = await orderContext(o);
  return {
    text: `✅ 입금확인 완료 — ${ctx.orgName} ${withVat(o.amountKrw).toLocaleString()}원`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*✅ 입금확인 완료* · 주문 #${o.id}\n${slackSummary(o, ctx.orgName)}\n처리: ${by} · 법인 잔액 ${balance.toLocaleString()} 토큰`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `세금계산서 발행 정보: <${adminPaymentsUrl(o)}|관리자 결제 내역>`,
          },
        ],
      },
    ],
  };
}

/** 입금확인(첫 지급) 후 — 신청자에게 인앱 알림 + 충전 완료 메일. */
export async function notifyTransferConfirmed(o: PaymentOrder, balance: number): Promise<void> {
  const ctx = await orderContext(o);
  if (!ctx.requester) return;
  try {
    await createNotification({
      userId: ctx.requester.id,
      type: "token_charged",
      title: `계좌이체 입금이 확인되어 ${o.tokens.toLocaleString()} 토큰이 충전되었습니다`,
      href: "/org/tokens",
      payload: { paymentOrderId: o.id },
    });
  } catch (e) {
    console.error("[bank-transfer] 충전 완료 인앱 알림 실패:", e);
  }

  if (!(await isSmtpAvailable(null))) return;
  const pay = withVat(o.amountKrw).toLocaleString();
  const tokensUrl = `${resolveMailBaseUrl()}/org/tokens`;
  const taxLine = ctx.bizNo
    ? "세금계산서는 담당자가 발행해 메일로 보내 드립니다."
    : "세금계산서가 필요하시면 법인 설정에 사업자등록번호를 등록한 뒤 고객센터로 알려 주세요.";
  const rows: Array<[string, string]> = [
    ["입금액", `${pay}원`],
    ["충전 토큰", `${o.tokens.toLocaleString()} 토큰`],
    ["현재 잔액", `${balance.toLocaleString()} 토큰`],
  ];
  const innerHtml = `
    <h2 style="margin:8px 0 12px;font-size:18px;color:${EMAIL_BRAND.ink};line-height:1.4;">입금이 확인되어 토큰이 충전되었습니다</h2>
    ${infoTable(rows)}
    <p style="margin:0 0 20px;font-size:13px;color:#334155;line-height:1.6;">${escapeHtml(taxLine)}</p>
    ${ctaButton(tokensUrl, "토큰 페이지 보기")}
  `;
  const text = `입금이 확인되어 토큰이 충전되었습니다.

${rows.map(([k, val]) => `${k}: ${val}`).join("\n")}

${taxLine}

토큰 페이지: ${tokensUrl}`;
  await sendMail({
    to: ctx.requester.email,
    subject: `[${SITE_INFO.serviceName}] 계좌이체 입금 확인 — ${o.tokens.toLocaleString()} 토큰 충전 완료`,
    html: wrapEmailCard({ innerHtml }),
    text,
    orgId: null,
    audience: "org",
    kind: "transfer_paid",
  });
}

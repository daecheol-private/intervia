import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { isTransferChargeAmount } from "@/lib/beta";
import { BANK_TRANSFER_ACCOUNT } from "@/lib/site-info";
import {
  TRANSFER_DEPOSIT_DAYS,
  createTransferOrder,
  listTransferOrders,
  notifyTransferCreated,
  toTransferView,
} from "@/lib/bank-transfer";

export const runtime = "nodejs";

/**
 * 계좌이체 충전 (카드 1회 한도 10만원 초과분).
 * GET  — 입금 계좌 + 내 법인 최근 계좌이체 주문(입금 안내·확인 요청 화면용).
 * POST — 신청: pending 주문 생성 → 응답 후 신청자 입금 안내 메일 + 운영자 Slack.
 * 권한: org_admin 만 (카드 결제와 동일 — 결제는 법인 관리자 책임).
 */
async function loadOrgAdmin() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return { error: guard } as const;
  const pw = requirePasswordChanged(me);
  if (pw) return { error: pw } as const;
  if (me!.role !== "org_admin")
    return { error: new Response("법인 관리자만 충전할 수 있습니다.", { status: 403 }) } as const;
  const orgId = me!.orgId;
  if (!orgId) return { error: new Response("소속 법인이 없습니다.", { status: 400 }) } as const;
  return { me: me!, orgId } as const;
}

export async function GET() {
  const a = await loadOrgAdmin();
  if ("error" in a) return a.error;
  const [org] = await db
    .select({ bizNo: organizations.bizRegistrationNo })
    .from(organizations)
    .where(eq(organizations.id, a.orgId));
  return Response.json({
    account: BANK_TRANSFER_ACCOUNT,
    depositDays: TRANSFER_DEPOSIT_DAYS,
    bizRegistrationNo: org?.bizNo ?? null,
    orders: await listTransferOrders(a.orgId),
  });
}

export async function POST(req: Request) {
  const a = await loadOrgAdmin();
  if ("error" in a) return a.error;

  const limited = await rateLimit(req, "transfer_request", { limit: 5, windowSec: 600 }, a.me.id);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { amountKrw?: unknown } | null;
  const amountKrw = Number(body?.amountKrw);
  if (!Number.isSafeInteger(amountKrw) || !isTransferChargeAmount(amountKrw))
    return new Response(
      "계좌이체로 신청할 수 없는 금액입니다. 10만원 미만은 카드로 충전해 주세요.",
      { status: 400 }
    );

  const order = await createTransferOrder({ orgId: a.orgId, userId: a.me.id, amountKrw });
  logAudit(req, {
    actor: a.me,
    action: "payment.transfer_request",
    resourceType: "payment_order",
    resourceId: order.id,
    orgId: a.orgId,
    metadata: { amountKrw, tokens: order.tokens },
  });
  after(() =>
    notifyTransferCreated(order).catch((e) => console.error("[transfer] 신청 통지 실패:", e))
  );
  return Response.json({ ok: true, order: toTransferView(order) });
}

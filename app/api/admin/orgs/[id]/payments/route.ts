import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { db } from "@/lib/db";
import { paymentOrders, users, organizations } from "@/lib/schema";
import { desc, eq } from "drizzle-orm";

export const runtime = "nodejs";

/** 법인의 결제(충전) 주문 내역 — system_admin 전용. 환불(결제취소) 대상 식별용. */
export async function GET(
  _req: Request,
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
  const orgId = Number(id);
  if (!Number.isInteger(orgId))
    return new Response("orgId 형식 오류", { status: 400 });

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });

  const rows = await db
    .select({
      id: paymentOrders.id,
      amountKrw: paymentOrders.amountKrw,
      tokens: paymentOrders.tokens,
      status: paymentOrders.status,
      provider: paymentOrders.provider,
      providerRef: paymentOrders.providerRef,
      createdAt: paymentOrders.createdAt,
      byName: users.name,
      byEmail: users.email,
    })
    .from(paymentOrders)
    .leftJoin(users, eq(users.id, paymentOrders.createdByUserId))
    .where(eq(paymentOrders.orgId, orgId))
    .orderBy(desc(paymentOrders.id))
    .limit(200);

  return Response.json({ orgId, orgName: org.name, orders: rows });
}

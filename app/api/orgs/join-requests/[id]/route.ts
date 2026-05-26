import { db } from "@/lib/db";
import { users, orgJoinRequests, notifications } from "@/lib/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });

  const { id } = await params;
  const reqId = Number(id);
  const { action } = (await req.json().catch(() => ({}))) as {
    action?: "approve" | "reject";
  };
  if (action !== "approve" && action !== "reject")
    return new Response("action=approve|reject 필요", { status: 400 });

  const [row] = await db
    .select()
    .from(orgJoinRequests)
    .where(eq(orgJoinRequests.id, reqId));
  if (!row) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, row.orgId))
    return new Response("권한 없음", { status: 403 });
  if (row.status !== "pending")
    return new Response("이미 처리된 요청입니다.", { status: 409 });

  const now = new Date().toISOString();
  const nextStatus = action === "approve" ? "approved" : "rejected";
  const userStatus = action === "approve" ? "active" : "disabled";

  await db
    .update(orgJoinRequests)
    .set({
      status: nextStatus,
      decidedByUserId: me!.id,
      decidedAt: now,
    })
    .where(eq(orgJoinRequests.id, reqId));

  // 승인 시: 법인 관리자가 본인확인 역할을 함 — emailVerifiedAt 도 함께 기록.
  // (별도 인증 메일 발송 없음. 합류 요청 흐름은 §22의2 + admin 검토로 본인확인 충족)
  const userUpdate: { status: typeof userStatus; emailVerifiedAt?: string } = {
    status: userStatus,
  };
  if (action === "approve") userUpdate.emailVerifiedAt = now;

  await db
    .update(users)
    .set(userUpdate)
    .where(eq(users.id, row.userId));

  // 처리한 사람(본인 + 같은 법인 다른 org_admin) 의 'join_request' 알림 자동 읽음 처리.
  // payload 에 userId 가 들어있는 join_request 알림을 매칭 — 다른 요청은 건드리지 않음.
  // 클라이언트는 60초 뒤 폴링으로 배지가 사라지지만, 즉시 갱신을 원하면 별도 fetch 트리거.
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.type, "join_request"),
        isNull(notifications.readAt),
        sql`json_extract(${notifications.payload}, '$.userId') = ${row.userId}`
      )
    );

  return Response.json({ ok: true, status: nextStatus });
}

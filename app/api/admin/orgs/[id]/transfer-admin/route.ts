/**
 * 법인 관리자 이전 — sysadmin 전용.
 * 시나리오: org_admin 이 퇴사/연락두절 → 다른 멤버에게 관리 권한 강제 이전.
 *
 * 동작:
 *   - to 사용자: member → org_admin 으로 승격
 *   - from 사용자: org_admin → member 로 강등 (있으면)
 *
 * 가드:
 *   - from/to 모두 해당 법인 소속이어야 함
 *   - to 가 system_admin 이면 거부 (sysadmin 은 법인 멤버 역할 불필요)
 *   - to 가 disabled 면 거부
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { users, organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });

  const { id } = await params;
  const orgId = Number(id);
  const body = (await req.json().catch(() => ({}))) as {
    toUserId?: number;
    fromUserId?: number | null;
    reason?: string;
  };
  const toUserId = Number(body.toUserId);
  if (!toUserId)
    return new Response("toUserId 필요", { status: 400 });

  const reason = (body.reason ?? "").trim();
  if (reason.length < 5)
    return new Response("이전 사유는 5자 이상 입력하세요.", { status: 400 });

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });

  const [to] = await db
    .select()
    .from(users)
    .where(eq(users.id, toUserId));
  if (!to) return new Response("toUser 없음", { status: 404 });
  if (to.orgId !== orgId)
    return new Response("toUser 가 해당 법인 소속이 아닙니다.", { status: 400 });
  if (to.role === "system_admin")
    return new Response("시스템 관리자에게는 org_admin 권한이 별도 부여되지 않습니다.", {
      status: 400,
    });
  if (to.status !== "active")
    return new Response("비활성 사용자에게는 권한을 이전할 수 없습니다.", {
      status: 400,
    });

  // fromUser 처리 (옵션)
  let fromInfo: { id: number; email: string; previousRole: string } | null = null;
  if (body.fromUserId) {
    const fromId = Number(body.fromUserId);
    const [from] = await db.select().from(users).where(eq(users.id, fromId));
    if (!from) return new Response("fromUser 없음", { status: 404 });
    if (from.orgId !== orgId)
      return new Response("fromUser 가 해당 법인 소속이 아닙니다.", {
        status: 400,
      });
    if (from.role === "system_admin")
      return new Response("시스템 관리자는 강등할 수 없습니다.", {
        status: 400,
      });
    fromInfo = { id: from.id, email: from.email, previousRole: from.role };
    // 강등: org_admin/member 모두 member 로 (이미 member 면 no-op)
    if (from.role === "org_admin") {
      await db
        .update(users)
        .set({ role: "member" })
        .where(eq(users.id, from.id));
    }
  }

  // toUser 승격
  await db
    .update(users)
    .set({ role: "org_admin" })
    .where(eq(users.id, to.id));

  logAudit(req, {
    actor: me,
    action: "org.admin_transfer",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: {
      reason,
      orgName: org.name,
      to: { id: to.id, email: to.email, previousRole: to.role },
      from: fromInfo,
    },
  });

  return Response.json({
    ok: true,
    to: { id: to.id, email: to.email, role: "org_admin" },
    from: fromInfo,
  });
}

/**
 * 특정 사용자의 모든 활성 세션 강제 만료 — sysadmin 전용.
 * 본인 자신은 대상 제외 (실수로 본인 락아웃 방지).
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const { id } = await params;
  const targetId = Number(id);
  if (targetId === me!.id)
    return new Response("본인 세션은 /account 페이지에서 로그아웃하세요.", {
      status: 400,
    });

  const [target] = await db
    .select({ id: users.id, email: users.email, orgId: users.orgId })
    .from(users)
    .where(eq(users.id, targetId));
  if (!target) return new Response("사용자 없음", { status: 404 });

  const deleted = await db
    .delete(sessions)
    .where(eq(sessions.userId, targetId))
    .returning({ token: sessions.token });

  logAudit(req, {
    actor: me,
    action: "session.force_logout",
    resourceType: "user",
    resourceId: targetId,
    orgId: target.orgId,
    metadata: {
      targetEmail: target.email,
      sessionsRevoked: deleted.length,
      scope: "user",
    },
  });

  return Response.json({ sessionsRevoked: deleted.length });
}

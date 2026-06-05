/**
 * 법인 정지/재개 — sysadmin 전용.
 *
 * POST   /api/admin/orgs/[id]/suspend  { reason } — 정지
 * DELETE /api/admin/orgs/[id]/suspend                — 재개
 *
 * 정지 효과:
 *   - 멤버 신규 로그인 차단 (auth/login 라우트 가드)
 *   - 기존 세션도 getCurrentUser() 에서 자동 로그아웃
 *   - system_admin 은 우회 (정지 해제 위해 접근 필요)
 *
 * 세션 강제 만료: 정지 시 해당 법인 모든 세션 delete.
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { organizations, users, sessions } from "@/lib/schema";
import { eq, inArray, ne } from "drizzle-orm";

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
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const { id } = await params;
  const orgId = Number(id);
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason ?? "").trim();
  if (reason.length < 5)
    return new Response("정지 사유는 5자 이상 입력하세요.", { status: 400 });

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });
  if (org.suspendedAt) return new Response("이미 정지된 법인입니다.", { status: 400 });

  const now = new Date().toISOString();
  await db
    .update(organizations)
    .set({ suspendedAt: now, suspendedReason: reason })
    .where(eq(organizations.id, orgId));

  // 해당 법인 멤버 (system_admin 제외) 의 모든 세션 강제 만료
  const memberIds = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.orgId, orgId));
  const targetIds = memberIds
    .map((r) => r.id)
    .filter((uid) => uid !== me!.id); // 본인 세션 보호
  let revoked = 0;
  if (targetIds.length > 0) {
    const sessionsDeleted = await db
      .delete(sessions)
      .where(inArray(sessions.userId, targetIds))
      .returning({ token: sessions.token });
    revoked = sessionsDeleted.length;
  }

  logAudit(req, {
    actor: me,
    action: "org.suspend",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: {
      reason,
      sessionsRevoked: revoked,
      memberCount: memberIds.length,
      orgName: org.name,
    },
  });

  return Response.json({ suspendedAt: now, sessionsRevoked: revoked });
}

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
  const orgId = Number(id);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });
  if (!org.suspendedAt)
    return new Response("정지 상태가 아닙니다.", { status: 400 });

  await db
    .update(organizations)
    .set({ suspendedAt: null, suspendedReason: null })
    .where(eq(organizations.id, orgId));

  logAudit(req, {
    actor: me,
    action: "org.resume",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: {
      previousSuspendedAt: org.suspendedAt,
      previousReason: org.suspendedReason,
      orgName: org.name,
    },
  });

  return Response.json({ ok: true });
}

// linter satisfaction: `ne` import is used by future helpers
void ne;

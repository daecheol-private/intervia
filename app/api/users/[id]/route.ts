import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { and, eq, ne, count } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const targetId = Number(id);
  const body = (await req.json().catch(() => ({}))) as {
    role?: "system_admin" | "org_admin" | "member";
    status?: "active" | "disabled";
  };

  const [target] = await db.select().from(users).where(eq(users.id, targetId));
  if (!target) return new Response("Not found", { status: 404 });

  // 권한: system_admin은 모든 사용자, org_admin은 자기 법인 사용자만
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });
  if (me!.role === "org_admin" && !ownsOrg(me!, target.orgId))
    return new Response("권한 없음", { status: 403 });

  // 민감 액션 — step-up 인증 통과 필수 (role/status 변경 모두)
  const stepUpGuard = await requireStepUp();
  if (stepUpGuard) return stepUpGuard;

  // org_admin 은 system_admin role 부여 불가
  if (body.role === "system_admin" && me!.role !== "system_admin")
    return new Response("system_admin 권한은 시스템 관리자만 부여할 수 있습니다.", {
      status: 403,
    });

  const update: Record<string, unknown> = {};

  // role 변경
  if (body.role && body.role !== target.role) {
    // 마지막 org_admin 박탈 방지
    if (target.role === "org_admin" && body.role !== "org_admin" && target.orgId) {
      const [{ c }] = await db
        .select({ c: count() })
        .from(users)
        .where(
          and(
            eq(users.orgId, target.orgId),
            eq(users.role, "org_admin"),
            ne(users.id, target.id)
          )
        );
      if (c === 0)
        return new Response(
          "법인의 마지막 관리자는 권한을 박탈할 수 없습니다.",
          { status: 409 }
        );
    }
    // 마지막 system_admin 박탈 방지 (운영 락아웃 방지)
    if (target.role === "system_admin" && body.role !== "system_admin") {
      const [{ c }] = await db
        .select({ c: count() })
        .from(users)
        .where(
          and(
            eq(users.role, "system_admin"),
            eq(users.status, "active"),
            ne(users.id, target.id)
          )
        );
      if (c === 0)
        return new Response(
          "마지막 시스템 관리자는 권한을 박탈할 수 없습니다. 먼저 다른 사용자에게 system_admin 권한을 부여하세요.",
          { status: 409 }
        );
    }
    update.role = body.role;
  }

  // status 변경 (멤버 추방/복귀)
  if (body.status && body.status !== target.status) {
    // 마지막 system_admin 비활성화 방지
    if (target.role === "system_admin" && body.status === "disabled") {
      const [{ c }] = await db
        .select({ c: count() })
        .from(users)
        .where(
          and(
            eq(users.role, "system_admin"),
            eq(users.status, "active"),
            ne(users.id, target.id)
          )
        );
      if (c === 0)
        return new Response(
          "마지막 활성 시스템 관리자는 비활성화할 수 없습니다.",
          { status: 409 }
        );
    }
    if (target.role === "org_admin" && body.status === "disabled" && target.orgId) {
      const [{ c }] = await db
        .select({ c: count() })
        .from(users)
        .where(
          and(
            eq(users.orgId, target.orgId),
            eq(users.role, "org_admin"),
            eq(users.status, "active"),
            ne(users.id, target.id)
          )
        );
      if (c === 0)
        return new Response("법인의 마지막 활성 관리자는 비활성화할 수 없습니다.", {
          status: 409,
        });
    }
    update.status = body.status;
  }

  if (Object.keys(update).length === 0)
    return new Response("변경할 내용이 없습니다.", { status: 400 });

  const [updated] = await db
    .update(users)
    .set(update)
    .where(eq(users.id, targetId))
    .returning();

  if (update.role) {
    logAudit(req, {
      actor: me!,
      action: "user.role_change",
      resourceType: "user",
      resourceId: targetId,
      orgId: updated.orgId,
      metadata: { from: target.role, to: update.role, email: updated.email },
    });
  }
  if (update.status) {
    logAudit(req, {
      actor: me!,
      action: "user.status_change",
      resourceType: "user",
      resourceId: targetId,
      orgId: updated.orgId,
      metadata: {
        from: target.status,
        to: update.status,
        email: updated.email,
      },
    });
  }

  return Response.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    status: updated.status,
  });
}

import { db } from "@/lib/db";
import { users, orgJoinRequests, notifications } from "@/lib/schema";
import { and, eq, ne, count, isNull, sql } from "drizzle-orm";
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
    // 관리자가 대신 이메일 인증 처리 — 인증 메일이 도달하지 않는 사용자 구제용.
    // true 면 emailVerifiedAt 을 현재 시각으로 설정(이미 인증된 경우 무시).
    emailVerified?: boolean;
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

  // 관리자 대리 이메일 인증 — 아직 미인증인 경우에만 현재 시각으로 설정.
  // 합류 요청 승인(org_admin)이 emailVerifiedAt 을 자동 설정하는 것과 동일한 취지:
  // 관리자의 본인 확인이 인증 메일 클릭을 대신한다.
  //
  // pending(법인 합류 승인 대기) 사용자는 이메일만 인증해도 로그인이 막힌다
  // (login 라우트가 status==='pending' 을 emailVerifiedAt 보다 먼저 차단).
  // 관리자의 수동 인증은 곧 본인확인이므로 합류 승인을 겸해 status 도 active 로 올린다.
  const activateFromPending =
    body.emailVerified === true && target.status === "pending";
  if (body.emailVerified === true) {
    if (!target.emailVerifiedAt)
      update.emailVerifiedAt = new Date().toISOString();
    if (activateFromPending) update.status = "active";
  }

  if (Object.keys(update).length === 0)
    return new Response("변경할 내용이 없습니다.", { status: 400 });

  const [updated] = await db
    .update(users)
    .set(update)
    .where(eq(users.id, targetId))
    .returning();

  // pending 사용자를 인증과 함께 활성화한 경우: 대기 중인 합류 요청도 승인 처리하고
  // 관련 'join_request' 알림을 읽음 처리한다 (합류 요청 탭 승인과 동일한 후처리).
  if (activateFromPending) {
    const now = new Date().toISOString();
    await db
      .update(orgJoinRequests)
      .set({ status: "approved", decidedByUserId: me!.id, decidedAt: now })
      .where(
        and(
          eq(orgJoinRequests.userId, targetId),
          eq(orgJoinRequests.status, "pending")
        )
      );
    await db
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.type, "join_request"),
          isNull(notifications.readAt),
          sql`json_extract(${notifications.payload}, '$.userId') = ${targetId}`
        )
      );
  }

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
  if (update.emailVerifiedAt) {
    logAudit(req, {
      actor: me!,
      action: "user.email_verify",
      resourceType: "user",
      resourceId: targetId,
      orgId: updated.orgId,
      metadata: { email: updated.email, manual: true },
    });
  }

  return Response.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    status: updated.status,
    emailVerified: !!updated.emailVerifiedAt,
  });
}

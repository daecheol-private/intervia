import { db } from "@/lib/db";
import { users, orgJoinRequests, notifications } from "@/lib/schema";
import { and, eq, ne, count, isNull, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { logAudit } from "@/lib/audit";
import { isProtectedSystemAdminEmail } from "@/lib/bootstrap-admin";
import { honorJobShareInvites } from "@/lib/invites";

export const runtime = "nodejs";

/**
 * 계정 영구 삭제 — sysadmin 전용. 파괴적.
 *
 * 전제: 계정이 **비활성(disabled)** 상태여야 함 (실수 방지 2단계).
 * 가드: step-up 인증 + 사유 5자+ + confirm 에 이메일 정확히.
 *
 * 차단: 본인 / system_admin 계정 (먼저 sysadmin 권한 회수 후 삭제).
 * 삭제 시 세션·알림·즐겨찾기·합류요청·면접관 메모 등은 FK CASCADE 로 정리.
 * (작성한 후보자/공고 등의 참조는 ON DELETE SET NULL — 데이터 자체는 보존.)
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });

  const stepUpGuard = await requireStepUp();
  if (stepUpGuard) return stepUpGuard;

  const { id } = await params;
  const targetId = Number(id);
  if (targetId === me!.id)
    return new Response("본인 계정은 삭제할 수 없습니다.", { status: 400 });

  const body = (await req.json().catch(() => ({}))) as {
    reason?: string;
    confirm?: string;
    // force=true: 비활성(disabled) 전제조건을 건너뛰고 활성/대기 계정도 즉시 삭제.
    // (잘못 등록된 계정이 법인의 마지막 org_admin 이라 비활성화조차 막히는 catch-22 해소)
    force?: boolean;
  };
  const reason = (body.reason ?? "").trim();
  if (reason.length < 5)
    return new Response("삭제 사유는 5자 이상 입력하세요.", { status: 400 });

  const [target] = await db.select().from(users).where(eq(users.id, targetId));
  if (!target) return new Response("Not found", { status: 404 });

  // SYSTEM_ADMIN_EMAIL 로 지정된 보호 계정 — 삭제 불가 (env/DB 직접 관리 전용).
  if (isProtectedSystemAdminEmail(target.email))
    return new Response(
      "SYSTEM_ADMIN_EMAIL 로 지정된 시스템 관리자 계정은 삭제할 수 없습니다. (운영 락아웃 방지 — 변경이 필요하면 환경변수/DB 를 직접 다루세요.)",
      { status: 403 }
    );

  if (target.role === "system_admin")
    return new Response(
      "시스템 관리자 계정은 삭제할 수 없습니다. 먼저 sysadmin 권한을 회수하세요.",
      { status: 409 }
    );

  // 전제조건: 기본은 비활성(disabled) 계정만 (실수 방지 2단계).
  // force=true 면 활성/대기 계정도 즉시 삭제 — system_admin 전용 + step-up + 이메일 confirm 으로 여전히 보호.
  if (!body.force && target.status !== "disabled")
    return new Response(
      "비활성(disabled) 계정만 삭제할 수 있습니다. 먼저 계정을 비활성화하거나, 강제 삭제(force)를 사용하세요.",
      { status: 400 }
    );

  // 실수 방지: 이메일 정확히 입력
  const got = (body.confirm ?? "").trim();
  if (got !== target.email.trim())
    return new Response(
      `실수 방지: 이메일(${target.email}) 을 confirm 필드에 정확히 입력하세요.`,
      { status: 400 }
    );

  await db.delete(users).where(eq(users.id, targetId));

  logAudit(req, {
    actor: me!,
    action: "user.delete",
    resourceType: "user",
    resourceId: targetId,
    orgId: target.orgId,
    metadata: {
      reason,
      email: target.email,
      name: target.name,
      role: target.role,
      force: !!body.force,
      status: target.status,
    },
  });

  return new Response(null, { status: 204 });
}

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

  // SYSTEM_ADMIN_EMAIL 로 지정된 보호 계정 — 권한/상태 변경 불가 (실수로 비활성화·권한 회수
  // 해 운영 락아웃되는 사고 방지). 변경이 필요하면 환경변수/DB 를 직접 다뤄야 한다.
  // 권한 체크 이후에 둬, 권한 없는 사용자에겐 보호 계정의 존재를 노출하지 않는다.
  if (isProtectedSystemAdminEmail(target.email))
    return new Response(
      "SYSTEM_ADMIN_EMAIL 로 지정된 시스템 관리자 계정은 변경할 수 없습니다. (운영 락아웃 방지)",
      { status: 403 }
    );

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
    // member → org_admin 승격이면 시작 가이드 재노출(개인 단위 리셋) — 이미 셋업이
    // 끝난 법인이라도 새 관리자가 각 단계 '따라하기'로 사용법을 둘러볼 수 있게 dismiss
    // 를 해제한다. 단계 완료 표시(✓)는 법인 현황 그대로 유지. (transfer-admin 과 동일 정책)
    if (body.role === "org_admin") update.setupGuideDismissedAt = null;
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

  // 사용자가 이 액션으로 active 가 됐다면(상태 토글 disabled/pending→active, 또는 대리 인증
  // 활성화) 공유 공고 초대를 honor 해 면접관으로 자동 등록한다. 합류요청 승인 핸들러와 동일한
  // 처리 — 활성화 경로가 갈라져도 면접관 등록이 누락되지 않도록 active 전환 지점마다 호출.
  if (update.status === "active") {
    await honorJobShareInvites(targetId, updated.orgId);
  }

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
      // activatedFromPending=true 면 관리자가 합류 승인 + 메일인증을 한 번에 대리 처리한 것
      // (회원가입 합류 경로의 2중 게이트를 모두 우회) — 사칭 조사 시 추적 신호.
      metadata: { email: updated.email, manual: true, activatedFromPending: activateFromPending },
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

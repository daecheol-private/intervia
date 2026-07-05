/**
 * 법인 관리자 이전 — sysadmin 전용.
 * 시나리오: org_admin 이 퇴사/연락두절 → 다른 멤버에게 관리 권한 강제 이전.
 *
 * 동작:
 *   - to 사용자: member → org_admin 으로 승격 + 시작 가이드 재노출(개인 단위 리셋)
 *   - from 사용자: org_admin → member 로 강등 (있으면)
 *
 * 가드:
 *   - from/to 모두 해당 법인 소속이어야 함
 *   - to 가 system_admin 이면 거부 (sysadmin 은 법인 멤버 역할 불필요)
 *   - to 가 disabled 면 거부
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { users, organizations, orgJoinRequests } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

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
  if (to.status === "disabled")
    return new Response(
      "비활성(disabled) 계정에는 권한을 이전할 수 없습니다. 먼저 계정을 활성화하세요.",
      { status: 400 }
    );

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

  // toUser 승격 + 시작 가이드 재노출 (개인 단위) — 이미 셋업이 끝난 법인이라도
  // 새 담당자가 각 단계 '따라하기'로 사용법을 둘러볼 수 있게 dismiss 를 해제한다.
  // 단계 완료 표시(✓)는 법인 현황 그대로 유지된다.
  //
  // pending 합류 신청자를 승격하는 경우(담당자 공석 법인의 유일한 정상 승계 경로): 운영자가
  // 오프라인 신원 검증을 거쳐 담당자로 세우는 강한 관리 행위이므로, 로그인 관문
  // (status=active + 이메일 인증) 을 함께 통과시킨다. 이메일 소유 확인은 운영자 검증으로
  // 대체되며 이 행위 전체가 감사 로그에 남는다. (기존 active 유저 승격은 두 값을 건드리지 않음.)
  const wasPending = to.status === "pending";
  const now = new Date().toISOString();
  const setValues: Partial<typeof users.$inferInsert> = {
    role: "org_admin",
    setupGuideDismissedAt: null,
  };
  if (wasPending) {
    setValues.status = "active";
    setValues.emailVerifiedAt = to.emailVerifiedAt ?? now;
  }
  await db.update(users).set(setValues).where(eq(users.id, to.id));

  // pending 이었다면 대기 중이던 합류 요청(orgJoinRequests)도 승인으로 정리 —
  // 안 하면 법인 멤버 화면에 "합류 요청 대기"로 계속 남는다.
  if (wasPending) {
    await db
      .update(orgJoinRequests)
      .set({ status: "approved", decidedByUserId: me!.id, decidedAt: now })
      .where(
        and(
          eq(orgJoinRequests.userId, to.id),
          eq(orgJoinRequests.status, "pending")
        )
      );
  }

  logAudit(req, {
    actor: me,
    action: "org.admin_transfer",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: {
      reason,
      orgName: org.name,
      to: {
        id: to.id,
        email: to.email,
        previousRole: to.role,
        previousStatus: to.status,
        promotedFromPending: wasPending,
      },
      from: fromInfo,
    },
  });

  return Response.json({
    ok: true,
    to: { id: to.id, email: to.email, role: "org_admin" },
    from: fromInfo,
  });
}

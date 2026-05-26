/**
 * 초대 수락 — 로그인 상태에서만 호출. 비로그인 신규 가입 흐름은 /signup?invite=token 으로.
 *
 * 정책:
 *  - 로그인 사용자의 이메일이 초대장 이메일과 일치해야 함
 *  - 사용자가 법인 없음 → 그 법인 active 멤버로 합류 (역할 member)
 *  - 사용자가 같은 법인 멤버 → 이미 멤버, 토큰만 consume
 *  - 사용자가 다른 법인 멤버 → 거절
 *  - system_admin 은 거절 (이미 전체 접근)
 */
import { db } from "@/lib/db";
import { orgInvites, users, jobInterviewers } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { token } = await params;
  const [inv] = await db
    .select()
    .from(orgInvites)
    .where(eq(orgInvites.token, token));
  if (!inv)
    return Response.json(
      { code: "not_found", message: "유효하지 않은 초대 링크입니다." },
      { status: 404 }
    );
  if (inv.usedAt)
    return Response.json(
      { code: "used", message: "이미 사용된 초대 링크입니다." },
      { status: 410 }
    );
  if (new Date(inv.expiresAt) < new Date())
    return Response.json(
      { code: "expired", message: "만료된 초대 링크입니다." },
      { status: 410 }
    );

  // 이메일 매칭
  if (me!.email.toLowerCase() !== inv.email.toLowerCase()) {
    return Response.json(
      {
        code: "email_mismatch",
        message: `초대받은 이메일(${inv.email}) 과 로그인 계정이 다릅니다. 해당 이메일로 로그인 후 다시 시도해 주세요.`,
      },
      { status: 403 }
    );
  }

  if (me!.role === "system_admin") {
    return Response.json(
      { code: "system_admin", message: "시스템관리자는 합류 대상이 아닙니다." },
      { status: 400 }
    );
  }

  // 이미 같은 법인 → 토큰만 consume + 공고 면접관 자동 추가, 공고로 리다이렉트
  if (me!.orgId === inv.orgId) {
    await db
      .update(orgInvites)
      .set({ usedAt: new Date().toISOString(), usedByUserId: me!.id })
      .where(eq(orgInvites.id, inv.id));
    if (inv.jobId) {
      await db
        .insert(jobInterviewers)
        .values({
          jobId: inv.jobId,
          userId: me!.id,
          assignedByUserId: inv.invitedByUserId,
        })
        .onConflictDoNothing();
    }
    return Response.json({
      ok: true,
      code: "already_member",
      orgId: inv.orgId,
      jobId: inv.jobId,
    });
  }

  // 다른 법인 소속 → 거절
  if (me!.orgId != null && me!.orgId !== inv.orgId) {
    return Response.json(
      {
        code: "in_other_org",
        message:
          "이미 다른 법인에 소속되어 있습니다. 기존 법인 탈퇴 후 다시 시도해 주세요.",
      },
      { status: 409 }
    );
  }

  // 법인 없음 → 합류
  await db
    .update(users)
    .set({ orgId: inv.orgId, role: "member", status: "active" })
    .where(eq(users.id, me!.id));
  await db
    .update(orgInvites)
    .set({ usedAt: new Date().toISOString(), usedByUserId: me!.id })
    .where(eq(orgInvites.id, inv.id));
  // 초대 발급된 공고가 있으면 면접관 자동 추가
  if (inv.jobId) {
    await db
      .insert(jobInterviewers)
      .values({
        jobId: inv.jobId,
        userId: me!.id,
        assignedByUserId: inv.invitedByUserId,
      })
      .onConflictDoNothing();
  }

  logAudit(req, {
    actor: me!,
    action: "user.status_change" as const,
    resourceType: "user" as const,
    resourceId: me!.id,
    orgId: inv.orgId,
    metadata: { kind: "invite_accept", inviteId: inv.id, jobId: inv.jobId },
  });

  return Response.json({ ok: true, code: "joined", orgId: inv.orgId, jobId: inv.jobId });
}

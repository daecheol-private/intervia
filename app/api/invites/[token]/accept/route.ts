/**
 * 초대 수락 — 로그인 상태에서만 호출. 비로그인 신규 가입 흐름은 signup-via-invite 로.
 *
 * 정책 (2026-06-08 — 공유는 일반 멤버도 가능하므로 신규 합류는 승인 필수):
 *  - 로그인 사용자의 이메일이 초대장 이메일과 일치해야 함
 *  - 사용자가 법인 없음 → 합류 요청(pending) 생성 + 세션 만료, 법인담당자 승인 대기
 *    (승인 시 미사용 초대 honor → 공유 공고 면접관 자동 등록)
 *  - 사용자가 같은 법인 멤버 → 토큰 consume + 즉시 그 공고 면접관 등록 (이미 검증된 멤버)
 *  - 사용자가 다른 법인 멤버 → 거절
 *  - system_admin 은 거절 (이미 전체 접근)
 */
import { db } from "@/lib/db";
import { orgInvites, users, jobInterviewers, orgJoinRequests } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  getCurrentUser,
  deleteSession,
  clearSessionCookie,
} from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { notifyOrgAdmins } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
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

  // 법인 없음 → 합류 요청(pending) 생성 + 법인담당자 승인 대기.
  // 공고 공유는 일반 멤버도 할 수 있으므로 신규 합류는 승인을 거쳐야 한다.
  // 초대는 consume 하지 않음 — 승인 시 honor 되어 공유 공고 면접관으로 자동 등록.
  // pending 사용자가 로그인 상태로 남으면 인증 게이트(로그인 시점에만 status 검사)를
  // 우회하므로, 현재 세션을 만료시켜 승인 후 재로그인하도록 한다.
  await db
    .update(users)
    .set({ orgId: inv.orgId, role: "member", status: "pending" })
    .where(eq(users.id, me!.id));
  await db.insert(orgJoinRequests).values({
    orgId: inv.orgId,
    userId: me!.id,
    status: "pending",
  });

  // 승인해야만 신규 직원이 입장 가능 — 매일 로그인 안 하는 관리자도 메일로 인지.
  // (자가 합류요청 경로 orgs/join-requests 와 동일하게 email:true)
  void notifyOrgAdmins(
    inv.orgId,
    {
      type: "join_request",
      title: `${me!.name} (${me!.email}) 님이 공고 공유로 합류를 요청했습니다`,
      href: "/org/members",
      payload: { userId: me!.id, orgId: inv.orgId, jobId: inv.jobId },
    },
    { email: true }
  );

  await deleteSession(me!.sessionToken);
  await clearSessionCookie();

  return Response.json({ ok: true, code: "pending", orgId: inv.orgId });
}

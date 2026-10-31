/**
 * 시스템 관리자가 사용자의 2단계 인증을 해제 — 휴대폰 분실·남이 건 2FA 로 잠긴 경우 복구용.
 * 비밀번호 재확인 필수, 그 사용자의 모든 세션을 끊고 감사 기록을 남긴다.
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/schema";
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
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;
  const stepUp = await requireStepUp();
  if (stepUp) return stepUp;

  const { id } = await params;
  const targetId = Number(id);
  const [target] = await db
    .select({ id: users.id, orgId: users.orgId, totpEnabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, targetId));
  if (!target) return new Response("사용자 없음", { status: 404 });
  if (!target.totpEnabledAt)
    return new Response("2단계 인증이 켜져 있지 않은 사용자입니다.", { status: 400 });

  await db.update(users).set({ totpSecret: null, totpEnabledAt: null }).where(eq(users.id, targetId));
  const revoked = await db.delete(sessions).where(eq(sessions.userId, targetId)).returning({ token: sessions.token });

  logAudit(req, {
    actor: me,
    action: "user.2fa_reset",
    resourceType: "user",
    resourceId: targetId,
    orgId: target.orgId,
    metadata: { sessionsRevoked: revoked.length },
  });

  return Response.json({ ok: true, sessionsRevoked: revoked.length });
}

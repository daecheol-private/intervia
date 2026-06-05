/**
 * 시스템 관리자가 특정 사용자에게 비밀번호 리셋 메일 강제 발송.
 * 사용 시나리오: 사용자가 비밀번호 분실 + 본인이 reset 요청 못 하는 상황 (예: 메일 못받음)
 *
 * 동작: 기존 토큰 무효화 + 새 토큰 발급 + 메일 발송.
 * 메일 발송 실패는 200으로 응답하되 mailSent=false (UI 가 안내).
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { sendPasswordResetMail } from "@/lib/password-reset";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { extractIp } from "@/lib/auth-attempts";

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
  const targetId = Number(id);
  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      orgId: users.orgId,
    })
    .from(users)
    .where(eq(users.id, targetId));
  if (!target) return new Response("사용자 없음", { status: 404 });

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  let mailSent = true;
  let errorMsg: string | null = null;
  try {
    await sendPasswordResetMail({
      userId: target.id,
      email: target.email,
      name: target.name,
      baseUrl: base,
      requestedIp: extractIp(req),
      orgId: target.orgId,
    });
  } catch (e) {
    mailSent = false;
    errorMsg = (e as Error).message;
    console.error("admin password reset mail failed", e);
  }

  logAudit(req, {
    actor: me,
    action: "user.password_reset_email",
    resourceType: "user",
    resourceId: targetId,
    orgId: target.orgId,
    metadata: {
      targetEmail: target.email,
      mailSent,
      error: errorMsg,
    },
  });

  return Response.json({ mailSent, error: errorMsg });
}

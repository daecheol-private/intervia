import { db } from "@/lib/db";
import { users, sessions } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";
import { consumeResetToken, verifyResetTokenActive } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// 토큰 유효성 사전 확인 (페이지 진입 시 호출). 사용자 식별정보는 노출 X.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return Response.json({ valid: false });
  const r = await verifyResetTokenActive(token);
  return Response.json({ valid: r.valid });
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, "password-reset-confirm", {
    limit: 10,
    windowSec: 60,
  });
  if (limited) return limited;

  const { token, newPassword } = (await req.json().catch(() => ({}))) as {
    token?: string;
    newPassword?: string;
  };
  if (!token || !newPassword)
    return new Response("토큰과 새 비밀번호가 필요합니다.", { status: 400 });

  const pwdCheck = await validatePassword(newPassword);
  if (!pwdCheck.ok)
    return new Response(pwdCheck.errors.join("\n"), { status: 400 });

  const r = await consumeResetToken(token);
  if (!r.ok) return new Response(r.reason ?? "유효하지 않은 토큰", { status: 400 });

  const [user] = await db.select().from(users).where(eq(users.id, r.userId!));
  if (!user) return new Response("사용자 없음", { status: 404 });

  const newHash = await hashPassword(newPassword);
  // 사용자가 직접 새 비밀번호를 정했으므로 강제 변경 플래그도 해제 (부트스트랩 계정 등)
  await db
    .update(users)
    .set({ passwordHash: newHash, mustChangePassword: false })
    .where(eq(users.id, user.id));

  // 보안: 모든 세션 무효화 — 공격자가 이미 로그인 중일 가능성 차단
  await db.delete(sessions).where(eq(sessions.userId, user.id));

  logAudit(req, {
    actorRole: "system",
    orgId: user.orgId,
    action: "password_reset.confirm",
    resourceType: "user",
    resourceId: user.id,
    metadata: { email: user.email },
  });

  return Response.json({ ok: true });
}

import { db } from "@/lib/db";
import { users, sessions } from "@/lib/schema";
import { and, eq, ne } from "drizzle-orm";
import {
  getCurrentUser,
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  deleteSession,
} from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인이 필요합니다.", { status: 401 });

  const limited = await rateLimit(
    req,
    "change-password",
    { limit: 5, windowSec: 60 },
    me.id
  );
  if (limited) return limited;

  const { currentPassword, newPassword } = (await req.json()) as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword)
    return new Response("현재/새 비밀번호 필수", { status: 400 });
  const pwdCheck = await validatePassword(newPassword);
  if (!pwdCheck.ok)
    return new Response(pwdCheck.errors.join("\n"), { status: 400 });
  if (newPassword === currentPassword)
    return new Response("새 비밀번호가 현재와 동일합니다.", { status: 400 });

  const [user] = await db.select().from(users).where(eq(users.id, me.id));
  if (!user) return new Response("사용자 없음", { status: 404 });

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok)
    return new Response("현재 비밀번호가 일치하지 않습니다.", { status: 401 });

  const newHash = await hashPassword(newPassword);
  await db
    .update(users)
    // 변경 완료 시 강제 변경 플래그 해제 (부트스트랩 임시 비번 계정 등).
    .set({ passwordHash: newHash, mustChangePassword: false })
    .where(eq(users.id, me.id));

  // 비밀번호 변경 = 탈취된 세션 차단 기대. 다른 모든 기기 세션을 무효화하고
  // 현재 세션 토큰도 회전 (password-reset/confirm 과 동일 수준).
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, me.id), ne(sessions.token, me.sessionToken)));
  await deleteSession(me.sessionToken);
  const newToken = await createSession(me.id, {
    userAgent: req.headers.get("user-agent"),
  });
  await setSessionCookie(newToken);

  return new Response(null, { status: 204 });
}

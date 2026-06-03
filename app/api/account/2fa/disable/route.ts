import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { verifyAndConsumeTotp } from "@/lib/totp-verify";
import { decrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });

  const limited = await rateLimit(req, "2fa-disable", { limit: 5, windowSec: 60 }, me.id);
  if (limited) return limited;

  const { password, code } = (await req.json().catch(() => ({}))) as {
    password?: string;
    code?: string;
  };
  if (!password || !code)
    return new Response("비밀번호와 인증 코드가 필요합니다.", { status: 400 });

  const [u] = await db.select().from(users).where(eq(users.id, me.id));
  if (!u) return new Response("사용자 없음", { status: 404 });
  if (!u.totpEnabledAt || !u.totpSecret)
    return new Response("2단계 인증이 활성화되어 있지 않습니다.", { status: 400 });

  if (!(await verifyPassword(password, u.passwordHash)))
    return new Response("비밀번호가 일치하지 않습니다.", { status: 401 });
  if (!(await verifyAndConsumeTotp(me.id, decrypt(u.totpSecret), code)))
    return new Response("인증 코드가 올바르지 않습니다.", { status: 401 });

  await db
    .update(users)
    .set({ totpSecret: null, totpEnabledAt: null })
    .where(eq(users.id, me.id));

  logAudit(req, {
    actor: me,
    action: "2fa.disable",
    resourceType: "user",
    resourceId: me.id,
  });

  return Response.json({ ok: true });
}

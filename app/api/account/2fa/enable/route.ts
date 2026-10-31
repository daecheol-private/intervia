import { db } from "@/lib/db";
import { users, sessions } from "@/lib/schema";
import { and, eq, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { verifyAndConsumeTotp } from "@/lib/totp-verify";
import { encrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { requireStepUp } from "@/lib/step-up";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });

  const limited = await rateLimit(req, "2fa-enable", { limit: 10, windowSec: 60 }, me.id);
  if (limited) return limited;

  // 세션만 훔친 사람이 2단계 인증을 걸어 주인을 잠그지 못하게 — 비밀번호 재확인.
  const stepUp = await requireStepUp();
  if (stepUp) return stepUp;

  const { secret, code } = (await req.json().catch(() => ({}))) as {
    secret?: string;
    code?: string;
  };
  if (!secret || !code)
    return new Response("secret 과 code 필수", { status: 400 });

  if (!(await verifyAndConsumeTotp(me.id, secret, code)))
    return new Response("코드가 올바르지 않습니다. Authenticator 앱 시간이 동기화되어 있는지 확인하세요.", {
      status: 400,
    });

  const [existing] = await db
    .select({ enabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, me.id));
  if (existing?.enabledAt)
    return new Response("이미 2단계 인증이 활성화되어 있습니다.", { status: 400 });

  await db
    .update(users)
    .set({
      totpSecret: encrypt(secret),
      totpEnabledAt: new Date().toISOString(),
    })
    .where(eq(users.id, me.id));

  // 다른 기기 세션은 끊는다 — 탈취된 세션이 남아 있지 않게.
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, me.id), ne(sessions.token, me.sessionToken)));

  logAudit(req, {
    actor: me,
    action: "2fa.enable",
    resourceType: "user",
    resourceId: me.id,
  });

  return Response.json({ ok: true });
}

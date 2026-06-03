import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { verifyAndConsumeTotp } from "@/lib/totp-verify";
import { encrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });

  const limited = await rateLimit(req, "2fa-enable", { limit: 10, windowSec: 60 }, me.id);
  if (limited) return limited;

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

  logAudit(req, {
    actor: me,
    action: "2fa.enable",
    resourceType: "user",
    resourceId: me.id,
  });

  return Response.json({ ok: true });
}

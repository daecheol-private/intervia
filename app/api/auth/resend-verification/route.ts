import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { normalizeEmail, isValidEmail } from "@/lib/email-domain";
import { sendVerificationMail } from "@/lib/email-verify";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await rateLimit(req, "resend-verification", {
    limit: 3,
    windowSec: 60,
  });
  if (limited) return limited;

  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !isValidEmail(email))
    return new Response("올바른 이메일이 아닙니다.", { status: 400 });
  const normalized = normalizeEmail(email);
  const [user] = await db.select().from(users).where(eq(users.email, normalized));
  // 사용자 존재 여부 노출 방지: 항상 성공 응답
  if (!user || user.emailVerifiedAt) return Response.json({ ok: true });

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  try {
    await sendVerificationMail({
      userId: user.id,
      email: user.email,
      name: user.name,
      baseUrl: base,
    });
  } catch (e) {
    console.error("resend verification failed", e);
    return new Response("발송 실패", { status: 500 });
  }
  return Response.json({ ok: true });
}

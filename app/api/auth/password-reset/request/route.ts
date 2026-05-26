import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { normalizeEmail, isValidEmail } from "@/lib/email-domain";
import { sendPasswordResetMail } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { extractIp } from "@/lib/auth-attempts";
import { isSmtpAvailable } from "@/lib/mailer";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // IP 기준 3분당 3회 — 이메일 enumeration·메일폭탄 차단
  const limited = await rateLimit(req, "password-reset", {
    limit: 3,
    windowSec: 180,
  });
  if (limited) return limited;

  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !isValidEmail(email))
    return new Response("올바른 이메일이 아닙니다.", { status: 400 });

  const normalized = normalizeEmail(email);
  const [user] = await db.select().from(users).where(eq(users.email, normalized));

  // 사용자 존재 여부 노출 방지: 항상 성공 응답.
  // 실제 발송은 사용자 있고 active 상태일 때만.
  if (user && user.status === "active") {
    const smtpOk = await isSmtpAvailable(user.orgId);
    if (smtpOk) {
      const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
      try {
        await sendPasswordResetMail({
          userId: user.id,
          email: user.email,
          name: user.name,
          baseUrl: base,
          requestedIp: extractIp(req),
          orgId: user.orgId,
        });
        logAudit(req, {
          actorRole: "system",
          orgId: user.orgId,
          action: "password_reset.request",
          resourceType: "user",
          resourceId: user.id,
          metadata: { email: user.email },
        });
      } catch (e) {
        console.error("password reset send failed", e);
        // SMTP 실패해도 응답은 동일 — 정보 노출 방지
      }
    }
  }

  return Response.json({ ok: true });
}

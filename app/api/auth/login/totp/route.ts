import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { createSession, setSessionCookie } from "@/lib/auth";
import { verifyLoginChallenge } from "@/lib/login-challenge";
import { verifyAndConsumeTotp } from "@/lib/totp-verify";
import { decrypt } from "@/lib/crypto";
import { recordAttempt, extractIp } from "@/lib/auth-attempts";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // 챌린지 보유자라도 TOTP 무차별 대입은 차단
  const limited = await rateLimit(req, "login-totp", {
    limit: 10,
    windowSec: 60,
  });
  if (limited) return limited;

  const { challenge, code } = (await req.json().catch(() => ({}))) as {
    challenge?: string;
    code?: string;
  };
  if (!challenge || !code)
    return new Response("challenge 와 code 필수", { status: 400 });

  const cv = verifyLoginChallenge(challenge);
  if (!cv.ok)
    return Response.json(
      { error: "세션이 만료되었습니다. 다시 로그인해 주세요.", code: "challenge_invalid" },
      { status: 401 }
    );

  // H7 — challenge 가 stateless HMAC 이라 무차별 대입을 IP rate-limit (10/분) 만으로 막기 부족.
  // 사용자 단위로 분당 5회 추가 제한 — IP 분산 공격도 차단. 잠금되면 비번부터 다시 입력 강제.
  const userLimited = await rateLimit(
    req,
    "login-totp-user",
    { limit: 5, windowSec: 60 },
    cv.userId
  );
  if (userLimited) return userLimited;

  const [user] = await db.select().from(users).where(eq(users.id, cv.userId));
  if (!user || !user.totpSecret || !user.totpEnabledAt)
    return new Response("2단계 인증이 활성화되어 있지 않습니다.", {
      status: 400,
    });

  const secret = decrypt(user.totpSecret);
  const ok = await verifyAndConsumeTotp(user.id, secret, code);
  const ip = extractIp(req);
  const userAgent = req.headers.get("user-agent");

  if (!ok) {
    await recordAttempt({
      email: user.email,
      ip,
      success: false,
      userAgent,
    });
    return new Response("코드가 올바르지 않습니다.", { status: 401 });
  }

  await recordAttempt({
    email: user.email,
    ip,
    success: true,
    userAgent,
  });

  const token = await createSession(user.id, { ip, userAgent });
  await setSessionCookie(token);

  logAudit(req, {
    actor: {
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: !!user.isAdmin || user.role === "system_admin",
      orgId: user.orgId,
      role: user.role,
      status: user.status,
      mustChangePassword: !!user.mustChangePassword,
      sessionToken: token,
    },
    action: "login.success",
    resourceType: "user",
    resourceId: user.id,
    metadata: { mfa: "totp" },
  });

  return Response.json({ id: user.id, email: user.email, name: user.name });
}

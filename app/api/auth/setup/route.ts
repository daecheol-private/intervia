import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import {
  hasAnyUser,
  hashPassword,
  createSession,
  setSessionCookie,
} from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";
import { extractIp } from "@/lib/auth-attempts";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await rateLimit(req, "setup", { limit: 5, windowSec: 60 });
  if (limited) return limited;

  if (await hasAnyUser())
    return new Response("이미 관리자 계정이 존재합니다.", { status: 409 });

  const { email, password, name } = (await req.json()) as {
    email?: string;
    password?: string;
    name?: string;
  };

  if (!email || !password || !name)
    return new Response("이름/이메일/비밀번호 필수", { status: 400 });
  const pwdCheck = await validatePassword(password);
  if (!pwdCheck.ok)
    return new Response(pwdCheck.errors.join("\n"), { status: 400 });

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name.trim(),
    })
    .returning();

  const token = await createSession(user.id, {
    ip: extractIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  await setSessionCookie(token);

  return Response.json({ id: user.id, email: user.email, name: user.name });
}

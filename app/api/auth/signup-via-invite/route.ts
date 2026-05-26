/**
 * 초대 링크를 통한 신규 가입 — 기존 법인에 합류 요청 없이 즉시 active 멤버로 등록.
 *
 * 일반 가입(`/api/orgs`) 은 신규 법인 생성용. 합류 요청(`/api/orgs/join-requests`) 은 승인 대기.
 * 이 엔드포인트는 초대 토큰 검증 후 자동 합류.
 *
 * 이메일은 초대장 이메일로 고정. 가입과 동시에 email_verified_at 채움 (메일 링크 통해 들어왔으므로).
 */
import { db } from "@/lib/db";
import { users, orgInvites, jobInterviewers } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hashPassword, createSession, setSessionCookie } from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";
import { rateLimit } from "@/lib/rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/email-domain";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/site-info";
import { logAudit } from "@/lib/audit";
import { extractIp } from "@/lib/auth-attempts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await rateLimit(req, "signup", { limit: 5, windowSec: 60 });
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    password?: string;
    name?: string;
    acceptTerms?: boolean;
    acceptPrivacy?: boolean;
    ageOver14?: boolean;
  };

  const token = body.token?.trim();
  const password = body.password ?? "";
  const userName = body.name?.trim();

  if (!token || !password || !userName)
    return new Response("token/이름/비밀번호 필수", { status: 400 });
  if (body.acceptTerms !== true || body.acceptPrivacy !== true)
    return new Response(
      "이용약관 및 개인정보 처리방침에 동의해야 가입할 수 있습니다.",
      { status: 400 }
    );
  if (body.ageOver14 !== true)
    return new Response(
      "본 서비스는 만 14세 이상만 가입할 수 있습니다 (PIPA §22의2).",
      { status: 400 }
    );

  const [inv] = await db
    .select()
    .from(orgInvites)
    .where(eq(orgInvites.token, token));
  if (!inv) return new Response("유효하지 않은 초대 링크입니다.", { status: 404 });
  if (inv.usedAt)
    return new Response("이미 사용된 초대 링크입니다.", { status: 410 });
  if (new Date(inv.expiresAt) < new Date())
    return new Response("만료된 초대 링크입니다.", { status: 410 });

  const email = normalizeEmail(inv.email);
  if (!isValidEmail(email))
    return new Response("초대장 이메일이 잘못되었습니다.", { status: 400 });

  const pwdCheck = await validatePassword(password);
  if (!pwdCheck.ok)
    return new Response(pwdCheck.errors.join("\n"), { status: 400 });

  // 이미 가입된 이메일 — 가입 대신 로그인하라고 안내
  const [dupUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (dupUser)
    return new Response(
      "이미 가입된 이메일입니다. 로그인 후 초대 링크를 다시 클릭하세요.",
      { status: 409 }
    );

  const passwordHash = await hashPassword(password);
  const nowIso = new Date().toISOString();
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      name: userName,
      role: "member",
      orgId: inv.orgId,
      status: "active",
      emailVerifiedAt: nowIso,
      termsAcceptedAt: nowIso,
      termsVersion: TERMS_VERSION,
      termsAcceptedIp: extractIp(req),
      termsAcceptedUa: req.headers.get("user-agent")?.slice(0, 500) ?? null,
      privacyAcceptedAt: nowIso,
      privacyVersion: PRIVACY_VERSION,
      privacyAcceptedIp: extractIp(req),
      privacyAcceptedUa: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    })
    .returning();

  // 초대 토큰 consume
  await db
    .update(orgInvites)
    .set({ usedAt: nowIso, usedByUserId: user.id })
    .where(eq(orgInvites.id, inv.id));

  // 초대 발급된 공고가 있으면 면접관 자동 추가
  if (inv.jobId) {
    await db
      .insert(jobInterviewers)
      .values({
        jobId: inv.jobId,
        userId: user.id,
        assignedByUserId: inv.invitedByUserId,
      })
      .onConflictDoNothing();
  }

  // 세션 생성 + 쿠키 발급
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent")?.slice(0, 500) ?? null;
  const sessionToken = await createSession(user.id, { ip, userAgent: ua });
  await setSessionCookie(sessionToken);

  logAudit(req, {
    actor: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: "member",
      orgId: user.orgId,
      isAdmin: false,
      status: "active",
      sessionToken,
    },
    action: "user.status_change" as const,
    resourceType: "user" as const,
    resourceId: user.id,
    orgId: user.orgId,
    metadata: { kind: "signup_via_invite", inviteId: inv.id, jobId: inv.jobId },
  });

  return Response.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    orgId: inv.orgId,
    jobId: inv.jobId,
    sessionToken,
  });
}

/**
 * 초대 링크를 통한 신규 가입 — 합류 요청(pending) 생성 + 법인담당자 승인 대기.
 *
 * 정책(2026-06-08 변경): 공고 공유는 일반 멤버도 할 수 있으므로, 초대 링크로 들어온
 * 신규 가입자도 **법인담당자 승인을 반드시 거친다**. 승인 시점에 공유 초대(orgInvites)가
 * honor 되어 해당 공고 면접관으로 자동 등록된다(→ 공고 PIN 없이 후보자·평가 확인 가능,
 * `app/api/orgs/join-requests/[id]/route.ts` PATCH 참조).
 * 따라서 여기서는 즉시 active·세션 발급·면접관 등록을 하지 않는다.
 *
 * 이메일은 초대장 이메일로 고정. 초대 링크 클릭 자체가 메일함 소유 증명이므로
 * email_verified_at 을 채운다(별도 인증 메일 불필요). 초대 토큰은 consume 하지 않는다 —
 * 승인 핸들러가 미사용 초대를 조회해 면접관 등록 + consume 한다.
 */
import { after } from "next/server";
import { db } from "@/lib/db";
import { users, orgInvites, orgJoinRequests } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";
import { rateLimit } from "@/lib/rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/email-domain";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/site-info";
import { extractIp } from "@/lib/auth-attempts";
import { notifyOrgAdmins } from "@/lib/notifications";

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
      // 승인 전까지 pending — 세션도 발급하지 않는다(로그인 게이트가 pending 차단).
      status: "pending",
      // 초대 링크 클릭 = 메일함 소유 증명 → 가입 시점에 인증 완료 처리.
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

  // 합류 요청 생성 — 법인담당자가 승인하면 active + 공유 공고 면접관 자동 등록.
  // 초대 토큰은 일부러 consume 하지 않음(승인 시 honor 됨).
  await db.insert(orgJoinRequests).values({
    orgId: inv.orgId,
    userId: user.id,
    status: "pending",
  });

  // 승인해야만 신규 직원이 입장 가능 — 매일 로그인 안 하는 관리자도 메일로 인지.
  // (자가 합류요청 경로 orgs/join-requests 와 동일하게 email:true)
  // after() — 응답 반환 후 실행 보장. void fire-and-forget 은 서버리스 suspend 로 유실됨.
  after(() =>
    notifyOrgAdmins(
      inv.orgId,
      {
        type: "join_request",
        title: `${userName} (${email}) 님이 공고 공유로 합류를 요청했습니다`,
        href: "/org/members",
        payload: { userId: user.id, orgId: inv.orgId, jobId: inv.jobId },
      },
      { email: true }
    ).catch((e) => console.error("[signup-via-invite] 법인 담당자 통지 실패:", e))
  );

  return Response.json({
    ok: true,
    status: "pending",
    orgId: inv.orgId,
    jobId: inv.jobId,
  });
}

import { db } from "@/lib/db";
import { users, organizations, orgJoinRequests } from "@/lib/schema";
import { and, eq, desc } from "drizzle-orm";
import { hashPassword, getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import {
  isValidEmail,
  normalizeEmail,
} from "@/lib/email-domain";
import { validatePassword } from "@/lib/password-policy";
import { rateLimit } from "@/lib/rate-limit";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/site-info";
import { extractIp } from "@/lib/auth-attempts";
import { notifyOrgAdmins } from "@/lib/notifications";

export const runtime = "nodejs";

// 비로그인 사용자: 합류 요청 + 사용자 row 생성 (status=pending)
export async function POST(req: Request) {
  const limited = await rateLimit(req, "signup", { limit: 5, windowSec: 60 });
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    orgId?: number;
    email?: string;
    password?: string;
    name?: string;
    acceptTerms?: boolean;
    acceptPrivacy?: boolean;
    ageOver14?: boolean;
  };
  const orgId = Number(body.orgId);
  const email = body.email?.trim();
  const password = body.password ?? "";
  const name = body.name?.trim();

  if (!orgId || !email || !password || !name)
    return new Response("법인/이름/이메일/비밀번호 필수", { status: 400 });
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
  if (!isValidEmail(email))
    return new Response("올바른 이메일 형식이 아닙니다.", { status: 400 });
  const pwdCheck = await validatePassword(password);
  if (!pwdCheck.ok)
    return new Response(pwdCheck.errors.join("\n"), { status: 400 });

  const [org] = await db
    .select({
      id: organizations.id,
      verificationStatus: organizations.verificationStatus,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인을 찾을 수 없습니다.", { status: 404 });
  if (
    org.verificationStatus === "pending_review" ||
    org.verificationStatus === "rejected"
  ) {
    return new Response(
      "이 법인은 운영자 검증이 완료되지 않았습니다. 검증 완료 후 합류 요청을 다시 보내주세요. (사칭 방지 게이트)",
      { status: 403 }
    );
  }

  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  // 합류 요청은 별도 이메일 인증 불요 — 법인 관리자의 승인이 본인확인 역할을 함.
  // (신규 법인 생성은 인증 메일 필요. 거기에는 검토할 사람이 없으므로.)
  // 사전 UI 단계에서 이미 이메일 중복은 검증됨 — DB UNIQUE 충돌만 안전하게 처리.
  let user;
  try {
    [user] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash,
        name,
        role: "member",
        orgId,
        status: "pending",
        // 법인 관리자 승인 시점에 검증된 것으로 처리할 예정 — 지금은 null.
        termsAcceptedAt: now,
        termsVersion: TERMS_VERSION,
        termsAcceptedIp: extractIp(req),
        termsAcceptedUa: req.headers.get("user-agent")?.slice(0, 500) ?? null,
        privacyAcceptedAt: now,
        privacyVersion: PRIVACY_VERSION,
        privacyAcceptedIp: extractIp(req),
        privacyAcceptedUa: req.headers.get("user-agent")?.slice(0, 500) ?? null,
      })
      .returning();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|unique constraint/i.test(msg))
      return new Response(
        "이미 가입된 이메일입니다. 로그인해 주세요.",
        { status: 409 }
      );
    throw e;
  }

  await db.insert(orgJoinRequests).values({
    orgId,
    userId: user.id,
    status: "pending",
  });

  void notifyOrgAdmins(orgId, {
    type: "join_request",
    title: `${name} (${normalizedEmail}) 님이 합류를 요청했습니다`,
    href: "/org/join-requests",
    payload: { userId: user.id, orgId },
  });

  return Response.json({
    ok: true,
    status: "pending",
    // mailSent 필드는 호환성을 위해 유지하되 항상 true (인증 메일 발송 단계가 없음).
    mailSent: true,
  });
}

// org_admin / system_admin: 자기 법인 합류 요청 목록
export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member")
    return new Response("권한 없음", { status: 403 });

  const url = new URL(req.url);
  const orgIdParam = url.searchParams.get("orgId");
  const statusParam = url.searchParams.get("status") ?? "pending";

  let targetOrgId: number | null = null;
  if (orgIdParam) {
    targetOrgId = Number(orgIdParam);
    if (!ownsOrg(me!, targetOrgId))
      return new Response("권한 없음", { status: 403 });
  } else {
    if (me!.role !== "system_admin") targetOrgId = me!.orgId;
  }

  const where = targetOrgId
    ? and(
        eq(orgJoinRequests.orgId, targetOrgId),
        eq(orgJoinRequests.status, statusParam as "pending" | "approved" | "rejected")
      )
    : eq(orgJoinRequests.status, statusParam as "pending" | "approved" | "rejected");

  const rows = await db
    .select({
      id: orgJoinRequests.id,
      orgId: orgJoinRequests.orgId,
      userId: orgJoinRequests.userId,
      status: orgJoinRequests.status,
      createdAt: orgJoinRequests.createdAt,
      decidedAt: orgJoinRequests.decidedAt,
      userEmail: users.email,
      userName: users.name,
      orgName: organizations.name,
    })
    .from(orgJoinRequests)
    .innerJoin(users, eq(users.id, orgJoinRequests.userId))
    .innerJoin(organizations, eq(organizations.id, orgJoinRequests.orgId))
    .where(where)
    .orderBy(desc(orgJoinRequests.createdAt));

  return Response.json(rows);
}

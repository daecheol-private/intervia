import { db } from "@/lib/db";
import { users, organizations, tokenWallets } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { sendVerificationMail } from "@/lib/email-verify";
import { notifySystemAdmins } from "@/lib/notifications";
import { validatePassword } from "@/lib/password-policy";
import { rateLimit } from "@/lib/rate-limit";
import {
  getEmailDomain,
  isPublicDomain,
  isValidEmail,
  normalizeEmail,
} from "@/lib/email-domain";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/site-info";
import { extractIp } from "@/lib/auth-attempts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await rateLimit(req, "signup", { limit: 5, windowSec: 60 });
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    orgName?: string;
    bizRegistrationNo?: string;
    emailDomain?: string;
    email?: string;
    password?: string;
    name?: string;
    acceptTerms?: boolean;
    acceptPrivacy?: boolean;
    ageOver14?: boolean;
  };

  const orgName = body.orgName?.trim();
  const email = body.email?.trim();
  const password = body.password ?? "";
  const userName = body.name?.trim();

  if (!orgName || !email || !password || !userName)
    return new Response("법인명/이름/이메일/비밀번호 필수", { status: 400 });
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

  const normalizedEmail = normalizeEmail(email);
  const [dupUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail));
  if (dupUser) return new Response("이미 가입된 이메일입니다.", { status: 409 });

  const detectedDomain = getEmailDomain(normalizedEmail);
  const requestedDomain = body.emailDomain?.toLowerCase().trim() || null;
  // 공용 도메인이면 emailDomain 저장 X (자동매칭 방지). 사용자가 명시한 도메인 우선.
  let emailDomain: string | null = null;
  if (requestedDomain && !isPublicDomain(requestedDomain)) {
    emailDomain = requestedDomain;
  } else if (detectedDomain && !isPublicDomain(detectedDomain)) {
    emailDomain = detectedDomain;
  }

  // emailDomain 은 1:N 허용 (SaaS 메일 공유 케이스). 사칭 방지는 사업자번호·DART·운영자 검증 게이트에서.
  // 단, 같은 도메인에 검증된 법인(dart_matched·verified)이 이미 있으면 사용자에게 알릴 수
  // 있도록 — 현재는 그냥 진행하고, check-email 단계에서 멀티 매칭 UI 가 안내.

  // 사업자번호 — 정규화 후 같은 번호로 이미 등록된 법인 있으면 차단.
  // 공용도메인(gmail/naver/...) 으로 등록하는 경우는 도메인 기반 검증이 불가하므로
  // 사업자번호를 **필수** 로 강제 (법인 사칭 방지 — PIPA·이용약관 §5 사전 보호).
  const { normalizeBizNo, formatBizNo } = await import("@/lib/business-registry");
  const { findDartCorpByBizno } = await import("@/lib/dart-corps");
  let canonicalBizNo: string | null = null;
  const isPublicDomainSignup = emailDomain == null;
  if (!body.bizRegistrationNo && isPublicDomainSignup) {
    return new Response(
      "공용 이메일 도메인(gmail / naver 등) 으로 법인을 등록할 때는 사업자등록번호가 필수입니다. 사업자번호 없이 가입하려면 회사 도메인 이메일을 사용해주세요.",
      { status: 400 }
    );
  }
  if (body.bizRegistrationNo) {
    const norm = normalizeBizNo(body.bizRegistrationNo);
    if (!norm)
      return new Response("사업자번호는 10자리 숫자여야 합니다.", { status: 400 });
    canonicalBizNo = formatBizNo(norm);
    const [bizTaken] = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.bizRegistrationNo, canonicalBizNo));
    if (bizTaken)
      return new Response(
        `사업자번호 ${canonicalBizNo} 는 이미 '${bizTaken.name}' 법인으로 등록되어 있습니다. 검색하여 합류 요청을 보내거나, 운영자에게 권한 부여를 요청하세요.`,
        { status: 409 }
      );
  }

  // 검증 상태 결정:
  //  - DART 매칭 됨 → dart_matched (자동 검증)
  //  - DART 미매칭이나 사업자번호 있음 → pending_review (운영자 수동 검토 대기)
  //  - 회사 도메인 이메일 사용 + 사업자번호 없음 → pending_review
  //  - (공용도메인 + 사업자번호 없음은 이미 위에서 400 차단)
  let verificationStatus: "dart_matched" | "pending_review" = "pending_review";
  let verifiedAt: string | null = null;
  let verificationNote: string | null = null;
  if (canonicalBizNo) {
    const dartHit = findDartCorpByBizno(canonicalBizNo);
    if (dartHit) {
      verificationStatus = "dart_matched";
      verifiedAt = new Date().toISOString();
      verificationNote = `DART 등록 법인 자동 매칭: ${dartHit.name}`;
    }
  }

  const [org] = await db
    .insert(organizations)
    .values({
      name: orgName,
      bizRegistrationNo: canonicalBizNo,
      emailDomain,
      verificationStatus,
      verifiedAt,
      verificationNote,
    })
    .returning();

  // 검토 대기 상태면 시스템 관리자 알림
  if (verificationStatus === "pending_review") {
    const { notifySystemAdmins } = await import("@/lib/notifications");
    void notifySystemAdmins({
      type: "new_org",
      title: `신규 법인 등록 — '${orgName}' 검증 대기 (사업자번호: ${canonicalBizNo ?? "없음"})`,
      href: "/admin/orgs",
      payload: { orgId: org.id, orgName, bizno: canonicalBizNo },
    });
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const bootstrapAdmin = process.env.SYSTEM_ADMIN_EMAIL?.toLowerCase().trim();
  const role =
    bootstrapAdmin && bootstrapAdmin === normalizedEmail
      ? "system_admin"
      : "org_admin";
  const [user] = await db
    .insert(users)
    .values({
      email: normalizedEmail,
      passwordHash,
      name: userName,
      role,
      orgId: org.id,
      status: "active",
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

  await db
    .update(organizations)
    .set({ createdByUserId: user.id })
    .where(eq(organizations.id, org.id));

  await db.insert(tokenWallets).values({ orgId: org.id, balance: 0 });

  // 신규 가입 무료 체험 토큰 — ledger 통해 지급 (잔액·내역 동기 보장)
  const { grantWelcomeBonus } = await import("@/lib/tokens");
  await grantWelcomeBonus(org.id, user.id);

  void notifySystemAdmins({
    type: "new_org",
    title: `신규 법인 "${org.name}" 이(가) 등록되었습니다 (대표: ${user.name})`,
    href: `/admin/orgs/${org.id}`,
    payload: { orgId: org.id, userId: user.id },
  });

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  let mailSent = true;
  try {
    await sendVerificationMail({
      userId: user.id,
      email: user.email,
      name: user.name,
      baseUrl: base,
    });
  } catch (e) {
    console.error("verification mail failed", e);
    mailSent = false;
  }

  return Response.json({
    org: { id: org.id, name: org.name },
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    verificationRequired: true,
    mailSent,
  });
}

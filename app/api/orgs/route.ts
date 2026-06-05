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

  // 회사(법인) 도메인 이메일만 가입 가능 — gmail/naver 등 공용 이메일은 차단.
  // 도메인 메일함 통제(이메일 인증)가 법인 소속의 증명이 되므로 사업자번호 없이도
  // 신뢰 가능. 공용메일 선점으로 인한 도메인 매핑 사각지대를 원천 제거한다.
  const detectedDomain = getEmailDomain(normalizedEmail);
  if (!detectedDomain || isPublicDomain(detectedDomain)) {
    return new Response(
      "회사(법인) 이메일로만 가입할 수 있습니다. gmail · naver 등 공용 이메일은 사용할 수 없습니다. 회사 도메인 이메일(you@회사.com)로 가입해 주세요.",
      { status: 400 }
    );
  }
  const emailDomain: string = detectedDomain;

  // 사업자번호 — 가입 시 **선택**(세금계산서 등 필요 시 추후 법인 설정에서 입력).
  // 입력된 경우에만: 정규화 → 중복 차단 → (DART 매칭 시) 자동 검증 격상.
  const {
    normalizeBizNo,
    formatBizNo,
    isBusinessRegistryConfigured,
    lookupBusinessStatus,
  } = await import("@/lib/business-registry");
  const { findDartCorpByBizno } = await import("@/lib/dart-corps");
  let canonicalBizNo: string | null = null;
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

    // 국세청 진위확인 — 실제 등록 + 영업중(계속사업자)인지 검증.
    // API 키 미설정이면 검증 불가 → 그냥 통과 (사업자번호는 선택 입력값이므로).
    // 외부 API 장애(throw)도 가입을 막지 않음 — 일시 장애로 가입을 차단하지 않기 위함.
    if (isBusinessRegistryConfigured()) {
      try {
        const status = await lookupBusinessStatus(norm);
        if (!status || !status.registered) {
          return new Response(
            `사업자번호 ${canonicalBizNo} 는 국세청에 등록되지 않은 번호입니다. 실제 사업자등록번호를 입력하거나, 사업자번호 없이 회사 도메인 이메일로 가입해주세요.`,
            { status: 400 }
          );
        }
        if (!status.active) {
          return new Response(
            `사업자번호 ${canonicalBizNo} 는 영업중이 아닙니다 (상태: ${status.status}). 영업중인 사업자만 등록할 수 있습니다.`,
            { status: 400 }
          );
        }
      } catch (e) {
        console.error("business registry lookup failed (skipping check)", e);
      }
    }
  }

  // 검증 상태 결정 — 회사 도메인 이메일만 가입 가능하므로 도메인 통제가 곧 소속 증명.
  //  - 기본: verified (도메인 이메일 인증 기반 자동 검증) → 같은 도메인 동료가 바로 합류 가능
  //  - 사업자번호가 DART 등록 법인과 매칭 → dart_matched 로 격상
  let verificationStatus: "dart_matched" | "verified" = "verified";
  let verifiedAt: string | null = new Date().toISOString();
  let verificationNote: string | null = `회사 도메인 이메일 인증 (자동): ${emailDomain}`;
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

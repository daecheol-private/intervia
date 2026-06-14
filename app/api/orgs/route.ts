import { db } from "@/lib/db";
import { users, organizations, tokenWallets } from "@/lib/schema";
import { eq, and, ne } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { sendVerificationMail } from "@/lib/email-verify";
import { notifySystemAdmins, notifyOrgAdmins } from "@/lib/notifications";
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
  // 국세청 "계속사업자"(영업중) 확인 여부 — 같은 도메인 2번째+ 법인의 자동검증 게이트에 사용.
  let bizVerifiedActive = false;
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
        bizVerifiedActive = true; // 국세청 등록 + 영업중 확인됨
      } catch (e) {
        console.error("business registry lookup failed (skipping check)", e);
      }
    }
  }

  const now = new Date().toISOString();

  // 같은 도메인을 이미 쓰는(비-rejected) 법인이 있는지 — 멀티법인/공유 도메인 케이스.
  // 도메인 첫 법인은 도메인 이메일 인증만으로 자동 검증하지만, 2번째+ 법인은
  // 섀도우 법인(타 회사 도메인 위 사칭) 방지를 위해 사업자번호 검증을 요구한다.
  const existingOnDomain = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.emailDomain, emailDomain),
        ne(organizations.verificationStatus, "rejected")
      )
    );
  const domainTaken = existingOnDomain.length > 0;

  // 검증 상태 결정.
  //  - DART 매칭: 항상 dart_matched (상장·외감법인)
  //  - 도메인 첫 법인: verified (도메인 이메일 인증 기반 자동 검증)
  //  - 도메인 2번째+ 법인: 국세청 영업중 확인된 별개 사업자번호면 verified, 아니면 pending_review(운영자 검토)
  const dartHit = canonicalBizNo ? findDartCorpByBizno(canonicalBizNo) : null;
  let verificationStatus: "dart_matched" | "verified" | "pending_review";
  let verifiedAt: string | null;
  let verificationNote: string | null;
  if (dartHit) {
    verificationStatus = "dart_matched";
    verifiedAt = now;
    verificationNote =
      orgName !== dartHit.name
        ? `DART 등록 법인 자동 매칭: ${dartHit.name} (사용자 입력 '${orgName}' → 공식명으로 교체)`
        : `DART 등록 법인 자동 매칭: ${dartHit.name}`;
  } else if (!domainTaken) {
    verificationStatus = "verified";
    verifiedAt = now;
    verificationNote = `회사 도메인 이메일 인증 (자동): ${emailDomain}`;
  } else if (canonicalBizNo && bizVerifiedActive) {
    verificationStatus = "verified";
    verifiedAt = now;
    verificationNote = `국세청 영업중 확인 + 별개 사업자번호 (공유 도메인 ${emailDomain})`;
  } else {
    // 같은 도메인에 기존 법인이 있는데 사업자번호로 별개 법인임을 입증 못함 → 운영자 검토 게이트.
    // pending_review 동안: 타인 합류 차단(join-requests 게이트) + "검토 대기" 배지 + 웰컴토큰 보류.
    verificationStatus = "pending_review";
    verifiedAt = null;
    verificationNote = `같은 도메인(${emailDomain})에 기존 법인 존재 + 사업자번호 미검증 → 운영자 검토 대기`;
  }

  // DART 매칭 시 공식 법인명을 강제 — 조회로 자동채움 후 사용자가 다른 이름으로
  // 바꿔 제출해도 확실한(검증된) 법인명으로 저장 (번호↔이름 불일치 방지).
  const finalOrgName = dartHit ? dartHit.name : orgName;
  const [org] = await db
    .insert(organizations)
    .values({
      name: finalOrgName,
      bizRegistrationNo: canonicalBizNo,
      emailDomain,
      verificationStatus,
      verifiedAt,
      verificationNote,
    })
    .returning();

  const passwordHash = await hashPassword(password);
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

  // 신규 가입 무료 체험 토큰 — ledger 통해 지급 (잔액·내역 동기 보장).
  // 단 pending_review(검토 대기) 법인은 보류 — 웰컴토큰 파밍/섀도우 법인 방지.
  // 운영자 승인(admin/orgs/[id]/verify) 시점에 지급한다.
  if (verificationStatus !== "pending_review") {
    const { grantWelcomeBonus } = await import("@/lib/tokens");
    await grantWelcomeBonus(org.id, user.id);
  }

  void notifySystemAdmins({
    type: "new_org",
    title: `신규 법인 "${org.name}" 이(가) 등록되었습니다 (대표: ${user.name})`,
    href: "/admin/orgs",
    payload: { orgId: org.id, userId: user.id },
  });

  // 같은 도메인에 기존 법인이 있으면 그 법인 담당자들에게 통지 — 관계사 여부 교차확인(섀도우 법인 백스톱).
  // 자동검증(verified)으로 통과한 경우에도, 남의 공개 사업자번호를 도용한 사칭을 사람이 잡도록 한다.
  if (domainTaken) {
    for (const existing of existingOnDomain) {
      void notifyOrgAdmins(
        existing.id,
        {
          type: "new_org",
          title: `같은 도메인(${emailDomain})에 새 법인 "${org.name}"이(가) 등록되었습니다 — 아는 관계사인지 확인해 주세요`,
          href: "/org/members",
          payload: { newOrgId: org.id, domain: emailDomain },
        },
        { email: true }
      );
    }
  }

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

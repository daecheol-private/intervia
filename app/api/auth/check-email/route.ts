import { db } from "@/lib/db";
import { users, organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  getEmailDomain,
  isPublicDomain,
  isValidEmail,
  maskBizNo,
  normalizeEmail,
} from "@/lib/email-domain";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // 인증 전 계정·법인·담당자 정찰 차단 — IP 기준 분당 10회.
  const limited = await rateLimit(req, "check-email", { limit: 10, windowSec: 60 });
  if (limited) return limited;

  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email) return new Response("email 필수", { status: 400 });
  if (!isValidEmail(email))
    return new Response("올바른 이메일 형식이 아닙니다.", { status: 400 });

  const normalized = normalizeEmail(email);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized));
  if (existing) {
    return Response.json({
      available: false,
      reason: "already_registered",
      suggestion: "login",
    });
  }

  const domain = getEmailDomain(normalized);
  // 회사(법인) 도메인 이메일만 가입 가능 — gmail/naver 등 공용 이메일은 차단.
  // 공용메일 선점으로 인한 도메인 매핑 사각지대·법인 사칭을 원천 제거하기 위함.
  if (!domain || isPublicDomain(domain)) {
    return Response.json({
      available: false,
      reason: "public_email",
      domain,
      isPublicDomain: true,
    });
  }

  // 같은 도메인을 쓰는 법인이 여러 개일 수 있음 (SaaS 메일 공유 케이스).
  // 검증된 법인을 우선으로 정렬 (dart_matched/verified → pending_review → rejected 제외).
  const { desc, sql, inArray, ne } = await import("drizzle-orm");
  const matchedOrgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      verificationStatus: organizations.verificationStatus,
      bizRegistrationNo: organizations.bizRegistrationNo,
    })
    .from(organizations)
    .where(
      sql`${organizations.emailDomain} = ${domain} AND ${organizations.verificationStatus} != 'rejected'`
    )
    .orderBy(
      sql`CASE ${organizations.verificationStatus}
            WHEN 'dart_matched' THEN 0
            WHEN 'verified' THEN 1
            WHEN 'pending_review' THEN 2
            ELSE 3 END`,
      desc(organizations.id)
    );

  // 각 매칭 법인의 org_admin 정보 마스킹해서 반환.
  // lastSeenAt(접속 시각)은 의도적으로 노출하지 않음 — 인증 전 활동 시간대 정찰 차단.
  const enriched = await Promise.all(
    matchedOrgs.map(async (org) => {
      const rows = await db
        .select({
          email: users.email,
          name: users.name,
        })
        .from(users)
        .where(
          sql`${users.orgId} = ${org.id} AND ${users.role} = 'org_admin' AND ${users.status} = 'active'`
        )
        .orderBy(desc(users.id))
        .limit(3);
      return {
        ...org,
        bizRegistrationNo: maskBizNo(org.bizRegistrationNo),
        admins: rows.map((r) => ({
          email: maskEmail(r.email),
          name: maskName(r.name),
        })),
      };
    })
  );

  // 하위호환: 단일 매칭이면 matchedOrg/admins 유지. 항상 matchedOrgs 도 함께.
  const single = enriched.length === 1 ? enriched[0] : null;
  void inArray;
  void ne;

  return Response.json({
    available: true,
    domain,
    isPublicDomain: false,
    matchedOrg: single ? { id: single.id, name: single.name } : null,
    admins: single?.admins,
    matchedOrgs: enriched,
    suggestion:
      enriched.length === 0
        ? "create_or_search"
        : enriched.length === 1
          ? "join"
          : "choose_match",
  });
}

// PII 노출 최소화 — 회원가입 전 단계에서는 부분 마스킹된 식별자만 노출.
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.max(1, Math.min(2, local.length - 1)));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function maskName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + "*";
  return name[0] + "*".repeat(name.length - 2) + name[name.length - 1];
}

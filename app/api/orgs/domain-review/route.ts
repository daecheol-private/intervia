/**
 * 같은 도메인 코테넌트 법인 검토 — org_admin 이 자기 이메일 도메인에 등록된 다른 법인을
 *   acknowledge : 아는(관계사) 법인으로 확인 → 목록에서 더 이상 안내 X
 *   report      : 모르는 법인으로 신고 → 시스템 운영자 인앱·이메일 통지 + 검토 대기
 * 상태를 org_domain_reviews 에 영속 저장(리프레시 후에도 유지)한다.
 *
 * 직접 차단 권한은 주지 않는다 (한 도메인을 여러 법인이 공유하는 정상 케이스에서
 * 코테넌트 간 악용·분쟁 방지) — 최종 거절/정지는 sysadmin 이 /admin/orgs 에서 판단.
 */
import { after } from "next/server";
import { db } from "@/lib/db";
import { organizations, orgDomainReviews } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { notifySystemAdmins } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await rateLimit(req, "domain-review", {
    limit: 20,
    windowSec: 60,
  });
  if (limited) return limited;

  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member")
    return new Response("권한 없음 (법인 관리자 전용)", { status: 403 });
  if (!me!.orgId) return new Response("소속 법인이 없습니다.", { status: 400 });

  const { orgId, action, reason } = (await req.json().catch(() => ({}))) as {
    orgId?: number;
    action?: "report" | "acknowledge";
    reason?: string;
  };
  if (!orgId) return new Response("orgId 필요", { status: 400 });
  if (action !== "report" && action !== "acknowledge")
    return new Response("action 은 report | acknowledge 여야 합니다.", {
      status: 400,
    });
  if (orgId === me!.orgId)
    return new Response("본인 법인은 검토 대상이 아닙니다.", { status: 400 });

  const [myOrg] = await db
    .select({
      name: organizations.name,
      emailDomain: organizations.emailDomain,
    })
    .from(organizations)
    .where(eq(organizations.id, me!.orgId));
  const [target] = await db
    .select({
      name: organizations.name,
      emailDomain: organizations.emailDomain,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!target) return new Response("대상 법인 없음", { status: 404 });

  // 같은 도메인 코테넌트만 검토 가능 — 타 도메인 법인 검토 차단.
  if (
    !myOrg?.emailDomain ||
    !target.emailDomain ||
    myOrg.emailDomain !== target.emailDomain
  )
    return new Response("같은 도메인 법인만 검토할 수 있습니다.", {
      status: 403,
    });

  const status = action === "report" ? "reported" : "acknowledged";
  const trimmedReason =
    action === "report" ? (reason ?? "").trim().slice(0, 500) || null : null;

  // upsert — (reviewerOrgId, targetOrgId) 유니크. 액션 변경 시 status 갱신.
  await db
    .insert(orgDomainReviews)
    .values({
      reviewerOrgId: me!.orgId,
      targetOrgId: orgId,
      status,
      reason: trimmedReason,
      reviewedByUserId: me!.id,
    })
    .onConflictDoUpdate({
      target: [orgDomainReviews.reviewerOrgId, orgDomainReviews.targetOrgId],
      set: {
        status,
        reason: trimmedReason,
        reviewedByUserId: me!.id,
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      },
    });

  if (action === "report") {
    // after() — 사칭 신고는 즉시 운영자에게 닿아야 한다. void 는 서버리스 suspend 로
    // 잘려 유실된다(GOTCHAS §0-1).
    after(() =>
      notifySystemAdmins(
        {
          type: "new_org",
          title: `[도메인 신고] '${myOrg.name}'(${me!.email})가 같은 도메인(${myOrg.emailDomain})의 법인 '${target.name}'을 모르는 법인으로 신고 — 검토 필요`,
          href: "/admin/orgs",
          payload: {
            reportedOrgId: orgId,
            reporterOrgId: me!.orgId,
            domain: myOrg.emailDomain,
            reason: trimmedReason,
          },
        },
        { email: true }
      ).catch((e) => console.error("[domain-review] 운영자 신고 통지 실패:", e))
    );
    logAudit(req, {
      actor: me,
      action: "org.domain_report",
      resourceType: "organization",
      resourceId: orgId,
      orgId: me!.orgId,
      metadata: {
        reportedOrgName: target.name,
        domain: myOrg.emailDomain,
        reason: trimmedReason,
      },
    });
  } else {
    logAudit(req, {
      actor: me,
      action: "org.domain_acknowledge",
      resourceType: "organization",
      resourceId: orgId,
      orgId: me!.orgId,
      metadata: { acknowledgedOrgName: target.name, domain: myOrg.emailDomain },
    });
  }

  return Response.json({ ok: true, status });
}

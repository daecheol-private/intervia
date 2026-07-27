/**
 * 감사 로그 조회. system_admin 또는 org_admin (본인 법인만).
 *
 * 파라미터:
 *   q      통합 검색 — 액터(이름·이메일·역할) / 액션(원문·한글 라벨) / 대상 / 법인 / IP / 메타
 *   start  'YYYY-MM-DD' (KST) 시작일 포함
 *   end    'YYYY-MM-DD' (KST) 종료일 포함
 *   days   start·end 가 없을 때만 쓰는 "최근 N일" 폴백 (기본 7)
 *   limit  기본 200, 최대 2000
 *
 * 응답 `{ rows, total, limit }` — total 은 필터에 걸린 전체 건수라, 화면이 "전체 N건 중 M건"
 * 으로 잘림을 드러낼 수 있다. 예전엔 limit 100 이 조용히 잘려서 "30일을 골라도 3일치만
 * 나온다"로 보였다(로그는 정상 저장되고 있었다).
 */
import { db } from "@/lib/db";
import { auditLogs, users, organizations } from "@/lib/schema";
import { count, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { buildAuditWhere } from "@/lib/audit-query";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member")
    return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 200), 1),
    2000
  );
  const orgIdParam = url.searchParams.get("orgId");

  // 권한 분기: org_admin 은 본인 법인만, system_admin 은 전체 또는 지정
  let orgFilter: number | null = null;
  if (me!.role === "org_admin") {
    if (!me!.orgId) return new Response("orgId 없음", { status: 400 });
    orgFilter = me!.orgId;
  } else if (orgIdParam) {
    orgFilter = Number(orgIdParam);
  }

  const where = buildAuditWhere({
    q: url.searchParams.get("q"),
    start: url.searchParams.get("start"),
    end: url.searchParams.get("end"),
    days: Number(url.searchParams.get("days") ?? 7),
    orgId: orgFilter,
  });

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      orgId: auditLogs.orgId,
      orgName: organizations.name,
      actorUserId: auditLogs.actorUserId,
      actorRole: auditLogs.actorRole,
      actorName: users.name,
      actorEmail: users.email,
      ip: auditLogs.ip,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(organizations, eq(organizations.id, auditLogs.orgId))
    .where(where)
    .orderBy(desc(auditLogs.id))
    .limit(limit);

  // 같은 조건의 전체 건수 — 검색이 leftJoin 컬럼(액터명·법인명)을 참조하므로 조인 유지.
  const [agg] = await db
    .select({ n: count() })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(organizations, eq(organizations.id, auditLogs.orgId))
    .where(where);

  return Response.json({ rows, total: Number(agg?.n ?? 0), limit });
}

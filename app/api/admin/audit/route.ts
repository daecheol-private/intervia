/**
 * 감사 로그 조회. system_admin 또는 org_admin (본인 법인만).
 */
import { db } from "@/lib/db";
import { auditLogs, users, organizations } from "@/lib/schema";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member")
    return new Response("권한 없음", { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
  const orgIdParam = url.searchParams.get("orgId");
  const actionFilter = url.searchParams.get("action");
  const daysBack = Number(url.searchParams.get("days") ?? 7);

  // 권한 분기: org_admin 은 본인 법인만, system_admin 은 전체 또는 지정
  let orgFilter: number | null = null;
  if (me!.role === "org_admin") {
    if (!me!.orgId) return new Response("orgId 없음", { status: 400 });
    orgFilter = me!.orgId;
  } else if (orgIdParam) {
    orgFilter = Number(orgIdParam);
  }

  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const conditions: SQL[] = [gte(auditLogs.createdAt, since)];
  if (orgFilter !== null) conditions.push(eq(auditLogs.orgId, orgFilter));
  if (actionFilter) conditions.push(eq(auditLogs.action, actionFilter));

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
    .where(and(...conditions))
    .orderBy(desc(auditLogs.id))
    .limit(limit);

  return Response.json(rows);
}

// 감사 로그 통계 — system_admin 대시보드용 (액션별 카운트 24h)
export async function POST() {
  void sql; // unused export — POST 미사용
  return new Response("Method not allowed", { status: 405 });
}

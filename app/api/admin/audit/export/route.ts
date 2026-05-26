/**
 * 감사 로그 CSV export — 컴플라이언스 감사 대응.
 * system_admin 전용 (전체) / org_admin 은 본인 법인만.
 *
 * `?days=N` (기본 30, 최대 365) `?action=...` (선택)
 */
import { db } from "@/lib/db";
import { auditLogs, users, organizations } from "@/lib/schema";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r"))
    return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member")
    return new Response("권한 없음", { status: 403 });

  const url = new URL(req.url);
  const daysBack = Math.min(Number(url.searchParams.get("days") ?? 30), 365);
  const actionFilter = url.searchParams.get("action");
  const orgIdParam = url.searchParams.get("orgId");

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
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      actorRole: auditLogs.actorRole,
      actorEmail: users.email,
      actorName: users.name,
      orgId: auditLogs.orgId,
      orgName: organizations.name,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      ip: auditLogs.ip,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .leftJoin(organizations, eq(organizations.id, auditLogs.orgId))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.id));

  // CSV — UTF-8 BOM 으로 엑셀 한글 깨짐 방지
  const header = [
    "id",
    "createdAt",
    "action",
    "actorRole",
    "actorEmail",
    "actorName",
    "orgId",
    "orgName",
    "resourceType",
    "resourceId",
    "ip",
    "metadata",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.createdAt,
        r.action,
        r.actorRole,
        r.actorEmail,
        r.actorName,
        r.orgId,
        r.orgName,
        r.resourceType,
        r.resourceId,
        r.ip,
        r.metadata,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  const csv = "﻿" + lines.join("\r\n");

  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}-${daysBack}d.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// satisfy lint
void sql;

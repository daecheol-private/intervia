/**
 * 자동화 의사결정 이의제기 개요 (PIPA §37의2).
 *
 * 권한: system_admin(전체) 또는 org_admin(본인 법인만). member 차단.
 * DPO 알림 메일이 링크하는 `/admin/appeals` 페이지의 데이터 소스.
 * 미처리(pending) 이의제기를 한눈에 보여 법정 기한 내 회신 누락을 방지.
 *
 * 후보자가 +14일 폐기된 뒤에도 appeal_logs 는 마스킹 후 보존되므로,
 * candidate leftJoin 이 null 이어도 행은 표시된다(감사·증빙).
 */
import { db } from "@/lib/db";
import { appealLogs, candidates, jobPostings, organizations } from "@/lib/schema";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

type AppealStatus = "pending" | "reviewed" | "resolved" | "rejected";
const STATUSES: AppealStatus[] = ["pending", "reviewed", "resolved", "rejected"];

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member")
    return new Response("권한 없음", { status: 403 });

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);

  const conditions: SQL[] = [];
  // org_admin 은 본인 법인만, system_admin 은 전체.
  if (me!.role === "org_admin") {
    if (!me!.orgId) return new Response("orgId 없음", { status: 400 });
    conditions.push(eq(candidates.orgId, me!.orgId));
  }
  if (statusParam && STATUSES.includes(statusParam as AppealStatus)) {
    conditions.push(eq(appealLogs.status, statusParam as AppealStatus));
  }

  const rows = await db
    .select({
      id: appealLogs.id,
      candidateId: appealLogs.candidateId,
      candidateName: candidates.name,
      orgId: candidates.orgId,
      orgName: organizations.name,
      jobTitle: jobPostings.title,
      email: appealLogs.email,
      reason: appealLogs.reason,
      status: appealLogs.status,
      response: appealLogs.response,
      reviewedAt: appealLogs.reviewedAt,
      createdAt: appealLogs.createdAt,
    })
    .from(appealLogs)
    .leftJoin(candidates, eq(candidates.id, appealLogs.candidateId))
    .leftJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .leftJoin(organizations, eq(organizations.id, candidates.orgId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      // 미처리(pending) 먼저, 그 안에서 최신순.
      sql`CASE WHEN ${appealLogs.status} = 'pending' THEN 0 ELSE 1 END`,
      desc(appealLogs.createdAt)
    )
    .limit(limit);

  const pendingCount = rows.filter((r) => r.status === "pending").length;
  return Response.json({ results: rows, pendingCount });
}

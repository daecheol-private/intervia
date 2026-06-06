/**
 * 시스템관리자/법인관리자용 운영 메트릭.
 *
 * system_admin: 전체 통계 + 법인별 분포
 * org_admin: 본인 법인만
 */
import { db } from "@/lib/db";
import {
  organizations,
  users,
  jobPostings,
  candidates,
  interviewSessions,
  tokenLedger,
  screeningJobs,
  auditLogs,
} from "@/lib/schema";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { sqliteTimestamp } from "@/lib/utils";

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
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") ?? 30), 365));
  // createdAt(CURRENT_TIMESTAMP 공백 포맷)과 같은 포맷으로 비교 — toISOString(T)과 섞으면
  // 기준일 당일 생성분이 lexicographic gte 에서 누락된다(GOTCHAS §0-0).
  const since = sqliteTimestamp(new Date(Date.now() - days * 86_400_000));

  const isSystemAdmin = me!.role === "system_admin";
  const orgFilter = isSystemAdmin ? null : me!.orgId;

  // 1) 법인·사용자·공고·후보자 카운트
  const totalOrgs = isSystemAdmin
    ? (await db.select({ c: sql<number>`COUNT(*)` }).from(organizations))[0].c
    : 1;
  const totalUsers = isSystemAdmin
    ? (await db.select({ c: sql<number>`COUNT(*)` }).from(users))[0].c
    : (
        await db
          .select({ c: sql<number>`COUNT(*)` })
          .from(users)
          .where(eq(users.orgId, orgFilter!))
      )[0].c;

  const jobCond = orgFilter ? eq(jobPostings.orgId, orgFilter) : undefined;
  const totalJobs = (
    await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(jobPostings)
      .where(jobCond)
  )[0].c;

  const candCond = orgFilter ? eq(candidates.orgId, orgFilter) : undefined;
  const totalCandidates = (
    await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(candidates)
      .where(candCond)
  )[0].c;
  const recentCandidates = (
    await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(candidates)
      .where(
        candCond
          ? and(candCond, gte(candidates.createdAt, since))
          : gte(candidates.createdAt, since)
      )
  )[0].c;

  // 2) Stage 분포
  const stageRowsRaw = await db
    .select({ stage: candidates.stage, c: sql<number>`COUNT(*)` })
    .from(candidates)
    .where(candCond)
    .groupBy(candidates.stage);
  const stages: Record<string, number> = {};
  for (const r of stageRowsRaw) stages[r.stage] = Number(r.c);

  // 3) 토큰 사용 (지난 N일)
  const tokenCond = orgFilter ? eq(tokenLedger.orgId, orgFilter) : undefined;
  const tokenRows = await db
    .select({
      reason: tokenLedger.reason,
      delta_sum: sql<number>`SUM(delta)`,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(tokenLedger)
    .where(
      tokenCond
        ? and(tokenCond, gte(tokenLedger.createdAt, since))
        : gte(tokenLedger.createdAt, since)
    )
    .groupBy(tokenLedger.reason);

  // 4) 큐 상태
  const queueRows = await db
    .select({ status: screeningJobs.status, c: sql<number>`COUNT(*)` })
    .from(screeningJobs)
    .groupBy(screeningJobs.status);
  const queue: Record<string, number> = {};
  for (const r of queueRows) queue[r.status] = Number(r.c);

  // 5) 면접 통계
  const interviewCond: SQL | undefined = orgFilter
    ? sql`${interviewSessions.candidateId} IN (SELECT id FROM candidates WHERE org_id = ${orgFilter})`
    : undefined;
  const interviewRows = await db
    .select({ status: interviewSessions.status, c: sql<number>`COUNT(*)` })
    .from(interviewSessions)
    .where(interviewCond)
    .groupBy(interviewSessions.status);
  const interviews: Record<string, number> = {};
  for (const r of interviewRows) interviews[r.status] = Number(r.c);

  // 6) 최근 감사 로그 cross-org (system_admin 만)
  let recentCrossOrg: unknown[] = [];
  if (isSystemAdmin) {
    recentCrossOrg = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actorUserId: auditLogs.actorUserId,
        orgId: auditLogs.orgId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.actorRole, "system_admin"),
          gte(auditLogs.createdAt, since)
        )
      )
      .orderBy(desc(auditLogs.id))
      .limit(20);
  }

  // 7) 법인별 후보자 분포 (system_admin 만)
  let perOrg: unknown[] = [];
  if (isSystemAdmin) {
    perOrg = await db
      .select({
        orgId: candidates.orgId,
        orgName: organizations.name,
        c: sql<number>`COUNT(*)`,
      })
      .from(candidates)
      .leftJoin(organizations, eq(organizations.id, candidates.orgId))
      .groupBy(candidates.orgId, organizations.name)
      .orderBy(desc(sql<number>`COUNT(*)`));
  }

  return Response.json({
    scope: isSystemAdmin ? "system" : "org",
    daysBack: days,
    totals: {
      orgs: Number(totalOrgs),
      users: Number(totalUsers),
      jobs: Number(totalJobs),
      candidates: Number(totalCandidates),
      candidatesRecent: Number(recentCandidates),
    },
    stages,
    interviews,
    queue,
    tokenUsage: tokenRows.map((r) => ({
      reason: r.reason,
      sum: Number(r.delta_sum),
      count: Number(r.cnt),
    })),
    recentCrossOrg,
    perOrg,
  });
}

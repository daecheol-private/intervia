/**
 * 공고별 채용 깔때기 — stage 별 카운트 + AI/면접 점수 분포.
 */
import { db } from "@/lib/db";
import { jobPostings, candidates } from "@/lib/schema";
import { and, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });
  if (
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(jobId))
  ) {
    return new Response("잠긴 공고입니다.", { status: 403 });
  }

  const rows = await db
    .select({
      stage: candidates.stage,
      count: sql<number>`COUNT(*)`,
    })
    .from(candidates)
    .where(eq(candidates.jobId, jobId))
    .groupBy(candidates.stage);

  const stages = {
    applied: 0,
    screened: 0,
    ai_pending: 0,
    ai_evaluated: 0,
    round1_candidate: 0,
    round1_scheduling: 0,
    round1_waiting: 0,
    round1_passed: 0,
    round2_passed: 0,
    hired: 0,
    rejected: 0,
    withdrawn: 0,
  } as Record<string, number>;
  for (const r of rows) stages[r.stage] = Number(r.count);

  const [stats] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      avgScreen: sql<number>`AVG(CASE WHEN screening_score IS NOT NULL THEN screening_score END)`,
      countScreen: sql<number>`COUNT(CASE WHEN screening_score IS NOT NULL THEN 1 END)`,
    })
    .from(candidates)
    .where(and(eq(candidates.jobId, jobId)));

  // outcome 별로 어느 stage 에서 종결됐는지 분포 (통계용)
  const decisionBreakdown = await db
    .select({
      outcome: candidates.outcome,
      fromStage: candidates.stage,
      n: sql<number>`COUNT(*)`,
    })
    .from(candidates)
    .where(
      and(eq(candidates.jobId, jobId), sql`${candidates.outcome} IS NOT NULL`)
    )
    .groupBy(candidates.outcome, candidates.stage);

  // KPI: 평균 처리 시간(일), 단계별 응답률
  const [timing] = await db
    .select({
      avgDays: sql<number>`AVG(julianday(decided_at) - julianday(created_at))`,
      decidedCount: sql<number>`COUNT(decided_at)`,
    })
    .from(candidates)
    .where(
      and(eq(candidates.jobId, jobId), sql`${candidates.outcome} IS NOT NULL`)
    );

  // 응답률: AI 면접 = ai_pending 이상 도달 후보 중 ai_evaluated 이상 진행된 비율
  // (지원자가 응답한 비율)
  const aiSent =
    Number(stages.ai_pending) +
    Number(stages.ai_evaluated) +
    Number(stages.round1_candidate) +
    Number(stages.round1_scheduling) +
    Number(stages.round1_waiting) +
    Number(stages.round1_passed) +
    Number(stages.round2_passed);
  const aiResponded =
    Number(stages.ai_evaluated) +
    Number(stages.round1_candidate) +
    Number(stages.round1_scheduling) +
    Number(stages.round1_waiting) +
    Number(stages.round1_passed) +
    Number(stages.round2_passed);
  const aiResponseRate = aiSent > 0 ? aiResponded / aiSent : null;

  // 1차 면접 응답률: scheduling 이상 도달 중 waiting 이상 진행 비율
  const r1Sent =
    Number(stages.round1_scheduling) +
    Number(stages.round1_waiting) +
    Number(stages.round1_passed) +
    Number(stages.round2_passed);
  const r1Responded =
    Number(stages.round1_waiting) +
    Number(stages.round1_passed) +
    Number(stages.round2_passed);
  const r1ResponseRate = r1Sent > 0 ? r1Responded / r1Sent : null;

  // 지원자 취소율
  const withdrawnCount = decisionBreakdown
    .filter((r) => r.outcome === "withdrawn")
    .reduce((s, r) => s + Number(r.n), 0);
  const totalCount = Number(stats?.total ?? 0);
  const withdrawnRate = totalCount > 0 ? withdrawnCount / totalCount : 0;

  return Response.json({
    stages,
    total: totalCount,
    avgScreeningScore:
      stats?.avgScreen != null
        ? Math.round(Number(stats.avgScreen))
        : null,
    countWithScreeningScore: Number(stats?.countScreen ?? 0),
    decisionBreakdown: decisionBreakdown.map((r) => ({
      outcome: r.outcome,
      fromStage: r.fromStage,
      n: Number(r.n),
    })),
    kpi: {
      avgDecisionDays:
        timing?.avgDays != null
          ? Math.round(Number(timing.avgDays) * 10) / 10
          : null,
      decidedCount: Number(timing?.decidedCount ?? 0),
      aiResponseRate,
      r1ResponseRate,
      withdrawnRate,
    },
  });
}

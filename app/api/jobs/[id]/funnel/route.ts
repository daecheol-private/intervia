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

  // 응답률 계산은 "그 단계를 거쳐 지나간 모든 후보" 기준 (누적).
  //   - 현재 stage 가 ai_evaluated 이상이면 = AI 면접에 응답한 사람 (rejected 였든 hired 였든)
  //   - 따라서 hired 를 빼기 전 원본 카운트로 계산해야 정확함.
  const stagesRaw = { ...stages };

  // 최종합격 후보는 stage 가 round2_passed (또는 그 이전) 으로 남지만,
  // 파이프라인 UI 에서는 "최종 합격" 셀로 옮겨 표시해야 사용자 멘탈모델과 일치.
  //   - 불합격/지원취소: 어느 단계에서 멈췄는지가 의미 있으므로 stage 카운트에 그대로 유지.
  //   - 최종합격: 전형이 완전히 끝났으므로 이전 stage 에서 빼고 "hired" 로 이동.
  let hiredTotal = 0;
  for (const r of decisionBreakdown) {
    if (r.outcome !== "hired") continue;
    const n = Number(r.n);
    stages[r.fromStage] = Math.max(0, Number(stages[r.fromStage]) - n);
    hiredTotal += n;
  }
  stages.hired = hiredTotal;

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

  // 응답률 계산은 stagesRaw (hired 분리 전 원본) 사용 — 누적 통과 기준.
  // 예: 최종합격 후보도 AI 면접·1차 면접을 모두 응답한 사람이므로 분자/분모에 포함.

  // 응답률: AI 면접 = ai_pending 이상 도달 후보 중 ai_evaluated 이상 진행된 비율
  // (지원자가 응답한 비율)
  const aiSent =
    Number(stagesRaw.ai_pending) +
    Number(stagesRaw.ai_evaluated) +
    Number(stagesRaw.round1_candidate) +
    Number(stagesRaw.round1_scheduling) +
    Number(stagesRaw.round1_waiting) +
    Number(stagesRaw.round1_passed) +
    Number(stagesRaw.round2_passed);
  const aiResponded =
    Number(stagesRaw.ai_evaluated) +
    Number(stagesRaw.round1_candidate) +
    Number(stagesRaw.round1_scheduling) +
    Number(stagesRaw.round1_waiting) +
    Number(stagesRaw.round1_passed) +
    Number(stagesRaw.round2_passed);
  const aiResponseRate = aiSent > 0 ? aiResponded / aiSent : null;

  // 1차 면접 응답률: scheduling 이상 도달 중 waiting 이상 진행 비율
  const r1Sent =
    Number(stagesRaw.round1_scheduling) +
    Number(stagesRaw.round1_waiting) +
    Number(stagesRaw.round1_passed) +
    Number(stagesRaw.round2_passed);
  const r1Responded =
    Number(stagesRaw.round1_waiting) +
    Number(stagesRaw.round1_passed) +
    Number(stagesRaw.round2_passed);
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

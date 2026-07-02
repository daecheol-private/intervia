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

  // 진행 중(outcome IS NULL) 만 카운트 — "오늘 결정할 일" 액션 아이템 계산용.
  // stages 는 종결된 후보도 포함(파이프라인 시각화에 필요)하지만,
  // pendingByStage 는 결정되지 않은 후보만 → HR 액션이 필요한 진짜 잔여 건수.
  const pendingRows = await db
    .select({
      stage: candidates.stage,
      count: sql<number>`COUNT(*)`,
    })
    .from(candidates)
    .where(and(eq(candidates.jobId, jobId), sql`${candidates.outcome} IS NULL`))
    .groupBy(candidates.stage);
  const pendingByStage: Record<string, number> = {};
  for (const r of pendingRows) pendingByStage[r.stage] = Number(r.count);

  // "오늘 결정할 일" 중 stage 만으로 셀 수 없는 HR 액션 — 스케줄/세션/큐 row 기반.
  // 판정 기준은 lib/candidate-state.ts 파생 규칙의 SQL 재현 (조건 바꿀 때 양쪽 동기화).
  //  counterProposed: 지원자가 시간을 역제시해 HR 확정/재제시 대기 (round1·round2 공통)
  //  round1PassedUndecided: 1차 합격인데 아직 2차 스케줄 제시 전 → 진짜 "2차 진행 결정" 대상
  //  resumeActionNeeded: 평가 실패/충전 대기/평가 미실행 — HR 이 재평가·충전·검토요청 필요
  //  aiLinkExpired: 응시 중 만료된 AI 면접 링크 — 재발송 또는 결정 필요
  //  resultDue: 확정 면접 시각 경과 후 결과 미입력 (1·2차)
  const latestSched = (round: "round1" | "round2") => sql`(
    SELECT s.status FROM interview_schedules s
    WHERE s.candidate_id = ${candidates.id} AND s.round = ${round}
      AND s.status IN ('pending','counter_proposed','selected')
    ORDER BY s.id DESC LIMIT 1
  )`;
  const latestSchedEnd = (round: "round1" | "round2") => sql`(
    SELECT json_extract(s.selected_slot, '$.end') FROM interview_schedules s
    WHERE s.candidate_id = ${candidates.id} AND s.round = ${round}
      AND s.status IN ('pending','counter_proposed','selected')
    ORDER BY s.id DESC LIMIT 1
  )`;
  const latestScreenJob = sql`(
    SELECT s.status FROM screening_jobs s
    WHERE s.candidate_id = ${candidates.id}
    ORDER BY s.id DESC LIMIT 1
  )`;
  const nowIso = new Date().toISOString();
  const [hrSched] = await db
    .select({
      counterProposed: sql<number>`COALESCE(SUM(CASE
        WHEN ${candidates.stage} = 'round1_scheduling' AND ${latestSched("round1")} = 'counter_proposed' THEN 1
        WHEN ${candidates.stage} = 'round1_passed' AND ${latestSched("round2")} = 'counter_proposed' THEN 1
        ELSE 0 END), 0)`,
      round1PassedUndecided: sql<number>`COALESCE(SUM(CASE
        WHEN ${candidates.stage} = 'round1_passed' AND ${latestSched("round2")} IS NULL THEN 1
        ELSE 0 END), 0)`,
      resumeActionNeeded: sql<number>`COALESCE(SUM(CASE
        WHEN ${candidates.stage} IN ('applied','screened') AND (
          ${latestScreenJob} IN ('failed','paused')
          OR (${latestScreenJob} IS NULL AND ${candidates.screeningReport} IS NULL)
        ) THEN 1 ELSE 0 END), 0)`,
      // ⚠️ GOTCHAS §5-1 — 인라인 상관 서브쿼리에선 ${candidates.id} 가 접두어를 잃어
      // bare "id" 로 렌더되고 interview_sessions.id 로 오결합돼 s.candidate_id = s.id
      // (거의 항상 false) → aiLinkExpired 가 항상 0 이었다. toSQL() 로 실측 확인.
      // 외부 참조는 리터럴 candidates.id (SQLite 가 외부 테이블로 정확히 상관) 로 써야 한다.
      aiLinkExpired: sql<number>`COALESCE(SUM(CASE
        WHEN ${candidates.stage} = 'ai_pending'
          AND EXISTS (SELECT 1 FROM interview_sessions s WHERE s.candidate_id = candidates.id AND s.status = 'expired')
          AND NOT EXISTS (SELECT 1 FROM interview_sessions s WHERE s.candidate_id = candidates.id AND s.status IN ('pending','in_progress','completed'))
        THEN 1 ELSE 0 END), 0)`,
      resultDue: sql<number>`COALESCE(SUM(CASE
        WHEN ${candidates.stage} = 'round1_waiting' AND ${latestSched("round1")} = 'selected' AND datetime(${latestSchedEnd("round1")}) <= datetime(${nowIso}) THEN 1
        WHEN ${candidates.stage} = 'round1_passed' AND ${latestSched("round2")} = 'selected' AND datetime(${latestSchedEnd("round2")}) <= datetime(${nowIso}) THEN 1
        ELSE 0 END), 0)`,
    })
    .from(candidates)
    .where(and(eq(candidates.jobId, jobId), sql`${candidates.outcome} IS NULL`));
  const hrActions = {
    counterProposed: Number(hrSched?.counterProposed ?? 0),
    round1PassedUndecided: Number(hrSched?.round1PassedUndecided ?? 0),
    resumeActionNeeded: Number(hrSched?.resumeActionNeeded ?? 0),
    aiLinkExpired: Number(hrSched?.aiLinkExpired ?? 0),
    resultDue: Number(hrSched?.resultDue ?? 0),
  };

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

  // 종결된 후보(최종합격/불합격/지원취소)는 진행 단계 카운트에서 빼고 각자의 종결 셀로 이동.
  //   → "전형단계 현황" 숫자가 실제 진행 중 인원과 일치 (불합격·지원취소가 'AI면접-대기' 등에
  //      남아 헷갈리는 문제 해소).
  //   → 어느 단계에서 종결됐는지는 decisionBreakdown 에 보존되어 리포트 통계에 사용.
  //   → legacy: stage 가 이미 종결값(hired/rejected/withdrawn)이면 rows 에서 이미 종결 셀에
  //      집계됐으므로 중복 방지 위해 건너뜀.
  for (const r of decisionBreakdown) {
    if (r.outcome == null || r.fromStage === r.outcome) continue;
    const n = Number(r.n);
    stages[r.fromStage] = Math.max(0, Number(stages[r.fromStage] ?? 0) - n);
    stages[r.outcome] = Number(stages[r.outcome] ?? 0) + n;
  }

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
    pendingByStage,
    hrActions,
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

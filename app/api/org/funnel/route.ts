/**
 * 법인 단위 채용 현황 집계 — org_admin 대시보드용.
 *
 * 후보자의 `stage`(진행 단계)와 `outcome`(종결 결과)는 분리돼 있다.
 *   - "진행 중 파이프라인"은 outcome IS NULL 기준 stage 분포
 *   - "결정 현황"은 outcome 분포
 *
 * 대시보드가 HR 에게 실질적으로 쓸모있도록 다음을 한 번에 제공한다:
 *   - KPI(총원·진행중·합격·합격률·평균 리드타임 등)
 *   - 전사 채용 퍼널(누적 통과 + 전환율)
 *   - 단계별 대기(누가 공을 쥐고 있나 = 액션 필요)
 *   - 공고별 비교(어느 공고가 건강/정체)
 *   - 신규 지원 시계열(모멘텀)
 *   - 결정·서류점수·추천등급 분포
 *
 * 후보 원본 행은 응답에 싣지 않는다(서버에서만 집계). screeningReport JSON 도 서버 측에서만 사용.
 */
import { db } from "@/lib/db";
import { candidates, jobPostings } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { STAGE_RANK, STAGE_WAITER, type Stage } from "@/lib/stage-meta";

export const runtime = "nodejs";

const DAY = 86_400_000;

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });
  const orgId = me!.orgId;
  if (orgId == null)
    return new Response("법인 소속이 아닙니다.", { status: 400 });

  const url = new URL(req.url);
  const days = Math.max(
    1,
    Math.min(Number(url.searchParams.get("days") ?? 30), 365)
  );
  const now = Date.now();
  const sinceMs = now - days * DAY;

  // 공고 목록 (org)
  const jobs = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      status: jobPostings.status,
      closesAt: jobPostings.closesAt,
    })
    .from(jobPostings)
    .where(eq(jobPostings.orgId, orgId))
    .orderBy(desc(jobPostings.createdAt));

  // 후보자 (org) — 집계에 필요한 컬럼만
  const cands = await db
    .select({
      jobId: candidates.jobId,
      stage: candidates.stage,
      outcome: candidates.outcome,
      decisionFromStage: candidates.decisionFromStage,
      screeningScore: candidates.screeningScore,
      screeningReport: candidates.screeningReport,
      createdAt: candidates.createdAt,
      decidedAt: candidates.decidedAt,
    })
    .from(candidates)
    .where(eq(candidates.orgId, orgId));

  const total = cands.length;

  // 도달 rank (불합격/지원취소는 결정 직전 단계, 최종합격=100)
  const rankOf = (c: (typeof cands)[number]) => {
    if (c.outcome === "hired") return 100;
    if (c.stage === "rejected" || c.stage === "withdrawn") {
      const f = c.decisionFromStage as Stage | null;
      return f ? STAGE_RANK[f] ?? 10 : 10;
    }
    return STAGE_RANK[c.stage as Stage] ?? 10;
  };

  const pipeline: Record<string, number> = {};
  const outcomes: Record<string, number> = {
    hired: 0,
    rejected: 0,
    withdrawn: 0,
  };
  let recent = 0;
  let scoreSum = 0;
  let scoreN = 0;
  let leadSum = 0;
  let leadN = 0;
  const scoreBucketDefs = [
    { label: "~49", lo: 0, hi: 50 },
    { label: "50s", lo: 50, hi: 60 },
    { label: "60s", lo: 60, hi: 70 },
    { label: "70s", lo: 70, hi: 80 },
    { label: "80s", lo: 80, hi: 90 },
    { label: "90+", lo: 90, hi: 101 },
  ];
  const scoreBuckets = scoreBucketDefs.map((b) => ({ label: b.label, value: 0 }));
  const recommendations: Record<string, number> = {
    강력추천: 0,
    추천: 0,
    보류: 0,
    비추천: 0,
  };

  // 시계열 버킷 (일/주/격주)
  const bucketDays = days <= 31 ? 1 : days <= 120 ? 7 : 14;
  const bucketMs = bucketDays * DAY;
  const bucketCount = Math.ceil(days / bucketDays);
  const seriesVals: number[] = new Array(bucketCount).fill(0);
  const fmtMD = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  for (const c of cands) {
    const createdMs = new Date(c.createdAt).getTime();
    if (c.outcome) {
      outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
      if (c.decidedAt) {
        const d = (new Date(c.decidedAt).getTime() - createdMs) / DAY;
        if (d >= 0 && Number.isFinite(d)) {
          leadSum += d;
          leadN++;
        }
      }
    } else {
      pipeline[c.stage] = (pipeline[c.stage] ?? 0) + 1;
    }
    if (createdMs >= sinceMs) {
      recent++;
      const idx = Math.min(
        bucketCount - 1,
        Math.floor((createdMs - sinceMs) / bucketMs)
      );
      if (idx >= 0) seriesVals[idx]++;
    }
    if (c.screeningScore != null) {
      scoreSum += c.screeningScore;
      scoreN++;
      const b = scoreBucketDefs.findIndex(
        (x) => c.screeningScore! >= x.lo && c.screeningScore! < x.hi
      );
      if (b >= 0) scoreBuckets[b].value++;
    }
    const rec = c.screeningReport?.recommendation;
    if (rec && rec in recommendations) recommendations[rec]++;
  }

  const timeseries = seriesVals.map((v, i) => ({
    label: fmtMD(sinceMs + i * bucketMs),
    value: v,
  }));

  // 전사 누적 퍼널
  const FUNNEL_STEPS = [
    { label: "지원", rank: 10 },
    { label: "서류평가", rank: 20 },
    { label: "AI면접 응답", rank: 40 },
    { label: "1차 면접", rank: 60 },
    { label: "1차 합격", rank: 70 },
    { label: "최종 합격", rank: 100 },
  ];
  const ranks = cands.map(rankOf);
  const funnel = FUNNEL_STEPS.map((st) => ({
    label: st.label,
    count: ranks.filter((r) => r >= st.rank).length,
  }));

  // 단계별 대기 (액션 필요) — 진행중 후보를 waiter 로 그룹
  const WAITER_LABEL: Record<string, string> = {
    hr: "HR 처리 대기",
    candidate: "지원자 응답 대기",
    interviewer: "면접관 평가 대기",
    system: "AI 평가 진행 중",
    none: "기타",
  };
  const waiterAgg: Record<
    string,
    { who: string; label: string; count: number; stages: Record<string, number> }
  > = {};
  for (const [stage, n] of Object.entries(pipeline)) {
    const who = STAGE_WAITER[stage as Stage]?.who ?? "none";
    waiterAgg[who] ??= {
      who,
      label: WAITER_LABEL[who] ?? who,
      count: 0,
      stages: {},
    };
    waiterAgg[who].count += n;
    waiterAgg[who].stages[stage] = n;
  }
  const waiterOrder = ["hr", "candidate", "interviewer", "system", "none"];
  const pending = waiterOrder
    .filter((w) => waiterAgg[w])
    .map((w) => ({
      who: waiterAgg[w].who,
      label: waiterAgg[w].label,
      count: waiterAgg[w].count,
      stages: Object.entries(waiterAgg[w].stages)
        .map(([stage, count]) => ({ stage, count }))
        .sort((a, b) => b.count - a.count),
    }));

  // 공고별 비교
  type JobAgg = {
    total: number;
    inProgress: number;
    hired: number;
    rejected: number;
    withdrawn: number;
    scoreSum: number;
    scoreN: number;
    leadSum: number;
    leadN: number;
  };
  const byJob = new Map<number, JobAgg>();
  for (const c of cands) {
    let a = byJob.get(c.jobId);
    if (!a) {
      a = {
        total: 0,
        inProgress: 0,
        hired: 0,
        rejected: 0,
        withdrawn: 0,
        scoreSum: 0,
        scoreN: 0,
        leadSum: 0,
        leadN: 0,
      };
      byJob.set(c.jobId, a);
    }
    a.total++;
    if (!c.outcome) a.inProgress++;
    else if (c.outcome === "hired") a.hired++;
    else if (c.outcome === "rejected") a.rejected++;
    else if (c.outcome === "withdrawn") a.withdrawn++;
    if (c.screeningScore != null) {
      a.scoreSum += c.screeningScore;
      a.scoreN++;
    }
    if (c.outcome && c.decidedAt) {
      const d =
        (new Date(c.decidedAt).getTime() - new Date(c.createdAt).getTime()) /
        DAY;
      if (d >= 0 && Number.isFinite(d)) {
        a.leadSum += d;
        a.leadN++;
      }
    }
  }
  const jobStats = jobs
    .map((j) => {
      const a = byJob.get(j.id);
      return {
        id: j.id,
        title: j.title,
        status: j.status,
        closesAt: j.closesAt,
        total: a?.total ?? 0,
        inProgress: a?.inProgress ?? 0,
        hired: a?.hired ?? 0,
        rejected: a?.rejected ?? 0,
        withdrawn: a?.withdrawn ?? 0,
        avgScore: a && a.scoreN > 0 ? Math.round(a.scoreSum / a.scoreN) : null,
        avgDecisionDays:
          a && a.leadN > 0 ? Math.round((a.leadSum / a.leadN) * 10) / 10 : null,
      };
    })
    .filter((j) => j.total > 0 || j.status === "active")
    .sort((a, b) => b.total - a.total);

  const activeJobs = jobs.filter((j) => j.status === "active").length;
  const inProgress = Object.values(pipeline).reduce((a, b) => a + b, 0);
  const hired = outcomes.hired ?? 0;
  const decided = (outcomes.hired ?? 0) + (outcomes.rejected ?? 0);

  return Response.json({
    daysBack: days,
    kpi: {
      total,
      inProgress,
      hired,
      rejected: outcomes.rejected ?? 0,
      withdrawn: outcomes.withdrawn ?? 0,
      hireRate: decided > 0 ? hired / decided : null,
      activeJobs,
      recentCount: recent,
      avgDecisionDays:
        leadN > 0 ? Math.round((leadSum / leadN) * 10) / 10 : null,
      avgScreeningScore: scoreN > 0 ? Math.round(scoreSum / scoreN) : null,
    },
    funnel,
    pipeline,
    pending,
    outcomes,
    jobs: jobStats,
    timeseries,
    bucketDays,
    scoreBuckets,
    scoreScored: scoreN,
    recommendations,
  });
}

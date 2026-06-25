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
import {
  candidates,
  jobPostings,
  interviewSessions,
  interviewSchedules,
  screeningJobs,
} from "@/lib/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { STAGE_RANK, type Stage } from "@/lib/stage-meta";
import {
  deriveCandidateState,
  type Waiter,
  type CandidateStateInput,
} from "@/lib/candidate-state";
import { parseDbTimestamp } from "@/lib/utils";

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
      id: candidates.id,
      jobId: candidates.jobId,
      stage: candidates.stage,
      outcome: candidates.outcome,
      decisionFromStage: candidates.decisionFromStage,
      screeningScore: candidates.screeningScore,
      // 집계엔 recommendation 한 필드만 쓰므로 리포트 JSON 전체를 끌어오지 않는다(대시보드 페이로드 절감).
      recommendation: sql<string | null>`json_extract(${candidates.screeningReport}, '$.recommendation')`,
      // 파생 상태(deriveCandidateState) 입력용 — JSON 본문/마스킹 텍스트는 전송하지 않고 존재/길이만.
      hasReport: sql<number>`CASE WHEN ${candidates.screeningReport} IS NOT NULL THEN 1 ELSE 0 END`,
      maskedLen: sql<number>`COALESCE(LENGTH(${candidates.resumeMaskedText}), 0)`,
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
  // 라벨은 KST 기준 M/D (서버가 UTC 인 운영 환경에서도 한국 날짜로 표시).
  const fmtMD = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
    }).format(new Date(ms));

  for (const c of cands) {
    const createdMs = parseDbTimestamp(c.createdAt).getTime();
    if (c.outcome) {
      outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
      if (c.decidedAt) {
        const d = (parseDbTimestamp(c.decidedAt).getTime() - createdMs) / DAY;
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
    const rec = c.recommendation;
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

  // 단계별 대기 (액션 필요) — 후보자 파생 상태(deriveCandidateState)로 "지금 누가 무엇을"을 판정.
  //   stage 만으로는 "면접 확정·진행 대기"(아직 면접일 전)와 "면접 완료·결과 입력 필요"(시각 경과)를
  //   구분할 수 없다. 큐/세션/스케줄 row 를 합쳐 목록·뱃지와 동일한 SSOT 규칙으로 분류한다.
  //   (이 라우트가 유일하게 SSOT 를 안 쓰던 곳 — 이제 대시보드 카운트가 후보 목록과 일치)
  const pendingCands = cands.filter(
    (c) =>
      !c.outcome &&
      c.stage !== "hired" &&
      c.stage !== "rejected" &&
      c.stage !== "withdrawn"
  );
  const pendingIds = pendingCands.map((c) => c.id);

  // 파생에 필요한 보조 row — 진행 중 후보에 한해서만(종결자는 closed 로 파생되어 버킷 제외).
  const [sessRows, jobRows, schedRows] = await Promise.all([
    pendingIds.length
      ? db
          .select({
            candidateId: interviewSessions.candidateId,
            status: interviewSessions.status,
          })
          .from(interviewSessions)
          .where(inArray(interviewSessions.candidateId, pendingIds))
          .orderBy(desc(interviewSessions.createdAt))
      : Promise.resolve([]),
    pendingIds.length
      ? db
          .select({
            candidateId: screeningJobs.candidateId,
            status: screeningJobs.status,
            attempts: screeningJobs.attempts,
          })
          .from(screeningJobs)
          .where(inArray(screeningJobs.candidateId, pendingIds))
          .orderBy(desc(screeningJobs.id))
      : Promise.resolve([]),
    pendingIds.length
      ? db
          .select({
            candidateId: interviewSchedules.candidateId,
            round: interviewSchedules.round,
            status: interviewSchedules.status,
            selectedSlot: interviewSchedules.selectedSlot,
          })
          .from(interviewSchedules)
          .where(
            and(
              inArray(interviewSchedules.candidateId, pendingIds),
              inArray(interviewSchedules.status, [
                "pending",
                "counter_proposed",
                "selected",
              ])
            )
          )
          .orderBy(desc(interviewSchedules.id))
      : Promise.resolve([]),
  ]);

  // 후보자별 최신 1건씩 — desc 정렬이라 첫 항목이 최신.
  const sessByCand = new Map<number, string>();
  for (const s of sessRows)
    if (!sessByCand.has(s.candidateId)) sessByCand.set(s.candidateId, s.status);
  const jobByCand = new Map<number, { status: string; attempts: number }>();
  for (const j of jobRows)
    if (!jobByCand.has(j.candidateId))
      jobByCand.set(j.candidateId, { status: j.status, attempts: j.attempts });
  type SchedInfo = {
    status: "pending" | "counter_proposed" | "selected";
    selectedEnd: string | null;
  };
  const r1ByCand = new Map<number, SchedInfo>();
  const r2ByCand = new Map<number, SchedInfo>();
  for (const s of schedRows) {
    const m = s.round === "round2" ? r2ByCand : r1ByCand;
    if (!m.has(s.candidateId))
      m.set(s.candidateId, {
        status: s.status as SchedInfo["status"],
        selectedEnd:
          s.status === "selected" ? (s.selectedSlot?.end ?? null) : null,
      });
  }

  const WAITER_LABEL: Record<Waiter, string> = {
    hr: "처리 대기",
    interviewer: "면접 예정",
    candidate: "지원자 응답 대기",
    system: "AI 평가 진행 중",
    none: "기타",
  };
  const buckets = new Map<
    Waiter,
    { who: Waiter; label: string; count: number; items: Map<string, { label: string; count: number }> }
  >();
  for (const c of pendingCands) {
    const jb = jobByCand.get(c.id);
    const active = jb?.status === "queued" || jb?.status === "processing";
    const st = deriveCandidateState(
      {
        stage: c.stage as Stage,
        outcome: null,
        screeningReport: c.hasReport ? 1 : null,
        parsed: (c.maskedLen ?? 0) >= 30,
        queueStatus: active ? (jb!.status as "queued" | "processing") : null,
        queueAttempts: jb?.attempts ?? 0,
        lastJobStatus: (jb?.status ?? null) as CandidateStateInput["lastJobStatus"],
        latestInterviewStatus: (sessByCand.get(c.id) ??
          null) as CandidateStateInput["latestInterviewStatus"],
        round1ScheduleStatus: r1ByCand.get(c.id)?.status ?? null,
        round2ScheduleStatus: r2ByCand.get(c.id)?.status ?? null,
        round1SelectedEnd: r1ByCand.get(c.id)?.selectedEnd ?? null,
        round2SelectedEnd: r2ByCand.get(c.id)?.selectedEnd ?? null,
      },
      now
    );
    let b = buckets.get(st.waiter);
    if (!b) {
      b = { who: st.waiter, label: WAITER_LABEL[st.waiter], count: 0, items: new Map() };
      buckets.set(st.waiter, b);
    }
    b.count++;
    // 액션 라벨 기준으로 묶는다 — 1·2차 동일 액션(역제안·응답 대기 등)은 한 줄로 합산.
    const it = b.items.get(st.label) ?? { label: st.label, count: 0 };
    it.count++;
    b.items.set(st.label, it);
  }
  const waiterOrder: Waiter[] = ["hr", "interviewer", "candidate", "system"];
  const pending = waiterOrder
    .filter((w) => buckets.has(w))
    .map((w) => {
      const b = buckets.get(w)!;
      return {
        who: b.who,
        label: b.label,
        count: b.count,
        items: [...b.items.values()].sort((a, z) => z.count - a.count),
      };
    });

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

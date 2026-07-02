import { db } from "@/lib/db";
import {
  jobPostings,
  candidates,
  interviewSessions,
  interviewerNotes,
  screeningJobs,
  organizations,
  jobInterviewers,
  users,
  type InterviewEvaluation,
} from "@/lib/schema";
import { and, eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg } from "@/lib/tenant";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatKstDateTime, formatLocalDate } from "@/lib/utils";
import { STAGE_RANK, type Stage } from "@/lib/stage-meta";
import { PrintButton } from "./PrintButton";
import { Donut, Radar, VBars, HBars, C } from "@/components/charts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY = 86_400_000;

export default async function JobReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const jobId = Number(id);
  if (Number.isNaN(jobId)) notFound();

  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) notFound();
  if (!ownsOrg(me, job.orgId)) notFound();

  const [org] = job.orgId
    ? await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, job.orgId))
    : [{ name: null }];

  // 리포트가 실제 쓰는 소형 컬럼만 — 전체 select() 는 resume_text·resume_masked_text
  // (이력서 원문, 후보자당 수십 KB)를 전 후보분 끌어왔다(GOTCHAS §0-0-5 금지 패턴).
  // 400명 공고 리포트에서 수십 MB 전송. 누락 컬럼은 tsc 가 사용처에서 잡는다.
  const cands = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      outcome: candidates.outcome,
      outcomeReason: candidates.outcomeReason,
      decisionFromStage: candidates.decisionFromStage,
      stage: candidates.stage,
      screeningScore: candidates.screeningScore,
      screeningReport: candidates.screeningReport,
      careerYears: candidates.careerYears,
      educationLevel: candidates.educationLevel,
      decidedAt: candidates.decidedAt,
      createdAt: candidates.createdAt,
      lastInterviewEmailSentAt: candidates.lastInterviewEmailSentAt,
      interviewEmailCount: candidates.interviewEmailCount,
    })
    .from(candidates)
    .where(eq(candidates.jobId, jobId))
    .orderBy(desc(candidates.screeningScore));

  const totalCount = cands.length;

  // ───────── 결과 / 서류 점수 집계 ─────────
  let hiredCount = 0;
  let rejectedCount = 0;
  let withdrawnCount = 0;
  let totalScreeningScore = 0;
  let countWithScreening = 0;
  let hiredScreeningSum = 0;
  let hiredScreeningCount = 0;
  for (const c of cands) {
    if (c.outcome === "hired") hiredCount++;
    else if (c.outcome === "rejected") rejectedCount++;
    else if (c.outcome === "withdrawn") withdrawnCount++;
    if (c.screeningScore != null) {
      totalScreeningScore += c.screeningScore;
      countWithScreening++;
      if (c.outcome === "hired") {
        hiredScreeningSum += c.screeningScore;
        hiredScreeningCount++;
      }
    }
  }
  const inProgressCount =
    totalCount - hiredCount - rejectedCount - withdrawnCount;
  const hireRate =
    totalCount > 0
      ? `${Math.round((hiredCount / totalCount) * 1000) / 10}%`
      : "-";
  const avgScreening =
    countWithScreening > 0
      ? Math.round(totalScreeningScore / countWithScreening)
      : null;
  const avgHiredScreening =
    hiredScreeningCount > 0
      ? Math.round(hiredScreeningSum / hiredScreeningCount)
      : null;
  const hired = cands.filter((c) => c.outcome === "hired");

  // ───────── AI 면접 세션 ─────────
  const sessions = await db
    .select({
      candidateId: interviewSessions.candidateId,
      evaluation: interviewSessions.evaluation,
      startedAt: interviewSessions.startedAt,
      completedAt: interviewSessions.completedAt,
    })
    .from(interviewSessions)
    .innerJoin(candidates, eq(candidates.id, interviewSessions.candidateId))
    .where(
      and(
        eq(candidates.jobId, jobId),
        eq(interviewSessions.status, "completed")
      )
    );
  const sessionByCand = new Map<
    number,
    {
      overall: number | null;
      startedAt: string | null;
      completedAt: string | null;
      evaluation: InterviewEvaluation | null;
    }
  >();
  for (const s of sessions) {
    sessionByCand.set(s.candidateId, {
      overall: s.evaluation?.overall_score ?? null,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      evaluation: s.evaluation,
    });
  }

  // ───────── 사람(대면) 면접 평가 → 후보별 평균 ─────────
  const notes = await db
    .select({
      candidateId: interviewerNotes.candidateId,
      scores: interviewerNotes.scores,
    })
    .from(interviewerNotes)
    .innerJoin(candidates, eq(candidates.id, interviewerNotes.candidateId))
    .where(eq(candidates.jobId, jobId));
  const noteMean = (sc: (typeof notes)[number]["scores"]) => {
    const vals = [sc?.skill, sc?.experience, sc?.collaboration, sc?.fit].filter(
      (v): v is number => typeof v === "number"
    );
    return vals.length > 0
      ? vals.reduce((a, b) => a + b, 0) / vals.length
      : null;
  };
  const humanByCand = new Map<number, { sum: number; n: number }>();
  for (const nt of notes) {
    const m = noteMean(nt.scores);
    if (m == null) continue;
    const ck = humanByCand.get(nt.candidateId) ?? { sum: 0, n: 0 };
    ck.sum += m;
    ck.n++;
    humanByCand.set(nt.candidateId, ck);
  }

  // ───────── 처리 기간 ─────────
  const decidedCands = cands.filter((c) => c.decidedAt != null);
  const avgCycleDays =
    decidedCands.length > 0
      ? (
          decidedCands.reduce(
            (s, c) =>
              s +
              (new Date(c.decidedAt!).getTime() -
                new Date(c.createdAt).getTime()) /
                DAY,
            0
          ) / decidedCands.length
        ).toFixed(1)
      : null;

  // ───────── 면접관 ─────────
  const interviewers = await db
    .select({ name: users.name })
    .from(jobInterviewers)
    .innerJoin(users, eq(users.id, jobInterviewers.userId))
    .where(eq(jobInterviewers.jobId, jobId));

  // ───────── 퍼널 ─────────
  const rankOf = (c: (typeof cands)[number]) => {
    if (c.outcome === "hired") return 100;
    if (c.stage === "rejected" || c.stage === "withdrawn") {
      const f = c.decisionFromStage as Stage | null;
      return f ? STAGE_RANK[f] ?? 10 : 10;
    }
    return STAGE_RANK[c.stage as Stage] ?? 10;
  };
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
    ...st,
    count: ranks.filter((r) => r >= st.rank).length,
  }));
  let bottleneck: { label: string; conv: number } | null = null;
  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1].count;
    if (prev > 0) {
      const conv = Math.round((funnel[i].count / prev) * 100);
      if (bottleneck == null || conv < bottleneck.conv)
        bottleneck = { label: funnel[i].label, conv };
    }
  }

  // ───────── AI 응답률 ─────────
  const reached = (stages: string[]) =>
    cands.filter((c) => stages.includes(c.stage)).length;
  const aiSent = reached([
    "ai_pending",
    "ai_evaluated",
    "round1_candidate",
    "round1_scheduling",
    "round1_waiting",
    "round1_passed",
    "round2_passed",
  ]);
  const aiResponded = reached([
    "ai_evaluated",
    "round1_candidate",
    "round1_scheduling",
    "round1_waiting",
    "round1_passed",
    "round2_passed",
  ]);
  const aiResponseRate =
    aiSent > 0 ? Math.round((aiResponded / aiSent) * 100) : null;

  // ───────── 지원자 풀: 서류 점수 분포 (합격자 강조) ─────────
  const SCORE_BUCKETS = [
    { label: "~49", lo: 0, hi: 50 },
    { label: "50s", lo: 50, hi: 60 },
    { label: "60s", lo: 60, hi: 70 },
    { label: "70s", lo: 70, hi: 80 },
    { label: "80s", lo: 80, hi: 90 },
    { label: "90+", lo: 90, hi: 101 },
  ];
  const scoreBars = SCORE_BUCKETS.map((b) => {
    let value = 0;
    let hi = 0;
    for (const c of cands) {
      if (c.screeningScore == null) continue;
      if (c.screeningScore >= b.lo && c.screeningScore < b.hi) {
        value++;
        if (c.outcome === "hired") hi++;
      }
    }
    return { label: b.label, value, hi };
  });
  const hasScores = scoreBars.some((b) => b.value > 0);

  // ───────── 지원자 풀: 최종학력 ─────────
  const eduBucket = (level: string | null) => {
    if (!level) return "미상";
    if (level.includes("박사")) return "박사";
    if (level.includes("석사")) return "석사";
    if (level.includes("전문")) return "전문학사";
    if (level.includes("학사")) return "학사";
    if (level.includes("고졸") || level.includes("고등")) return "고졸";
    return "기타";
  };
  const eduCounts: Record<string, number> = {};
  for (const c of cands) {
    const b = eduBucket(c.educationLevel);
    eduCounts[b] = (eduCounts[b] ?? 0) + 1;
  }
  const EDU_ORDER = ["박사", "석사", "학사", "전문학사", "고졸", "기타", "미상"];
  const EDU_COLOR: Record<string, string> = {
    박사: C.primary,
    석사: C.good,
    학사: "#7faf9b",
    전문학사: "#a9c2b6",
    고졸: "#cfc7b5",
    기타: "#d3d1c7",
    미상: "#e6e0d3",
  };
  const eduData = EDU_ORDER.filter((k) => eduCounts[k]).map((k) => ({
    label: k,
    value: eduCounts[k],
    color: EDU_COLOR[k],
  }));
  const hasEdu = cands.some((c) => c.educationLevel);

  // ───────── 지원자 풀: 경력년수 분포 (합격자 강조) ─────────
  const CAREER_BUCKETS: { label: string; f: (y: number | null) => boolean }[] =
    [
      { label: "신입", f: (y) => y != null && y <= 0 },
      { label: "1-3년", f: (y) => y != null && y >= 1 && y <= 3 },
      { label: "4-6년", f: (y) => y != null && y >= 4 && y <= 6 },
      { label: "7-10년", f: (y) => y != null && y >= 7 && y <= 10 },
      { label: "10년+", f: (y) => y != null && y > 10 },
      { label: "미상", f: (y) => y == null },
    ];
  const careerBars = CAREER_BUCKETS.map((b) => ({
    label: b.label,
    value: cands.filter((c) => b.f(c.careerYears)).length,
    hi: hired.filter((c) => b.f(c.careerYears)).length,
  }));
  const hasCareer = cands.some((c) => c.careerYears != null);

  // ───────── 지원자 풀: 서류 4축 (전체 vs 합격자) ─────────
  const SCREEN_AXES: {
    key: "tech_fit" | "experience_depth" | "role_match" | "growth_attitude";
    label: string;
  }[] = [
    { key: "tech_fit", label: "기술적합" },
    { key: "experience_depth", label: "경험깊이" },
    { key: "role_match", label: "직무부합" },
    { key: "growth_attitude", label: "성장태도" },
  ];
  const radarAvg = (filter: (c: (typeof cands)[number]) => boolean) => {
    const sums = [0, 0, 0, 0];
    const counts = [0, 0, 0, 0];
    for (const c of cands) {
      const bd = c.screeningReport?.breakdown;
      if (!bd || !filter(c)) continue;
      SCREEN_AXES.forEach((a, i) => {
        const v = bd[a.key]?.score;
        if (typeof v === "number") {
          sums[i] += v;
          counts[i]++;
        }
      });
    }
    return SCREEN_AXES.map((_, i) =>
      counts[i] > 0 ? Math.round(sums[i] / counts[i]) : 0
    );
  };
  const hasScreenBreakdown = cands.some((c) => c.screeningReport?.breakdown);
  const radarAll = radarAvg(() => true);
  const radarHired = radarAvg((c) => c.outcome === "hired");

  // ───────── 전형 소요 시간 (단계별 누적) ─────────
  const screenJobRows = await db
    .select({
      candidateId: screeningJobs.candidateId,
      completedAt: screeningJobs.completedAt,
    })
    .from(screeningJobs)
    .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
    .where(and(eq(candidates.jobId, jobId), eq(screeningJobs.status, "done")));
  const screenDoneAt = new Map<number, string>();
  for (const r of screenJobRows) {
    if (r.completedAt) screenDoneAt.set(r.candidateId, r.completedAt);
  }
  const avgDays = (
    getEnd: (c: (typeof cands)[number]) => string | null | undefined
  ) => {
    let s = 0;
    let n = 0;
    for (const c of cands) {
      const end = getEnd(c);
      if (!end) continue;
      const d =
        (new Date(end).getTime() - new Date(c.createdAt).getTime()) / DAY;
      if (d >= 0 && Number.isFinite(d)) {
        s += d;
        n++;
      }
    }
    return n > 0 ? s / n : null;
  };
  const tScreen = avgDays((c) => screenDoneAt.get(c.id));
  const tAiDone = avgDays((c) => sessionByCand.get(c.id)?.completedAt);
  const tDecide = avgDays((c) => c.decidedAt);
  const durRows = (
    [
      { label: "지원 → 서류평가", v: tScreen },
      { label: "지원 → AI면접 완료", v: tAiDone },
      { label: "지원 → 최종 결정", v: tDecide },
    ] as { label: string; v: number | null }[]
  ).filter((r): r is { label: string; v: number } => r.v != null);
  const durMax = Math.max(1, ...durRows.map((r) => r.v));

  // 응답·운영 지표
  const respDays: number[] = [];
  for (const c of cands) {
    const sess = sessionByCand.get(c.id);
    if (!c.lastInterviewEmailSentAt || !sess?.startedAt) continue;
    const d =
      (new Date(sess.startedAt).getTime() -
        new Date(c.lastInterviewEmailSentAt).getTime()) /
      DAY;
    if (d >= 0 && Number.isFinite(d)) respDays.push(d);
  }
  const respAvg =
    respDays.length > 0
      ? Math.round((respDays.reduce((a, b) => a + b, 0) / respDays.length) * 10) /
        10
      : null;
  const emailCounts = cands
    .map((c) => c.interviewEmailCount ?? 0)
    .filter((n) => n > 0);
  const avgEmail =
    emailCounts.length > 0
      ? Math.round(
          (emailCounts.reduce((a, b) => a + b, 0) / emailCounts.length) * 10
        ) / 10
      : null;
  const expiredCnt = cands.filter(
    (c) => c.outcomeReason === "ai_link_expired"
  ).length;
  const withdrawnRate =
    totalCount > 0 ? Math.round((withdrawnCount / totalCount) * 100) : null;

  // 가장 오래 걸린 구간 + 원인
  const g1 = tScreen;
  const g2 = tAiDone != null && tScreen != null ? tAiDone - tScreen : null;
  const g3 = tDecide != null && tAiDone != null ? tDecide - tAiDone : null;
  const gaps = (
    [
      { label: "서류 평가", v: g1, cause: "이력서 도착 후 AI 서류 평가까지" },
      {
        label: "AI 면접 응답·완료",
        v: g2,
        cause:
          respAvg != null
            ? `지원자 응답 대기(평균 ${respAvg}일)가 주 원인`
            : "지원자 응답·면접 진행 대기",
      },
      { label: "최종 결정", v: g3, cause: "면접관 검토·합격 결정 단계" },
    ] as { label: string; v: number | null; cause: string }[]
  ).filter((x): x is { label: string; v: number; cause: string } => x.v != null && x.v > 0.05);
  gaps.sort((a, b) => b.v - a.v);
  const timingCause =
    gaps.length > 0
      ? `가장 오래 걸린 구간은 「${gaps[0].label}」로 약 ${gaps[0].v.toFixed(
          1
        )}일 — ${gaps[0].cause}.`
      : null;

  const show03 = hasEdu || hasCareer || hasScores || hasScreenBreakdown;
  const show04 =
    durRows.length > 0 ||
    avgEmail != null ||
    expiredCnt > 0 ||
    respAvg != null ||
    withdrawnCount > 0;

  // ───────── 합격자 dossier ─────────
  const hiredCards = hired.map((c) => {
    const paper = c.screeningScore ?? null;
    const sess = sessionByCand.get(c.id);
    const ai = sess?.overall ?? null;
    const hk = humanByCand.get(c.id);
    const human = hk && hk.n > 0 ? Math.round(hk.sum / hk.n) : null;
    const present = [paper, ai, human].filter((v): v is number => v != null);
    const overall =
      present.length > 0
        ? Math.round(present.reduce((a, b) => a + b, 0) / present.length)
        : null;
    const bd = c.screeningReport?.breakdown;
    const axisVals = [
      bd?.tech_fit?.score,
      bd?.experience_depth?.score,
      bd?.role_match?.score,
      bd?.growth_attitude?.score,
    ];
    const hasAxes = axisVals.every((v): v is number => typeof v === "number");
    const ev = sess?.evaluation;
    const sr = c.screeningReport;
    const opinion = ev?.summary?.trim() || sr?.summary?.trim() || null;
    const strengths = (
      ev?.strengths?.length ? ev.strengths : sr?.strengths ?? []
    ).slice(0, 3);
    const concerns = (
      ev?.concerns?.length ? ev.concerns : sr?.concerns ?? []
    ).slice(0, 2);
    return {
      id: c.id,
      name: c.name,
      careerYears: c.careerYears,
      educationLevel: c.educationLevel,
      rec: sr?.recommendation ?? null,
      paper,
      ai,
      human,
      overall,
      axisVals: hasAxes ? (axisVals as number[]) : null,
      keywords: (sr?.matched_keywords ?? []).slice(0, 6),
      opinion,
      strengths,
      concerns,
    };
  });
  const hiredOveralls = hiredCards
    .map((h) => h.overall)
    .filter((v): v is number => v != null);
  const avgHiredOverall =
    hiredOveralls.length > 0
      ? Math.round(
          hiredOveralls.reduce((a, b) => a + b, 0) / hiredOveralls.length
        )
      : null;

  // ───────── 요약 내러티브 (규칙 기반, LLM 미사용) ─────────
  const qualitySentence =
    avgHiredScreening != null && avgScreening != null
      ? avgHiredScreening - avgScreening >= 5
        ? `합격자 서류 평균 ${avgHiredScreening}점으로 전체 평균(${avgScreening}점)을 크게 웃돌아, 상위권에서 채용이 이루어졌습니다.`
        : avgHiredScreening - avgScreening <= -5
          ? `합격자 서류 평균은 ${avgHiredScreening}점으로 전체 평균(${avgScreening}점)보다 낮아, 서류 외 면접 요소가 결정적이었습니다.`
          : `합격자 서류 평균은 ${avgHiredScreening}점으로 전체 평균(${avgScreening}점)과 유사합니다.`
      : null;
  const bottleneckSentence =
    bottleneck && bottleneck.conv < 70 && totalCount > 0
      ? `가장 큰 이탈은 ${bottleneck.label} 단계로, 직전 단계 대비 ${bottleneck.conv}%만 통과했습니다.`
      : null;
  const summaryParts: ReactNode[] = [];
  if (totalCount === 0) {
    summaryParts.push(<>아직 지원자가 없습니다.</>);
  } else {
    if (hiredCount > 0) {
      summaryParts.push(
        <>
          지원 <b className="font-medium text-primary">{totalCount}명</b> 가운데{" "}
          <b className="font-medium text-primary">{hiredCount}명</b>을 최종
          선발했습니다(합격률 {hireRate}).
        </>
      );
    } else {
      summaryParts.push(
        <>
          지원 <b className="font-medium text-primary">{totalCount}명</b> 중 현재{" "}
          <b className="font-medium">{inProgressCount}명</b> 진행 중이며, 최종
          합격자는 아직 없습니다.
        </>
      );
    }
    if (avgCycleDays != null)
      summaryParts.push(
        <>
          {" "}
          평균 처리 기간은 <b className="font-medium">{avgCycleDays}일</b>.
        </>
      );
    if (qualitySentence) summaryParts.push(<> {qualitySentence}</>);
    if (bottleneckSentence) summaryParts.push(<> {bottleneckSentence}</>);
  }

  const periodText = `${formatLocalDate(job.createdAt)} — ${
    job.closedAt
      ? formatLocalDate(job.closedAt)
      : job.closesAt
        ? `${formatLocalDate(job.closesAt)} 예정`
        : "진행 중"
  }`;

  return (
    <main className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 print:px-0 print:py-0 print:max-w-none">
      <div className="flex items-center justify-between mb-4 print:hidden">
        <Link
          href={`/jobs/${jobId}`}
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← 공고로 돌아가기
        </Link>
        <PrintButton />
      </div>

      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden print:border-0 print:shadow-none print:rounded-none print:overflow-visible">
        <div className="h-[3px] bg-primary" />
        <div className="p-8 sm:p-11 print:p-0">
          {/* ── 표지 ── */}
          <header className="flex items-start justify-between gap-4 pb-5">
            <div>
              <div className="text-[10.5px] tracking-[0.2em] text-primary font-medium">
                CONFIDENTIAL — 채용 결과 리포트
              </div>
              <h1 className="text-[26px] sm:text-3xl font-semibold text-ink leading-tight mt-3">
                {job.title}
              </h1>
            </div>
            <div className="text-right text-[11px] text-ink-muted leading-relaxed pt-1 shrink-0">
              <div className="text-ink-soft font-medium text-[13px]">
                {org?.name ?? "-"}
              </div>
              <div>{periodText}</div>
              <div>{job.status === "closed" ? "종결" : "진행 중"}</div>
            </div>
          </header>
          <div className="flex flex-wrap gap-x-7 gap-y-1 text-[11.5px] text-ink-muted pb-5 border-b border-border-default">
            <span>
              <span className="text-ink-muted/70">직무</span>&nbsp;&nbsp;
              {job.position} · {job.level} · {job.employmentType}
            </span>
            <span>
              <span className="text-ink-muted/70">면접</span>&nbsp;&nbsp;
              {job.interviewDurationMinutes}분
            </span>
            {interviewers.length > 0 && (
              <span>
                <span className="text-ink-muted/70">면접관</span>&nbsp;&nbsp;
                {interviewers.map((i) => i.name).join(", ")}
              </span>
            )}
          </div>

          {/* ── 요약 ── */}
          <div className="py-7">
            <div className="text-[10.5px] tracking-[0.18em] text-primary font-medium mb-3">
              요약
            </div>
            <p className="text-[15px] sm:text-base leading-[1.75] text-ink">
              {summaryParts}
            </p>
          </div>

          {/* ── KPI 밴드 ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 border-y border-border-default divide-x divide-border-default">
            <KpiCell label="총 지원자" value={`${totalCount}`} unit="명" />
            <KpiCell
              label="최종 합격"
              value={`${hiredCount}`}
              unit="명"
              sub={`합격률 ${hireRate}`}
              primary
            />
            <KpiCell
              label="평균 처리"
              value={avgCycleDays != null ? `${avgCycleDays}` : "-"}
              unit={avgCycleDays != null ? "일" : ""}
              sub={`결정 ${decidedCands.length}건`}
            />
            <KpiCell
              label="AI 응답률"
              value={aiResponseRate != null ? `${aiResponseRate}` : "-"}
              unit={aiResponseRate != null ? "%" : ""}
              sub={aiSent > 0 ? `${aiSent} → ${aiResponded}명` : undefined}
            />
          </div>

          {/* ── 01 최종 합격자 ── */}
          <Section
            n="01"
            title="최종 합격자"
            sub={
              hired.length > 0
                ? `${hired.length}명${
                    avgHiredOverall != null
                      ? ` · 평균 종합 ${avgHiredOverall}점`
                      : ""
                  }`
                : undefined
            }
            desc="누구를, 어떤 평가로 선발했는가"
          >
            {hired.length === 0 ? (
              <p className="text-sm text-ink-muted">
                아직 최종 합격자가 없습니다. (진행 중 {inProgressCount}명)
              </p>
            ) : (
              <div className="space-y-4">
                {hiredCards.map((h) => (
                  <HiredCard key={h.id} h={h} />
                ))}
              </div>
            )}
          </Section>

          {/* ── 02 채용 퍼널 ── */}
          {totalCount > 0 && (
            <Section
              n="02"
              title="채용 퍼널"
              desc="단계별 통과 인원 · 직전 단계 대비 전환율"
            >
              <div className="space-y-2.5">
                {funnel.map((f, i) => {
                  const base = funnel[0].count || 1;
                  const widthPct = (f.count / base) * 100;
                  const stepConv =
                    i === 0
                      ? null
                      : funnel[i - 1].count > 0
                        ? Math.round((f.count / funnel[i - 1].count) * 100)
                        : 0;
                  const isBottleneck =
                    bottleneck != null &&
                    f.label === bottleneck.label &&
                    bottleneck.conv < 70;
                  const op = 0.95 - 0.6 * (i / (funnel.length - 1));
                  return (
                    <div
                      key={f.label}
                      className="flex items-center gap-3.5 text-xs"
                    >
                      <span className="w-[88px] shrink-0 text-ink-soft">
                        {f.label}
                      </span>
                      <div className="flex-1 bg-surface-alt rounded h-[26px] relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded"
                          style={{
                            width: `${widthPct}%`,
                            background: C.primary,
                            opacity: op,
                          }}
                        />
                        <span
                          className="absolute inset-0 flex items-center pl-2.5 text-[11px] font-medium tabular-nums"
                          style={{ color: widthPct > 22 ? "#fff" : C.ink }}
                        >
                          {f.count}명
                        </span>
                      </div>
                      <span className="w-[120px] shrink-0 text-[11px] tabular-nums text-ink-muted">
                        {stepConv != null && `전환 ${stepConv}%`}
                        {isBottleneck && (
                          <span style={{ color: C.warn }}> ← 최대 이탈</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6">
                <div className="text-[11px] text-ink-muted mb-2">결과 분포</div>
                <StackBar
                  total={totalCount}
                  segments={[
                    { label: "최종 합격", count: hiredCount, color: C.primary },
                    { label: "진행 중", count: inProgressCount, color: C.good },
                    { label: "불합격", count: rejectedCount, color: "#b4b2a9" },
                    {
                      label: "지원 취소",
                      count: withdrawnCount,
                      color: "#d3d1c7",
                    },
                  ]}
                />
              </div>
            </Section>
          )}

          {/* ── 03 지원자 풀 ── */}
          {show03 && (
            <Section
              n="03"
              title="지원자 풀"
              desc="어떤 지원자들이 지원했는가 · 합격자 위치"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8 [&>div]:print:break-inside-avoid">
                {hasEdu && (
                  <div>
                    <div className="text-[11px] text-ink-muted mb-3">
                      최종학력 분포 (전체 지원자)
                    </div>
                    <Donut data={eduData} />
                  </div>
                )}
                {hasCareer && (
                  <div>
                    <div className="text-[11px] text-ink-muted mb-3">
                      경력년수 분포 (합격자 강조)
                    </div>
                    <VBars
                      bars={careerBars}
                      color={C.primarySoft}
                      hiColor={C.primary}
                      baseLabel="전체"
                      hiLabel="최종 합격"
                      height={130}
                    />
                  </div>
                )}
                {hasScores && (
                  <div>
                    <div className="text-[11px] text-ink-muted mb-3">
                      서류 점수 분포 (합격자 강조)
                    </div>
                    <VBars
                      bars={scoreBars}
                      color={C.primarySoft}
                      hiColor={C.primary}
                      baseLabel="전체"
                      hiLabel="최종 합격"
                      height={140}
                    />
                  </div>
                )}
                {hasScreenBreakdown && (
                  <div>
                    <div className="text-[11px] text-ink-muted mb-3">
                      서류 4축 프로필 (전체 vs 합격자)
                    </div>
                    <Radar
                      axes={SCREEN_AXES.map((a) => a.label)}
                      series={[
                        { label: "전체 평균", color: C.good, values: radarAll },
                        ...(hiredCount > 0
                          ? [
                              {
                                label: "합격자 평균",
                                color: C.primary,
                                values: radarHired,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* ── 04 전형 소요 시간 ── */}
          {show04 && (
            <Section
              n="04"
              title="전형 소요 시간"
              desc="단계별 누적 소요와 지연 원인"
            >
              {durRows.length > 0 ? (
                <HBars
                  rows={durRows.map((r) => ({
                    label: r.label,
                    value: r.v,
                    max: durMax,
                    display: `${r.v.toFixed(1)}일`,
                    color: C.good,
                  }))}
                />
              ) : (
                <p className="text-xs text-ink-muted">소요 시간 데이터 없음</p>
              )}
              {timingCause && (
                <p className="text-[11.5px] text-ink-soft mt-3 leading-relaxed">
                  {timingCause}
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border-default border border-border-default rounded-2xl overflow-hidden mt-5 print:break-inside-avoid">
                <OpsCell
                  label="평균 응답 대기"
                  value={respAvg != null ? `${respAvg}` : "-"}
                  unit={respAvg != null ? "일" : ""}
                />
                <OpsCell
                  label="평균 발송 횟수"
                  value={avgEmail != null ? `${avgEmail}` : "-"}
                  unit={avgEmail != null ? "회" : ""}
                />
                <OpsCell label="링크 만료" value={`${expiredCnt}`} unit="명" />
                <OpsCell
                  label="지원자 취소율"
                  value={withdrawnRate != null ? `${withdrawnRate}` : "-"}
                  unit={withdrawnRate != null ? "%" : ""}
                />
              </div>
            </Section>
          )}

          {/* ── 푸터 ── */}
          <footer className="mt-10 pt-4 border-t border-border-default text-[10px] text-ink-muted flex justify-between tracking-wide">
            <span>생성 {formatKstDateTime(new Date().toISOString())}</span>
            <span>Intervia · {org?.name ?? ""}</span>
          </footer>
        </div>
      </div>
    </main>
  );
}

/* ───────────────────────── 하위 컴포넌트 ───────────────────────── */

function Section({
  n,
  title,
  sub,
  desc,
  children,
}: {
  n: string;
  title: string;
  sub?: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline gap-3">
        <span className="text-xs font-semibold text-primary tabular-nums">
          {n}
        </span>
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        {sub && <span className="text-xs text-ink-muted">{sub}</span>}
      </div>
      {desc && (
        <div className="text-[11.5px] text-ink-muted mt-1 ml-[27px] mb-4">
          {desc}
        </div>
      )}
      <div className={desc ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

function KpiCell({
  label,
  value,
  unit,
  sub,
  primary,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  primary?: boolean;
}) {
  return (
    <div className="px-4 sm:px-5 py-5">
      <div
        className={`text-[10.5px] tracking-wide ${
          primary ? "text-primary" : "text-ink-muted"
        }`}
      >
        {label}
      </div>
      <div
        className={`text-4xl font-semibold tabular-nums tracking-tight mt-1 ${
          primary ? "text-primary" : "text-ink"
        }`}
      >
        {value}
        {unit && (
          <span className="text-base font-normal text-ink-muted"> {unit}</span>
        )}
      </div>
      {sub && (
        <div
          className={`text-[11px] mt-0.5 ${
            primary ? "text-primary/80" : "text-ink-muted"
          }`}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function OpsCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="bg-card px-4 py-4">
      <div className="text-[10.5px] text-ink-muted">{label}</div>
      <div className="text-[22px] font-semibold text-ink tabular-nums mt-1">
        {value}
        {unit && (
          <span className="text-xs font-normal text-ink-muted">{unit}</span>
        )}
      </div>
    </div>
  );
}

function ScoreRow({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-16 shrink-0 text-ink-soft">{label}</span>
      <div className="flex-1 bg-surface-alt rounded h-5 relative overflow-hidden">
        {score != null && (
          <div
            className="absolute inset-y-0 left-0 rounded"
            style={{ width: `${score}%`, background: C.primary, opacity: 0.85 }}
          />
        )}
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums font-medium text-ink">
        {score ?? "—"}
      </span>
    </div>
  );
}

// LLM 요약(screeningReport/evaluation summary)은 마크다운 **볼드** 를 포함할 수 있다.
function renderBold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    return m ? (
      <strong key={i} className="font-medium text-ink">
        {m[1]}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

function HiredCard({
  h,
}: {
  h: {
    id: number;
    name: string;
    careerYears: number | null;
    educationLevel: string | null;
    rec: string | null;
    paper: number | null;
    ai: number | null;
    human: number | null;
    overall: number | null;
    axisVals: number[] | null;
    keywords: string[];
    opinion: string | null;
    strengths: string[];
    concerns: string[];
  };
}) {
  const meta = [
    h.careerYears != null ? `${h.careerYears}년` : null,
    h.educationLevel,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasQual = h.strengths.length > 0 || h.concerns.length > 0;
  return (
    <div className="rounded-2xl border border-border-default bg-card p-6 print:break-inside-avoid">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-full bg-primary-soft text-primary-deep flex items-center justify-center text-base font-medium shrink-0">
            {h.name?.[0] ?? "?"}
          </div>
          <div className="min-w-0">
            <div className="text-[17px] font-medium text-ink truncate">
              {h.name}
            </div>
            <div className="text-xs text-ink-muted mt-0.5 truncate">
              {meta}
              {h.rec && (
                <>
                  {meta && " · "}
                  <span className="text-primary">{h.rec}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10.5px] tracking-wide text-ink-muted">종합</div>
          <div className="text-[32px] leading-none font-semibold text-primary tabular-nums tracking-tight">
            {h.overall ?? "—"}
            <span className="text-[13px] font-normal text-ink-muted tracking-normal">
              {" "}
              /100
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-border-default my-4" />

      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-6 items-center">
        {h.axisVals ? (
          <Radar
            axes={["기술", "경험", "직무", "성장"]}
            series={[
              { label: "서류 4축", color: C.primary, values: h.axisVals },
            ]}
            size={172}
          />
        ) : (
          <div className="text-[11px] text-ink-muted">서류 4축 데이터 없음</div>
        )}
        <div>
          <div className="text-[10.5px] tracking-wide text-ink-muted mb-3">
            단계별 점수
          </div>
          <div className="space-y-2.5">
            <ScoreRow label="서류" score={h.paper} />
            <ScoreRow label="AI 면접" score={h.ai} />
            <ScoreRow label="대면" score={h.human} />
          </div>
        </div>
      </div>

      {h.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-5">
          {h.keywords.map((k) => (
            <span
              key={k}
              className="text-[11px] text-primary bg-primary-soft px-2.5 py-0.5 rounded-full"
            >
              {k}
            </span>
          ))}
        </div>
      )}

      {(h.opinion || hasQual) && (
        <div className="mt-5 pt-4 border-t border-border-default space-y-4">
          {h.opinion && (
            <div>
              <div className="text-[10.5px] tracking-wide text-primary mb-1.5">
                AI 종합 의견
              </div>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                {renderBold(h.opinion)}
              </p>
            </div>
          )}
          {hasQual && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {h.strengths.length > 0 && (
                <QualList label="강점" items={h.strengths} tone="primary" />
              )}
              {h.concerns.length > 0 && (
                <QualList label="보완점" items={h.concerns} tone="muted" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QualList({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "primary" | "muted";
}) {
  return (
    <div>
      <div
        className={`text-[10.5px] tracking-wide mb-1.5 ${
          tone === "primary" ? "text-primary" : "text-ink-muted"
        }`}
      >
        {label}
      </div>
      <ul className="space-y-1">
        {items.map((s, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed">
            <span className="text-ink-muted shrink-0">·</span>
            <span className="text-ink-soft">{renderBold(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StackBar({
  segments,
  total,
}: {
  segments: { label: string; count: number; color: string }[];
  total: number;
}) {
  if (total === 0) return null;
  return (
    <>
      <div className="flex h-7 rounded overflow-hidden">
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.label}
              className="relative flex items-center justify-center"
              style={{
                width: `${(s.count / total) * 100}%`,
                background: s.color,
              }}
              title={`${s.label} ${s.count}명`}
            >
              {s.count / total > 0.08 && (
                <span className="text-[10px] text-white font-medium tabular-nums">
                  {s.count}
                </span>
              )}
            </div>
          ) : null
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px]">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: s.color }}
            />
            <span className="text-ink-soft">
              {s.label} <strong className="text-ink">{s.count}</strong>
              {total > 0 && (
                <span className="text-ink-muted">
                  {" "}
                  ({Math.round((s.count / total) * 1000) / 10}%)
                </span>
              )}
            </span>
          </span>
        ))}
      </div>
    </>
  );
}

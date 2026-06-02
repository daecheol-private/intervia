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
} from "@/lib/schema";
import { and, eq, sql, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg } from "@/lib/tenant";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { formatKstDateTime, formatLocalDate } from "@/lib/utils";
import { STAGE_RANK, type Stage } from "@/lib/stage-meta";
import { PrintButton } from "./PrintButton";
import { Donut, Radar, Scatter, VBars, HBars, DotTrend, C, CATEGORICAL } from "@/components/charts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STAGE_LABEL: Record<string, string> = {
  applied: "지원",
  screened: "서류평가 완료",
  ai_pending: "AI 면접 대기",
  ai_evaluated: "AI 면접 완료",
  round1_candidate: "1차 면접 후보",
  round1_scheduling: "1차 면접 일정 조율",
  round1_waiting: "1차 면접 대기",
  round1_passed: "1차 합격",
  round2_passed: "2차 합격",
  hired: "최종 합격",
  rejected: "불합격",
  withdrawn: "지원 취소",
};

const OUTCOME_LABEL: Record<string, string> = {
  hired: "최종 합격",
  rejected: "불합격",
  withdrawn: "지원 취소",
};

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

  // 후보자 전체
  const cands = await db
    .select()
    .from(candidates)
    .where(eq(candidates.jobId, jobId))
    .orderBy(desc(candidates.screeningScore));

  // 단계별 집계 + outcome 별 집계
  const stageCounts: Record<string, number> = {};
  const outcomeCounts: Record<string, number> = {};
  const outcomeByStage: Record<string, Record<string, number>> = {};
  let totalScreeningScore = 0;
  let countWithScreening = 0;
  let hiredScreeningSum = 0;
  let hiredScreeningCount = 0;
  const recCounts: Record<string, number> = {
    추천: 0,
    중립: 0,
    비추천: 0,
  };
  for (const c of cands) {
    stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1;
    if (c.outcome) {
      outcomeCounts[c.outcome] = (outcomeCounts[c.outcome] ?? 0) + 1;
      const fromStage = c.decisionFromStage ?? c.stage;
      outcomeByStage[c.outcome] ??= {};
      outcomeByStage[c.outcome][fromStage] =
        (outcomeByStage[c.outcome][fromStage] ?? 0) + 1;
    }
    if (c.screeningScore != null) {
      totalScreeningScore += c.screeningScore;
      countWithScreening++;
      if (c.outcome === "hired") {
        hiredScreeningSum += c.screeningScore;
        hiredScreeningCount++;
      }
    }
    const rec = c.screeningReport?.recommendation;
    if (rec && rec in recCounts) recCounts[rec] += 1;
  }
  const avgScreening =
    countWithScreening > 0
      ? Math.round(totalScreeningScore / countWithScreening)
      : null;
  const avgHiredScreening =
    hiredScreeningCount > 0
      ? Math.round(hiredScreeningSum / hiredScreeningCount)
      : null;

  // AI 면접 평가 영역별 평균
  const sessions = await db
    .select({
      candidateId: interviewSessions.candidateId,
      evaluation: interviewSessions.evaluation,
      status: interviewSessions.status,
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
  let evalCount = 0;
  let overallSum = 0;
  const recCountsInterview: Record<string, number> = {
    강력추천: 0,
    추천: 0,
    보류: 0,
    비추천: 0,
  };
  for (const s of sessions) {
    const e = s.evaluation;
    if (!e) continue;
    evalCount++;
    overallSum += e.overall_score ?? 0;
    if (e.recommendation && e.recommendation in recCountsInterview) {
      recCountsInterview[e.recommendation] += 1;
    }
  }
  const avgInterview =
    evalCount > 0 ? Math.round(overallSum / evalCount) : null;

  // 평균 처리 시간
  const decidedCands = cands.filter((c) => c.decidedAt != null);
  const avgCycleDays =
    decidedCands.length > 0
      ? (
          decidedCands.reduce(
            (s, c) =>
              s +
              (new Date(c.decidedAt!).getTime() -
                new Date(c.createdAt).getTime()) /
                86_400_000,
            0
          ) / decidedCands.length
        ).toFixed(1)
      : null;

  // 면접관
  const interviewers = await db
    .select({ name: users.name, email: users.email })
    .from(jobInterviewers)
    .innerJoin(users, eq(users.id, jobInterviewers.userId))
    .where(eq(jobInterviewers.jobId, jobId));

  // 합격자 명단
  const hired = cands.filter((c) => c.outcome === "hired");

  const totalCount = cands.length;
  const hiredCount = outcomeCounts["hired"] ?? 0;
  const rejectedCount = outcomeCounts["rejected"] ?? 0;
  const withdrawnCount = outcomeCounts["withdrawn"] ?? 0;
  const inProgressCount =
    totalCount - hiredCount - rejectedCount - withdrawnCount;
  const hireRate =
    totalCount > 0
      ? `${Math.round((hiredCount / totalCount) * 1000) / 10}%`
      : "-";

  // 단계 통과 후보 카운트 (응답률 계산용 — funnel 과 동일 로직)
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

  // ───────────────────── 확장 리포트 데이터 ─────────────────────
  const DAY = 86_400_000;

  // 면접관 스코어카드 (사람 면접 평가)
  const notes = await db
    .select({
      authorId: interviewerNotes.authorUserId,
      author: users.name,
      scores: interviewerNotes.scores,
    })
    .from(interviewerNotes)
    .innerJoin(candidates, eq(candidates.id, interviewerNotes.candidateId))
    .innerJoin(users, eq(users.id, interviewerNotes.authorUserId))
    .where(eq(candidates.jobId, jobId));

  // 서류평가 완료 시각 (지원→서류 소요 계산용)
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

  // AI 면접: 후보별 종합점수 + 타이밍
  const sessionByCand = new Map<
    number,
    { overall: number | null; startedAt: string | null; completedAt: string | null }
  >();
  for (const s of sessions) {
    sessionByCand.set(s.candidateId, {
      overall: s.evaluation?.overall_score ?? null,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
    });
  }

  // 후보가 실제로 도달한 단계 rank (불합격/지원취소는 결정 직전 단계 기준, 최종합격=100)
  const rankOf = (c: (typeof cands)[number]) => {
    if (c.outcome === "hired") return 100;
    if (c.stage === "rejected" || c.stage === "withdrawn") {
      const f = c.decisionFromStage as Stage | null;
      return f ? STAGE_RANK[f] ?? 10 : 10;
    }
    return STAGE_RANK[c.stage as Stage] ?? 10;
  };

  // (A) 채용 퍼널 — 누적 통과자
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

  // (B) 점수 분포 히스토그램 (합격자 강조)
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

  // (B) 산점도 — 서류 vs AI면접 점수
  const scatterPts: {
    x: number;
    y: number;
    color: string;
    title: string;
  }[] = [];
  for (const c of cands) {
    const sess = sessionByCand.get(c.id);
    if (c.screeningScore == null || sess?.overall == null) continue;
    scatterPts.push({
      x: c.screeningScore,
      y: sess.overall,
      color:
        c.outcome === "hired"
          ? C.primary
          : c.outcome === "rejected"
            ? C.danger
            : C.muted,
      title: `${c.name}: 서류 ${c.screeningScore} / 면접 ${sess.overall}`,
    });
  }

  // (B) 레이더 — 서류 4축 (전체 vs 합격자)
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

  // (C) 단계별 평균 소요시간 (지원 기준 누적, 일)
  const avgDays = (getEnd: (c: (typeof cands)[number]) => string | null | undefined) => {
    let s = 0;
    let n = 0;
    for (const c of cands) {
      const end = getEnd(c);
      if (!end) continue;
      const d = (new Date(end).getTime() - new Date(c.createdAt).getTime()) / DAY;
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
  let aiDurSum = 0;
  let aiDurN = 0;
  for (const s of sessions) {
    if (s.startedAt && s.completedAt) {
      const m =
        (new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime()) /
        60000;
      if (m > 0 && m < 600) {
        aiDurSum += m;
        aiDurN++;
      }
    }
  }
  const aiDurMin = aiDurN > 0 ? Math.round(aiDurSum / aiDurN) : null;
  const durRows = [
    { label: "→ 서류평가", v: tScreen },
    { label: "→ AI면접 완료", v: tAiDone },
    { label: "→ 최종 결정", v: tDecide },
  ].filter((r) => r.v != null) as { label: string; v: number }[];
  const durMax = Math.max(1, ...durRows.map((r) => r.v));

  // (C) 결정 리드타임 추이
  const decidedSorted = decidedCands
    .slice()
    .sort(
      (a, b) =>
        new Date(a.decidedAt!).getTime() - new Date(b.decidedAt!).getTime()
    );
  const leadPts = decidedSorted.map((c, i) => {
    const y =
      (new Date(c.decidedAt!).getTime() - new Date(c.createdAt).getTime()) / DAY;
    return {
      t: decidedSorted.length > 1 ? i / (decidedSorted.length - 1) : 0.5,
      y,
      color:
        c.outcome === "hired"
          ? C.primary
          : c.outcome === "rejected"
            ? C.danger
            : C.muted,
      title: `${c.name}: ${y.toFixed(1)}일`,
    };
  });
  const leadMax = Math.max(1, ...leadPts.map((p) => p.y));

  // (D) 운영 건강도 — AI 면접 링크 결과
  let respCnt = 0;
  let waitCnt = 0;
  let expiredCnt = 0;
  let otherEndCnt = 0;
  for (const c of cands) {
    const sent = (c.interviewEmailCount ?? 0) > 0 || rankOf(c) >= 30;
    if (!sent) continue;
    if (rankOf(c) >= 40) respCnt++;
    else if (c.outcomeReason === "ai_link_expired") expiredCnt++;
    else if (c.outcome == null && c.stage === "ai_pending") waitCnt++;
    else otherEndCnt++;
  }
  const linkSentTotal = respCnt + waitCnt + expiredCnt + otherEndCnt;
  const emailCounts = cands
    .map((c) => c.interviewEmailCount ?? 0)
    .filter((n) => n > 0);
  const avgEmail =
    emailCounts.length > 0
      ? Math.round(
          (emailCounts.reduce((a, b) => a + b, 0) / emailCounts.length) * 10
        ) / 10
      : null;
  const nearLimit = cands.filter((c) => (c.interviewEmailCount ?? 0) >= 8).length;

  // (D) 응답까지 소요시간 (발송→응답, 근사) 히스토그램
  const RESP_BUCKETS = [
    { label: "<1일", lo: 0, hi: 1 },
    { label: "1-2일", lo: 1, hi: 3 },
    { label: "3-4일", lo: 3, hi: 5 },
    { label: "5-7일", lo: 5, hi: 8 },
    { label: "7일+", lo: 8, hi: 9999 },
  ];
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
  const respTimeBars = RESP_BUCKETS.map((b) => ({
    label: b.label,
    value: respDays.filter((d) => d >= b.lo && d < b.hi).length,
  }));

  // (E) 합격자 프로파일 — 최종학력
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
    학사: C.blue,
    전문학사: C.indigo,
    고졸: C.warn,
    기타: C.muted,
    미상: C.mutedSoft,
  };
  const eduData = EDU_ORDER.filter((k) => eduCounts[k]).map((k) => ({
    label: k,
    value: eduCounts[k],
    color: EDU_COLOR[k],
  }));
  const hasEdu = cands.some((c) => c.educationLevel);

  // (E) 경력년수 분포 (전체 vs 합격자)
  const CAREER_BUCKETS: { label: string; f: (y: number | null) => boolean }[] = [
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

  // (E) 서류 추천등급별 → 실제 합격
  const REC_GRADES: ("강력추천" | "추천" | "보류" | "비추천")[] = [
    "강력추천",
    "추천",
    "보류",
    "비추천",
  ];
  const REC_COLOR: Record<string, string> = {
    강력추천: C.primary,
    추천: C.good,
    보류: C.warn,
    비추천: C.muted,
  };
  const recRows = REC_GRADES.map((g) => {
    const inG = cands.filter((c) => c.screeningReport?.recommendation === g);
    return {
      grade: g,
      total: inG.length,
      hiredN: inG.filter((c) => c.outcome === "hired").length,
    };
  }).filter((r) => r.total > 0);
  const recMax = Math.max(1, ...recRows.map((r) => r.total));

  // (E) 합격 키워드 TOP
  const kwFreq = new Map<string, number>();
  for (const c of cands) {
    for (const k of c.screeningReport?.matched_keywords ?? []) {
      const key = k.trim();
      if (!key) continue;
      kwFreq.set(key, (kwFreq.get(key) ?? 0) + 1);
    }
  }
  const topKw = [...kwFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const kwMax = topKw.length > 0 ? topKw[0][1] : 1;

  // (F) 면접관 평가 비교
  const noteMean = (sc: typeof notes[number]["scores"]) => {
    const vals = [sc?.skill, sc?.experience, sc?.collaboration, sc?.fit].filter(
      (v): v is number => typeof v === "number"
    );
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const byAuthor = new Map<string, { name: string; sum: number; n: number }>();
  for (const nt of notes) {
    const a = noteMean(nt.scores);
    if (a == null) continue;
    const k = String(nt.authorId);
    const cur = byAuthor.get(k) ?? { name: nt.author ?? "면접관", sum: 0, n: 0 };
    cur.sum += a;
    cur.n++;
    byAuthor.set(k, cur);
  }
  const interviewerRows = [...byAuthor.values()].map((v) => ({
    label: v.name,
    value: Math.round(v.sum / v.n),
    max: 100,
    display: `${Math.round(v.sum / v.n)}점`,
    sub: `(${v.n}건)`,
    color: C.good,
  }));
  const HUMAN_AXES = ["역량", "경험", "협업", "적합"];
  const HUMAN_KEYS = ["skill", "experience", "collaboration", "fit"] as const;
  const hsum = [0, 0, 0, 0];
  const hn = [0, 0, 0, 0];
  for (const nt of notes) {
    HUMAN_KEYS.forEach((k, i) => {
      const v = nt.scores?.[k];
      if (typeof v === "number") {
        hsum[i] += v;
        hn[i]++;
      }
    });
  }
  const humanRadar = HUMAN_KEYS.map((_, i) =>
    hn[i] > 0 ? Math.round(hsum[i] / hn[i]) : 0
  );
  let humanOverallSum = 0;
  let humanOverallN = 0;
  for (const nt of notes) {
    const a = noteMean(nt.scores);
    if (a != null) {
      humanOverallSum += a;
      humanOverallN++;
    }
  }
  const humanOverall =
    humanOverallN > 0 ? Math.round(humanOverallSum / humanOverallN) : null;
  const hasNotes = interviewerRows.length > 0;

  return (
    <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 print:px-0 print:py-0 print:max-w-none">
      <div className="flex items-center justify-between mb-4 print:hidden">
        <Link
          href={`/jobs/${jobId}`}
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← 공고로 돌아가기
        </Link>
        <PrintButton />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm print:border-0 print:shadow-none print:rounded-none print:p-0">
        {/* 헤더 */}
        <header className="border-b border-slate-200 pb-5 mb-6">
          <div className="text-[11px] uppercase tracking-widest text-primary font-semibold mb-1">
            채용 결과 리포트
          </div>
          <h1 className="text-2xl font-bold text-slate-900 leading-tight">
            {job.title}
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 mt-3">
            <span>
              <strong className="text-slate-900">{org?.name ?? "-"}</strong>
            </span>
            <span>
              {job.position} · {job.level} · {job.employmentType}
            </span>
            <span>면접 {job.interviewDurationMinutes}분</span>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            기간: {formatLocalDate(job.createdAt)} ~{" "}
            {job.closedAt
              ? formatLocalDate(job.closedAt)
              : job.closesAt
                ? `${formatLocalDate(job.closesAt)} (종결 예정)`
                : "-"}
            {(job.extensionCount ?? 0) > 0 && (
              <> · 연장 {job.extensionCount}회</>
            )}
            <> · 상태: {job.status === "closed" ? "종결" : "진행 중"}</>
          </div>
          {interviewers.length > 0 && (
            <div className="text-xs text-slate-500 mt-1">
              면접관: {interviewers.map((i) => i.name).join(", ")}
            </div>
          )}
        </header>

        {/* 요약 카드 */}
        <section className="mb-7">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            한눈에 보기
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryCard label="총 지원자" value={`${totalCount}명`} />
            <SummaryCard
              label="최종 합격"
              value={`${hiredCount}명`}
              sub={`합격률 ${hireRate}`}
              tone="primary"
            />
            <SummaryCard
              label="평균 처리 기간"
              value={avgCycleDays != null ? `${avgCycleDays}일` : "-"}
              sub={`결정 ${decidedCands.length}건`}
            />
          </div>
        </section>

        {/* 채용 퍼널 & 전환율 */}
        <section className="mb-7 print:break-inside-avoid">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            채용 퍼널 (단계별 통과 · 전환율)
          </h2>
          <div className="space-y-1.5">
            {funnel.map((f, i) => {
              const base = funnel[0].count || 1;
              const widthPct = (f.count / base) * 100;
              const stepConv =
                i === 0
                  ? null
                  : funnel[i - 1].count > 0
                    ? Math.round((f.count / funnel[i - 1].count) * 100)
                    : 0;
              return (
                <div key={f.label} className="flex items-center gap-3 text-xs">
                  <span className="w-24 shrink-0 text-slate-600">{f.label}</span>
                  <div className="flex-1 bg-slate-100 rounded h-6 relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded transition-all"
                      style={{
                        width: `${widthPct}%`,
                        background: C.primary,
                        opacity: 0.25 + 0.75 * (1 - i / funnel.length),
                      }}
                    />
                    <span className="absolute inset-0 flex items-center px-2 text-[10px] text-slate-800 font-semibold tabular-nums">
                      {f.count}명
                      <span className="text-slate-400 font-normal ml-1">
                        ({Math.round((f.count / base) * 100)}%)
                      </span>
                    </span>
                  </div>
                  <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
                    {stepConv != null ? `↳ ${stepConv}%` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            오른쪽 수치(↳)는 직전 단계 대비 전환율 — 병목 단계 식별용.
          </p>
        </section>

        {/* 결과 분포 */}
        <section className="mb-7">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            결과 분포
          </h2>
          <div className="rounded-lg overflow-hidden border border-slate-200">
            <StackBar
              segments={[
                { label: "최종 합격", count: hiredCount, color: "bg-primary" },
                {
                  label: "진행 중",
                  count: inProgressCount,
                  color: "bg-info",
                },
                {
                  label: "불합격",
                  count: rejectedCount,
                  color: "bg-slate-400",
                },
                {
                  label: "지원 취소",
                  count: withdrawnCount,
                  color: "bg-slate-300",
                },
              ]}
              total={totalCount}
            />
          </div>
        </section>

        {/* 단계별 깔때기 */}
        <section className="mb-7">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            단계별 분포 (현재 stage 기준)
          </h2>
          <div className="space-y-1.5">
            {[
              "applied",
              "screened",
              "ai_pending",
              "ai_evaluated",
              "round1_candidate",
              "round1_scheduling",
              "round1_waiting",
              "round1_passed",
              "round2_passed",
              "hired",
              "rejected",
              "withdrawn",
            ].map((s) => {
              const n = stageCounts[s] ?? 0;
              if (n === 0) return null;
              const pct = totalCount > 0 ? (n / totalCount) * 100 : 0;
              return (
                <div key={s} className="flex items-center gap-3 text-xs">
                  <span className="w-32 shrink-0 text-slate-600">
                    {STAGE_LABEL[s] ?? s}
                  </span>
                  <div className="flex-1 bg-slate-100 rounded h-5 relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-primary/30 rounded"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="absolute inset-0 flex items-center px-2 text-[10px] text-slate-700 font-medium tabular-nums">
                      {n}명 ({pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 응답률 */}
        <section className="mb-7">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            응답률
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SummaryCard
              label="AI 면접 응답률"
              value={aiResponseRate != null ? `${aiResponseRate}%` : "-"}
              sub={`발송 ${aiSent}명 → 응답 ${aiResponded}명`}
            />
            <SummaryCard
              label="지원자 취소율"
              value={
                totalCount > 0
                  ? `${Math.round((withdrawnCount / totalCount) * 100)}%`
                  : "-"
              }
              sub={`${withdrawnCount}/${totalCount}`}
            />
          </div>
        </section>

        {/* 운영 건강도 */}
        {linkSentTotal > 0 && (
          <section className="mb-7 print:break-inside-avoid">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              운영 건강도 (AI 면접 링크)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-center">
              <Donut
                centerTop={`${linkSentTotal}`}
                centerSub="발송"
                data={[
                  { label: "응답 완료", value: respCnt, color: C.primary },
                  { label: "대기 중", value: waitCnt, color: C.muted },
                  { label: "링크 만료", value: expiredCnt, color: C.warn },
                  { label: "기타 종결", value: otherEndCnt, color: C.mutedSoft },
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <SummaryCard
                  label="평균 발송 횟수"
                  value={avgEmail != null ? `${avgEmail}회` : "-"}
                  sub="응답 받기까지"
                />
                <SummaryCard
                  label="한도 근접(8회+)"
                  value={`${nearLimit}명`}
                  sub="발송 10회 한도"
                  tone={nearLimit > 0 ? "primary" : undefined}
                />
              </div>
            </div>
            {respDays.length > 0 && (
              <div className="mt-5">
                <div className="text-[11px] text-slate-500 mb-2">
                  응답까지 소요시간 (발송→응답, 근사 · {respDays.length}건)
                </div>
                <VBars bars={respTimeBars} color={C.blue} height={120} />
              </div>
            )}
          </section>
        )}

        {/* AI 평가 통계 */}
        {countWithScreening > 0 && (
          <section className="mb-7">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              AI 서류 평가 통계
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard
                label="평균 점수"
                value={`${avgScreening ?? "-"}점`}
                sub={`${countWithScreening}건 기준`}
              />
              <SummaryCard
                label="합격자 평균"
                value={
                  avgHiredScreening != null ? `${avgHiredScreening}점` : "-"
                }
                sub={`${hiredScreeningCount}명 기준`}
                tone="primary"
              />
              <SummaryCard
                label="추천"
                value={`${recCounts["추천"]}명`}
                sub={`전체 ${countWithScreening}명 중`}
              />
              <SummaryCard
                label="비추천"
                value={`${recCounts["비추천"]}명`}
                sub={`전체 ${countWithScreening}명 중`}
              />
            </div>
          </section>
        )}

        {/* 점수 캘리브레이션 */}
        {countWithScreening > 0 && (
          <section className="mb-7 print:break-inside-avoid">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              점수 캘리브레이션 (평가가 실제 채용과 맞는가)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <div className="text-[11px] text-slate-500 mb-2">
                  서류 점수 분포 (합격자 강조)
                </div>
                <VBars
                  bars={scoreBars}
                  color={C.blueSoft}
                  hiColor={C.primary}
                  baseLabel="전체"
                  hiLabel="최종 합격"
                  height={140}
                />
              </div>
              {hasScreenBreakdown && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-2">
                    서류 4축 프로필 (전체 vs 합격자)
                  </div>
                  <Radar
                    axes={SCREEN_AXES.map((a) => a.label)}
                    series={[
                      { label: "전체 평균", color: C.indigo, values: radarAll },
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
            {scatterPts.length > 0 && (
              <div className="mt-5">
                <div className="text-[11px] text-slate-500 mb-2">
                  서류 점수 vs AI 면접 점수 (점 = 지원자 · 색 = 결과)
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <Scatter
                    points={scatterPts}
                    xLabel="서류 점수"
                    yLabel="AI 면접 점수"
                  />
                  <div className="flex sm:flex-col gap-3 text-[10px]">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: C.primary }}
                      />
                      <span className="text-slate-500">합격</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: C.danger }}
                      />
                      <span className="text-slate-500">불합격</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: C.muted }}
                      />
                      <span className="text-slate-500">진행 중</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* AI 면접 평가 통계 */}
        {evalCount > 0 && (
          <section className="mb-7">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              AI 면접 평가 통계 ({evalCount}건)
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard label="종합 평균" value={`${avgInterview ?? "-"}점`} />
              <SummaryCard
                label="강력추천 / 추천"
                value={`${recCountsInterview["강력추천"] + recCountsInterview["추천"]}명`}
              />
              <SummaryCard
                label="보류"
                value={`${recCountsInterview["보류"]}명`}
              />
              <SummaryCard
                label="비추천"
                value={`${recCountsInterview["비추천"]}명`}
              />
            </div>
          </section>
        )}

        {/* 면접관 평가 비교 */}
        {hasNotes && (
          <section className="mb-7 print:break-inside-avoid">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              사람 면접 평가
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
              <div>
                <div className="text-[11px] text-slate-500 mb-2">
                  면접관별 평균 점수 (관대/엄격 일관성)
                </div>
                <HBars rows={interviewerRows} />
                {avgInterview != null && humanOverall != null && (
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <SummaryCard
                      label="AI 면접 종합"
                      value={`${avgInterview}점`}
                    />
                    <SummaryCard
                      label="사람 면접 종합"
                      value={`${humanOverall}점`}
                      sub={`AI 대비 ${
                        humanOverall - avgInterview >= 0 ? "+" : ""
                      }${humanOverall - avgInterview}`}
                    />
                  </div>
                )}
              </div>
              <div>
                <div className="text-[11px] text-slate-500 mb-2">
                  사람 면접 4축 평균
                </div>
                <Radar
                  axes={HUMAN_AXES}
                  series={[
                    { label: "사람 면접", color: C.blue, values: humanRadar },
                  ]}
                />
              </div>
            </div>
          </section>
        )}

        {/* 채용 속도 / 리드타임 */}
        {(durRows.length > 0 || aiDurMin != null) && (
          <section className="mb-7 print:break-inside-avoid">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              채용 속도 (단계별 소요 · 리드타임)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <div className="text-[11px] text-slate-500 mb-2">
                  지원일 기준 평균 누적 소요 (일)
                </div>
                {durRows.length > 0 ? (
                  <HBars
                    rows={durRows.map((r) => ({
                      label: r.label,
                      value: r.v,
                      max: durMax,
                      display: `${r.v.toFixed(1)}일`,
                      color: C.teal,
                    }))}
                  />
                ) : (
                  <p className="text-xs text-slate-400">데이터 없음</p>
                )}
                {aiDurMin != null && (
                  <div className="mt-3">
                    <SummaryCard
                      label="AI 면접 평균 진행시간"
                      value={`${aiDurMin}분`}
                    />
                  </div>
                )}
              </div>
              {leadPts.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-2">
                    결정 리드타임 추이 (시간순 · 가속/지연 확인)
                  </div>
                  <DotTrend
                    points={leadPts}
                    yMax={leadMax}
                    yLabel="결정까지(일)"
                  />
                </div>
              )}
            </div>
          </section>
        )}

        {/* 합격자 프로파일 */}
        {(hasEdu || hasCareer || recRows.length > 0 || topKw.length > 0) && (
          <section className="mb-7 print:break-inside-avoid">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              지원자 · 합격자 프로파일
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {hasEdu && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-2">
                    최종학력 분포 (전체 지원자 · 파싱불가 = 미상)
                  </div>
                  <Donut data={eduData} />
                </div>
              )}
              {hasCareer && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-2">
                    경력년수 분포 (합격자 강조)
                  </div>
                  <VBars
                    bars={careerBars}
                    color={C.blueSoft}
                    hiColor={C.primary}
                    baseLabel="전체"
                    hiLabel="최종 합격"
                    height={130}
                  />
                </div>
              )}
            </div>
            {recRows.length > 0 && (
              <div className="mt-5">
                <div className="text-[11px] text-slate-500 mb-2">
                  서류 추천등급별 → 실제 합격 (AI 추천 보정 점검)
                </div>
                <div className="space-y-1.5">
                  {recRows.map((r) => {
                    const w = (r.total / recMax) * 100;
                    const hiW = r.total > 0 ? (r.hiredN / r.total) * 100 : 0;
                    return (
                      <div
                        key={r.grade}
                        className="flex items-center gap-3 text-xs"
                      >
                        <span className="w-16 shrink-0 text-slate-600">
                          {r.grade}
                        </span>
                        <div className="flex-1 bg-slate-100 rounded h-5 relative overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 rounded"
                            style={{
                              width: `${w}%`,
                              background: C.mutedSoft,
                            }}
                          />
                          <div
                            className="absolute inset-y-0 left-0 rounded"
                            style={{
                              width: `${(w * hiW) / 100}%`,
                              background: REC_COLOR[r.grade],
                            }}
                          />
                          <span className="absolute inset-0 flex items-center px-2 text-[10px] text-slate-800 font-medium tabular-nums">
                            {r.total}명
                            {r.hiredN > 0 && (
                              <span className="text-primary-deep ml-1">
                                · 합격 {r.hiredN}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {topKw.length > 0 && (
              <div className="mt-5">
                <div className="text-[11px] text-slate-500 mb-2">
                  이력서 매칭 키워드 TOP {topKw.length}
                </div>
                <HBars
                  rows={topKw.map(([kw, n]) => ({
                    label: kw,
                    value: n,
                    max: kwMax,
                    display: `${n}`,
                    color: C.indigo,
                  }))}
                />
              </div>
            )}
          </section>
        )}

        {/* 합격자 명단 */}
        {hired.length > 0 && (
          <section className="mb-7 print:break-inside-avoid">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              최종 합격자 ({hired.length}명)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-primary-soft/50 text-primary-deep">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">이름</th>
                    <th className="text-left px-3 py-2 font-medium">이메일</th>
                    <th className="text-left px-3 py-2 font-medium">경력</th>
                    <th className="text-right px-3 py-2 font-medium">
                      서류 점수
                    </th>
                    <th className="text-right px-3 py-2 font-medium">
                      합격일
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {hired.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {c.name}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.email ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.careerYears != null ? `${c.careerYears}년` : "-"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.screeningScore ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500 tabular-nums">
                        {c.decidedAt ? formatLocalDate(c.decidedAt) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 종결 사유 분포 */}
        {(rejectedCount > 0 || withdrawnCount > 0) && (
          <section className="mb-7 print:break-inside-avoid">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              종결 사유 분포 (어느 단계에서 종결됐나)
            </h2>
            <div className="text-xs space-y-2">
              {["rejected", "withdrawn"].map((oc) => {
                const breakdown = outcomeByStage[oc];
                if (!breakdown) return null;
                const totalForOutcome = Object.values(breakdown).reduce(
                  (s, n) => s + n,
                  0
                );
                return (
                  <div key={oc} className="flex flex-wrap gap-x-3 gap-y-1">
                    <span className="font-semibold text-slate-700 w-20 shrink-0">
                      {OUTCOME_LABEL[oc]} ({totalForOutcome})
                    </span>
                    <span className="text-slate-500">
                      {Object.entries(breakdown)
                        .map(
                          ([stage, n]) => `${STAGE_LABEL[stage] ?? stage} ${n}`
                        )
                        .join(" · ")}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 푸터 */}
        <footer className="mt-10 pt-4 border-t border-slate-200 text-[10px] text-slate-400 flex justify-between">
          <span>생성: {formatKstDateTime(new Date().toISOString())}</span>
          <span>Intervia · {org?.name ?? ""}</span>
        </footer>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "primary";
}) {
  const accent =
    tone === "primary"
      ? "bg-primary-soft/40 border-primary/30"
      : "bg-slate-50 border-slate-200";
  const valueColor = tone === "primary" ? "text-primary-deep" : "text-slate-900";
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${accent}`}>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-base font-bold tabular-nums mt-0.5 ${valueColor}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
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
  if (total === 0) {
    return (
      <div className="px-4 py-6 text-xs text-slate-400 text-center">
        후보자가 없습니다.
      </div>
    );
  }
  return (
    <>
      <div className="flex h-8">
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.label}
              className={`${s.color} relative group flex items-center justify-center`}
              style={{ width: `${(s.count / total) * 100}%` }}
              title={`${s.label} ${s.count}명`}
            >
              {s.count / total > 0.08 && (
                <span className="text-[10px] text-white font-medium">
                  {s.count}
                </span>
              )}
            </div>
          ) : null
        )}
      </div>
      <div className="px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm ${s.color}`} />
            <span className="text-slate-600">
              {s.label} <strong className="text-slate-900">{s.count}</strong>
              {total > 0 && (
                <span className="text-slate-400">
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

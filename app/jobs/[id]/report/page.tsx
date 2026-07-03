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
import {
  Users,
  Trophy,
  FileCheck2,
  CalendarClock,
  MessagesSquare,
  CheckCircle2,
  Sparkles,
  Bot,
  ArrowRight,
  ClipboardList,
} from "lucide-react";
import { formatKstDateTime, formatLocalDate } from "@/lib/utils";
import { STAGE_RANK, type Stage } from "@/lib/stage-meta";
import { PrintButton } from "./PrintButton";
import { Donut, Radar, VBars, HBars } from "@/components/charts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY = 86_400_000;

// AI 면접 역량 점수(evaluation.scores)는 LLM 이 만든 영문 스네이크 키다. 자주 나오는 것은
// 한글 라벨로, 나머지는 사람이 읽게 변환(_ → 공백 + 첫 글자 대문자).
const AI_COMP_LABEL: Record<string, string> = {
  technical_competency: "기술 역량",
  technical: "기술 역량",
  problem_solving: "문제 해결",
  communication: "의사소통",
  collaboration: "협업",
  teamwork: "협업",
  leadership: "리더십",
  ownership: "오너십",
  execution: "실행력",
  domain_knowledge: "도메인 이해",
  learning_agility: "학습 민첩성",
  growth: "성장 태도",
  culture_fit: "컬처핏",
  logical_thinking: "논리적 사고",
};
const aiCompLabel = (k: string) =>
  AI_COMP_LABEL[k] ??
  k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const REC_STYLE: Record<string, { bg: string; text: string }> = {
  강력추천: { bg: "bg-primary", text: "text-white" },
  추천: { bg: "bg-primary-soft", text: "text-primary-deep" },
  보류: { bg: "bg-warning-soft", text: "text-warning" },
  비추천: { bg: "bg-danger-soft", text: "text-danger" },
};

// 리포트 전용 다색 팔레트 — DESIGN_SYSTEM §색규칙 6(데이터 시각화 다색 허용) 범위.
// 화면 크롬(텍스트·배경·경계)은 토큰 그대로, 차트·수치·아이콘 칩에만 쓴다.
const RC = {
  blue: "#2563eb",
  sky: "#0ea5e9",
  navy: "#1c3478",
  amber: "#f59e0b",
  orange: "#f97316",
  violet: "#7c3aed",
  teal: "#0d9488",
  green: "#16a34a",
  red: "#dc2626",
  slate: "#94a3b8",
  slateSoft: "#e2e8f0",
} as const;
const soft = (hex: string) => `${hex}1f`; // 12% 알파 — 아이콘 칩/배지 배경
const FUNNEL_COLORS = [
  "#1e3a8a",
  "#1d4ed8",
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
];
const KW_COLORS = [
  RC.blue,
  RC.sky,
  RC.teal,
  RC.amber,
  RC.violet,
  RC.orange,
  RC.green,
  RC.navy,
];

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
      age: candidates.age,
      educationLevel: candidates.educationLevel,
      educationMajor: candidates.educationMajor,
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
  const aiCompletedCount = sessions.length;
  const aiScores = sessions
    .map((s) => s.evaluation?.overall_score)
    .filter((v): v is number => v != null);
  const avgAiScore =
    aiScores.length > 0
      ? Math.round(aiScores.reduce((a, b) => a + b, 0) / aiScores.length)
      : null;
  const avgHiredAiScore = (() => {
    const vs = hired
      .map((c) => sessionByCand.get(c.id)?.overall)
      .filter((v): v is number => v != null);
    return vs.length > 0
      ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length)
      : null;
  })();

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
  const hasHumanNotes = humanByCand.size > 0;

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

  // ───────── 현재 전형 진행 현황 (진행 중 후보 단계별) ─────────
  const STAGE_BUCKETS: { label: string; stages: Stage[] }[] = [
    { label: "서류 심사", stages: ["applied", "screened", "ai_pending"] },
    { label: "AI 면접", stages: ["ai_evaluated", "round1_candidate"] },
    {
      label: "1차 면접",
      stages: ["round1_scheduling", "round1_waiting"],
    },
    { label: "1차 합격", stages: ["round1_passed"] },
    { label: "2차 면접", stages: ["round2_passed"] },
  ];
  const stageFlow = STAGE_BUCKETS.map((b) => ({
    label: b.label,
    count: cands.filter(
      (c) => c.outcome == null && b.stages.includes(c.stage as Stage)
    ).length,
  }));
  const hasStageFlow = inProgressCount > 0;

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

  // ───────── 서류 추천도 분포 (도넛) ─────────
  const REC_ORDER = ["강력추천", "추천", "보류", "비추천"] as const;
  const REC_COLOR: Record<string, string> = {
    강력추천: RC.blue,
    추천: RC.sky,
    보류: RC.amber,
    비추천: "#f87171",
  };
  const recCounts: Record<string, number> = {};
  for (const c of cands) {
    const r = c.screeningReport?.recommendation;
    if (r) recCounts[r] = (recCounts[r] ?? 0) + 1;
  }
  const recData = REC_ORDER.filter((k) => recCounts[k]).map((k) => ({
    label: k,
    value: recCounts[k],
    color: REC_COLOR[k],
  }));
  const hasRec = recData.length > 0;

  // ───────── 강점 키워드 TOP (matched_keywords 집계) ─────────
  const kwCount: Record<string, number> = {};
  for (const c of cands) {
    for (const k of c.screeningReport?.matched_keywords ?? []) {
      const key = k.trim();
      if (key) kwCount[key] = (kwCount[key] ?? 0) + 1;
    }
  }
  const keywordTop = Object.entries(kwCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));
  const kwMax = Math.max(1, ...keywordTop.map((k) => k.value));
  const hasKeywords = keywordTop.length > 0;

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
    박사: RC.violet,
    석사: RC.blue,
    학사: RC.sky,
    전문학사: RC.amber,
    고졸: RC.orange,
    기타: RC.slate,
    미상: RC.slateSoft,
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

  // ───────── 지원자 풀: 연령 분포 ─────────
  const AGE_BUCKETS: { label: string; f: (a: number) => boolean }[] = [
    { label: "~29세", f: (a) => a < 30 },
    { label: "30–34", f: (a) => a >= 30 && a < 35 },
    { label: "35–39", f: (a) => a >= 35 && a < 40 },
    { label: "40–44", f: (a) => a >= 40 && a < 45 },
    { label: "45세+", f: (a) => a >= 45 },
  ];
  const ageList = cands
    .map((c) => c.age)
    .filter((v): v is number => v != null && v > 0);
  const ageBars = AGE_BUCKETS.map((b) => ({
    label: b.label,
    value: ageList.filter(b.f).length,
    hi: hired
      .map((c) => c.age)
      .filter((v): v is number => v != null && v > 0)
      .filter(b.f).length,
  }));
  const hasAge = ageList.length > 0;

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

  // 채용 속도 타임라인 구간 — 누적 평균의 차분(음수는 모수 차이로 생길 수 있어 제외)
  const speedSegs = (
    [
      { from: "지원", to: "서류평가", v: g1 },
      { from: "서류평가", to: "AI 면접", v: g2 },
      { from: "AI 면접", to: "최종 결정", v: g3 },
    ] as { from: string; to: string; v: number | null }[]
  ).filter(
    (s): s is { from: string; to: string; v: number } =>
      s.v != null && s.v >= 0
  );

  const show04 = hasEdu || hasCareer || hasAge;
  const show05 = hasScores || hasRec || hasKeywords || hasScreenBreakdown;
  const show07 =
    durRows.length > 0 ||
    avgEmail != null ||
    expiredCnt > 0 ||
    respAvg != null ||
    withdrawnCount > 0;

  // ───────── 합격자 종합평가 dossier ─────────
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
    const sr = c.screeningReport;
    const ev = sess?.evaluation;
    const bd = sr?.breakdown;
    const axisVals = [
      bd?.tech_fit?.score,
      bd?.experience_depth?.score,
      bd?.role_match?.score,
      bd?.growth_attitude?.score,
    ];
    const hasAxes = axisVals.every((v): v is number => typeof v === "number");
    const aiComp = ev?.scores
      ? Object.entries(ev.scores)
          .map(([k, v]) => ({
            label: aiCompLabel(k),
            score: v?.score ?? null,
            comment: v?.comment ?? "",
          }))
          .filter((x): x is { label: string; score: number; comment: string } =>
            typeof x.score === "number"
          )
      : [];
    const culture = ev?.culture_fit ?? null;
    return {
      id: c.id,
      name: c.name,
      careerYears: c.careerYears,
      educationLevel: c.educationLevel,
      educationMajor: c.educationMajor,
      screenRec: sr?.recommendation ?? null,
      aiRec: ev?.recommendation ?? null,
      paper,
      ai,
      human,
      overall,
      axisVals: hasAxes ? (axisVals as number[]) : null,
      aiComp,
      keywords: (sr?.matched_keywords ?? []).slice(0, 8),
      screenOpinion: sr?.summary?.trim() || null,
      aiOpinion: ev?.summary?.trim() || null,
      strengths: (ev?.strengths?.length
        ? ev.strengths
        : sr?.strengths ?? []
      ).slice(0, 4),
      concerns: (ev?.concerns?.length
        ? ev.concerns
        : sr?.concerns ?? []
      ).slice(0, 3),
      culture:
        culture && culture.items?.length
          ? {
              items: culture.items.slice(0, 4),
              note: culture.fit_note?.trim() || null,
            }
          : null,
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

  // ───────── 합격자 vs 전체 지원자 비교 ─────────
  const meanBy = <T,>(arr: T[], pick: (x: T) => number | null | undefined) => {
    const vs = arr
      .map(pick)
      .filter((v): v is number => typeof v === "number");
    return vs.length > 0 ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const compareRows = (
    [
      {
        label: "경력 연차",
        hiredV: meanBy(hired, (c) => c.careerYears),
        allV: meanBy(cands, (c) => c.careerYears),
        unit: "년",
        digits: 1,
      },
      {
        label: "서류 점수",
        hiredV: avgHiredScreening,
        allV: avgScreening,
        unit: "점",
        digits: 0,
      },
      {
        label: "AI 면접 점수",
        hiredV: avgHiredAiScore,
        allV: avgAiScore,
        unit: "점",
        digits: 0,
      },
    ] as {
      label: string;
      hiredV: number | null;
      allV: number | null;
      unit: string;
      digits: number;
    }[]
  ).filter((r) => r.hiredV != null && r.allV != null);
  const hasCompare = hiredCount > 0 && compareRows.length > 0;

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

  // 상단 한 줄 요약 (표지 아래)
  const summaryParts: ReactNode[] = [];
  if (totalCount === 0) {
    summaryParts.push(<>아직 지원자가 없습니다.</>);
  } else if (hiredCount > 0) {
    summaryParts.push(
      <>
        지원 <b className="font-semibold text-primary">{totalCount}명</b> 가운데{" "}
        <b className="font-semibold text-primary">{hiredCount}명</b>을 최종
        선발했습니다(합격률 {hireRate}).
      </>
    );
  } else {
    summaryParts.push(
      <>
        지원 <b className="font-semibold text-primary">{totalCount}명</b> 중 현재{" "}
        <b className="font-semibold">{inProgressCount}명</b> 진행 중이며, 최종
        합격자는 아직 없습니다.
      </>
    );
  }
  if (totalCount > 0 && avgCycleDays != null)
    summaryParts.push(
      <>
        {" "}
        평균 처리 기간은 <b className="font-semibold">{avgCycleDays}일</b>.
      </>
    );

  // 하단 AI 인사이트 불릿
  const insights: ReactNode[] = [];
  if (totalCount > 0) {
    const topKw = keywordTop.slice(0, 3).map((k) => k.label);
    insights.push(
      <>
        이번 공고에는 총{" "}
        <b className="font-semibold text-primary">{totalCount}명</b>이
        지원했으며, {hasCareer ? "경력 분포가 고르게 나타났습니다." : "지원자 풀이 형성되었습니다."}
      </>
    );
    if (qualitySentence) insights.push(<>{qualitySentence}</>);
    if (topKw.length > 0)
      insights.push(
        <>
          지원자에게서 가장 자주 확인된 강점 키워드는{" "}
          <b className="font-semibold">{topKw.join(" · ")}</b> 였습니다.
        </>
      );
    if (bottleneckSentence) insights.push(<>{bottleneckSentence}</>);
    if (timingCause) insights.push(<>{timingCause}</>);
  }

  const periodText = `${formatLocalDate(job.createdAt)} — ${
    job.closedAt
      ? formatLocalDate(job.closedAt)
      : job.closesAt
        ? `${formatLocalDate(job.closesAt)} 예정`
        : "진행 중"
  }`;
  const respLines = job.responsibilities
    .split(/\n+/)
    .map((s) => s.replace(/^[-·•*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);

  return (
    <main
      className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 print:px-0 print:py-0 print:max-w-none"
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
    >
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
        <div className="h-1 bg-primary" />
        <div className="p-6 sm:p-10 print:p-0">
          {/* ── 표지 ── */}
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.18em] text-primary font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                CONFIDENTIAL · 채용 결과 리포트
              </div>
              <h1 className="text-[27px] sm:text-[32px] font-bold text-ink leading-tight mt-2.5">
                {job.title}
              </h1>
              <div className="text-[13px] text-ink-muted mt-1.5">
                {job.position} · {job.level} · {job.employmentType}
              </div>
            </div>
            <div className="text-right text-[11px] text-ink-muted leading-relaxed pt-1 shrink-0">
              <div className="text-ink-soft font-semibold text-[14px]">
                {org?.name ?? "-"}
              </div>
              <div className="mt-1">{periodText}</div>
              <div className="mt-0.5">
                보고일자 {formatLocalDate(new Date().toISOString())}
              </div>
              <div className="mt-0.5">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    job.status === "closed"
                      ? "bg-surface-alt text-ink-soft"
                      : "bg-primary-soft text-primary-deep"
                  }`}
                >
                  {job.status === "closed" ? "종결" : "진행 중"}
                </span>
              </div>
            </div>
          </header>

          {/* ── 공고 개요 ── */}
          <div className="mt-6 rounded-2xl border border-border-default bg-surface-alt/60 p-5 print:break-inside-avoid">
            <div className="flex items-center gap-2 text-[10.5px] tracking-[0.14em] text-ink-muted font-semibold mb-3">
              <ClipboardList className="w-3.5 h-3.5" strokeWidth={2.25} />
              공고 개요
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3">
              <MetaItem label="직무" value={job.position} />
              <MetaItem label="직급 / 연차" value={job.level} />
              <MetaItem label="근무형태" value={job.employmentType} />
              <MetaItem
                label="면접 시간"
                value={`${job.interviewDurationMinutes}분`}
              />
              {interviewers.length > 0 && (
                <MetaItem
                  label="면접관"
                  value={interviewers.map((i) => i.name).join(", ")}
                  span
                />
              )}
              <MetaItem label="공고 기간" value={periodText} span />
            </div>
            {respLines.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border-default">
                <div className="text-[10.5px] text-ink-muted mb-1.5">
                  주요 담당업무
                </div>
                <ul className="space-y-0.5">
                  {respLines.map((line, i) => (
                    <li
                      key={i}
                      className="flex gap-1.5 text-[12.5px] text-ink-soft leading-relaxed"
                    >
                      <span className="text-primary shrink-0">·</span>
                      <span className="truncate">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* ── Executive Summary — KPI 6 ── */}
          <section className="mt-8">
            <SectionLabel>채용 핵심 요약</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
              <StatCard
                icon={<Users className="w-4 h-4" strokeWidth={2.25} />}
                label="총 지원자"
                value={`${totalCount}`}
                unit="명"
                color={RC.blue}
              />
              <StatCard
                icon={<Trophy className="w-4 h-4" strokeWidth={2.25} />}
                label="최종 합격"
                value={`${hiredCount}`}
                unit="명"
                sub={`합격률 ${hireRate}`}
                color={RC.amber}
              />
              <StatCard
                icon={<FileCheck2 className="w-4 h-4" strokeWidth={2.25} />}
                label="평균 서류점수"
                value={avgScreening != null ? `${avgScreening}` : "-"}
                unit={avgScreening != null ? "점" : ""}
                color={RC.orange}
              />
              <StatCard
                icon={<CalendarClock className="w-4 h-4" strokeWidth={2.25} />}
                label="평균 채용기간"
                value={avgCycleDays != null ? `${avgCycleDays}` : "-"}
                unit={avgCycleDays != null ? "일" : ""}
                sub={`결정 ${decidedCands.length}건`}
                color={RC.sky}
              />
              <StatCard
                icon={<MessagesSquare className="w-4 h-4" strokeWidth={2.25} />}
                label="AI 응답률"
                value={aiResponseRate != null ? `${aiResponseRate}` : "-"}
                unit={aiResponseRate != null ? "%" : ""}
                sub={aiSent > 0 ? `${aiResponded}/${aiSent}명` : undefined}
                color={RC.violet}
              />
              <StatCard
                icon={<CheckCircle2 className="w-4 h-4" strokeWidth={2.25} />}
                label="AI 면접 완료"
                value={`${aiCompletedCount}`}
                unit="건"
                sub={avgAiScore != null ? `평균 ${avgAiScore}점` : undefined}
                color={RC.teal}
              />
            </div>
            {summaryParts.length > 0 && (
              <p className="text-[13.5px] leading-[1.7] text-ink-soft mt-4">
                {summaryParts}
              </p>
            )}
          </section>

          {/* ── 01 채용 퍼널 ── */}
          {totalCount > 0 && (
            <Section
              n="01"
              title="채용 퍼널"
              desc="단계별 통과 인원 · 직전 단계 대비 전환율"
            >
              <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-x-8 gap-y-6 items-center">
                {/* 중앙 정렬 퍼널 */}
                <div className="space-y-1.5 print:break-inside-avoid">
                  {funnel.map((f, i) => {
                    const base = funnel[0].count || 1;
                    const widthPct = Math.max(
                      (f.count / base) * 100,
                      f.count > 0 ? 5 : 1.5
                    );
                    const wide = widthPct >= 32;
                    return (
                      <div
                        key={f.label}
                        className="flex items-center gap-3 text-xs"
                      >
                        <span className="w-[80px] shrink-0 text-ink-soft">
                          {f.label}
                        </span>
                        <div className="flex-1 relative flex items-center justify-center h-[28px]">
                          <div
                            className="h-full rounded"
                            style={{
                              width: `${widthPct}%`,
                              background: FUNNEL_COLORS[i],
                            }}
                          />
                          <span
                            className={`text-[11px] font-semibold tabular-nums whitespace-nowrap ${
                              wide ? "absolute text-white" : "ml-2 text-ink"
                            }`}
                          >
                            {f.count}명 (
                            {Math.round((f.count / base) * 100)}%)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 단계 표 */}
                <div className="overflow-hidden rounded-2xl border border-border-default self-start print:break-inside-avoid">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-alt text-[10.5px] text-ink-muted">
                        <th className="text-left font-medium px-3 py-2">
                          단계
                        </th>
                        <th className="text-right font-medium px-3 py-2">
                          인원
                        </th>
                        <th className="text-right font-medium px-3 py-2">
                          전 단계 대비
                        </th>
                        <th className="text-right font-medium px-3 py-2">
                          전체 대비
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {funnel.map((f, i) => {
                        const base = funnel[0].count || 1;
                        const stepConv =
                          i === 0
                            ? null
                            : funnel[i - 1].count > 0
                              ? Math.round(
                                  (f.count / funnel[i - 1].count) * 100
                                )
                              : 0;
                        const isBottleneck =
                          bottleneck != null &&
                          f.label === bottleneck.label &&
                          bottleneck.conv < 70;
                        return (
                          <tr key={f.label} className="bg-card">
                            <td className="px-3 py-2 text-ink-soft">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-sm shrink-0"
                                  style={{ background: FUNNEL_COLORS[i] }}
                                />
                                {f.label}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-ink tabular-nums">
                              {f.count}
                            </td>
                            <td
                              className={`px-3 py-2 text-right tabular-nums ${
                                isBottleneck
                                  ? "text-danger font-semibold"
                                  : "text-ink-muted"
                              }`}
                            >
                              {stepConv != null ? `${stepConv}%` : "-"}
                              {isBottleneck && (
                                <span className="block text-[9.5px] font-medium">
                                  최대 이탈
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-ink-muted tabular-nums">
                              {Math.round((f.count / base) * 100)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6">
                <div className="text-[11px] text-ink-muted mb-2">결과 분포</div>
                <StackBar
                  total={totalCount}
                  segments={[
                    { label: "최종 합격", count: hiredCount, color: RC.green },
                    { label: "진행 중", count: inProgressCount, color: RC.blue },
                    { label: "불합격", count: rejectedCount, color: RC.slate },
                    {
                      label: "지원 취소",
                      count: withdrawnCount,
                      color: "#d7dae2",
                    },
                  ]}
                />
              </div>
            </Section>
          )}

          {/* ── 02 현재 전형 진행 현황 ── */}
          {hasStageFlow && (
            <Section
              n="02"
              title="현재 전형 진행 현황"
              desc="진행 중인 지원자가 지금 어느 단계에 있는가"
            >
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                {stageFlow.map((s, i) => {
                  const color = FUNNEL_COLORS[i + 1] ?? RC.blue;
                  return (
                    <div
                      key={s.label}
                      className="rounded-2xl border border-border-default bg-card overflow-hidden text-center print:break-inside-avoid"
                    >
                      <div
                        className="h-[3px]"
                        style={{ background: color }}
                      />
                      <div className="px-3 py-4">
                        <div
                          className="text-[28px] leading-none font-bold tabular-nums"
                          style={{ color }}
                        >
                          {s.count}
                        </div>
                        <div className="text-[11px] text-ink-muted mt-1.5">
                          {s.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── 03 최종 합격자 종합평가 ── */}
          <Section
            n="03"
            title="최종 합격자 종합평가"
            sub={
              hired.length > 0
                ? `${hired.length}명${
                    avgHiredOverall != null
                      ? ` · 평균 종합 ${avgHiredOverall}점`
                      : ""
                  }`
                : undefined
            }
            desc="서류·AI 면접을 통합한 다면 평가 — 누구를, 어떤 근거로 선발했는가"
          >
            {hired.length === 0 ? (
              <p className="text-sm text-ink-muted">
                아직 최종 합격자가 없습니다. (진행 중 {inProgressCount}명)
              </p>
            ) : (
              <div className="space-y-5">
                {hiredCards.map((h) => (
                  <HiredDossier key={h.id} h={h} showHuman={hasHumanNotes} />
                ))}
              </div>
            )}
          </Section>

          {/* ── 04 지원자 분포 ── */}
          {show04 && (
            <Section
              n="04"
              title="지원자 분포"
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
                      color="#93c5fd"
                      hiColor={RC.blue}
                      baseLabel="전체"
                      hiLabel="최종 합격"
                      height={130}
                    />
                  </div>
                )}
                {hasAge && (
                  <div>
                    <div className="text-[11px] text-ink-muted mb-3">
                      연령 분포 (합격자 강조)
                    </div>
                    <VBars
                      bars={ageBars}
                      color="#93c5fd"
                      hiColor={RC.blue}
                      baseLabel="전체"
                      hiLabel="최종 합격"
                      height={130}
                    />
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* ── 05 AI 평가 결과 ── */}
          {show05 && (
            <Section
              n="05"
              title="AI 평가 결과"
              desc="서류 평가 기반 지원자 풀의 강점·품질 분포"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8 [&>div]:print:break-inside-avoid">
                {hasScores && (
                  <div>
                    <div className="text-[11px] text-ink-muted mb-3">
                      서류 점수 분포 (합격자 강조)
                    </div>
                    <VBars
                      bars={scoreBars}
                      color="#93c5fd"
                      hiColor={RC.blue}
                      baseLabel="전체"
                      hiLabel="최종 합격"
                      height={140}
                    />
                  </div>
                )}
                {hasRec && (
                  <div>
                    <div className="text-[11px] text-ink-muted mb-3">
                      서류 추천도 분포
                    </div>
                    <Donut data={recData} />
                  </div>
                )}
                {hasKeywords && (
                  <div>
                    <div className="text-[11px] text-ink-muted mb-3">
                      AI가 자주 확인한 강점 키워드 (TOP {keywordTop.length})
                    </div>
                    <HBars
                      rows={keywordTop.map((k, i) => ({
                        label: k.label,
                        value: k.value,
                        max: kwMax,
                        display: `${k.value}명`,
                        color: `${KW_COLORS[i % KW_COLORS.length]}b3`,
                      }))}
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
                        { label: "전체 평균", color: RC.sky, values: radarAll },
                        ...(hiredCount > 0
                          ? [
                              {
                                label: "합격자 평균",
                                color: RC.blue,
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

          {/* ── 06 합격자 vs 지원자 비교 ── */}
          {hasCompare && (
            <Section
              n="06"
              title="합격자 · 지원자 비교"
              desc="최종 합격자 평균이 전체 지원자 대비 어디에 위치하는가"
            >
              <div className="overflow-hidden rounded-2xl border border-border-default print:break-inside-avoid">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-alt text-[11px] text-ink-muted">
                      <th className="text-left font-medium px-4 py-2.5">지표</th>
                      <th className="text-right font-medium px-4 py-2.5">
                        합격자 평균
                      </th>
                      <th className="text-right font-medium px-4 py-2.5">
                        지원자 평균
                      </th>
                      <th className="text-right font-medium px-4 py-2.5">차이</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {compareRows.map((r) => {
                      const diff = r.hiredV! - r.allV!;
                      const sign = diff > 0.05 ? "+" : diff < -0.05 ? "" : "±";
                      const diffColor =
                        diff > 0.05
                          ? "text-success"
                          : diff < -0.05
                            ? "text-danger"
                            : "text-ink-muted";
                      return (
                        <tr key={r.label} className="bg-card">
                          <td className="px-4 py-3 text-ink-soft">{r.label}</td>
                          <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">
                            {r.hiredV!.toFixed(r.digits)}
                            {r.unit}
                          </td>
                          <td className="px-4 py-3 text-right text-ink-muted tabular-nums">
                            {r.allV!.toFixed(r.digits)}
                            {r.unit}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-medium tabular-nums ${diffColor}`}
                          >
                            {sign}
                            {Math.abs(diff).toFixed(r.digits)}
                            {r.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ── 07 전형 소요 시간 ── */}
          {show07 && (
            <Section
              n="07"
              title="채용 속도 · 운영 지표"
              desc="구간별 평균 소요 시간과 지연 원인"
            >
              {speedSegs.length > 0 ? (
                <div className="rounded-2xl border border-border-default bg-card px-5 py-4 print:break-inside-avoid">
                  <SpeedTimeline
                    segs={speedSegs}
                    totalDays={avgCycleDays}
                  />
                </div>
              ) : durRows.length > 0 ? (
                <HBars
                  rows={durRows.map((r) => ({
                    label: r.label,
                    value: r.v,
                    max: durMax,
                    display: `${r.v.toFixed(1)}일`,
                    color: RC.blue,
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
              <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-8 gap-y-5 items-center mt-5">
                {aiSent > 0 && aiResponseRate != null && (
                  <div className="print:break-inside-avoid">
                    <div className="text-[11px] text-ink-muted mb-2.5">
                      AI 면접 응답률
                    </div>
                    <Donut
                      data={[
                        { label: "응답", value: aiResponded, color: RC.blue },
                        {
                          label: "미응답",
                          value: aiSent - aiResponded,
                          color: RC.slateSoft,
                        },
                      ]}
                      size={116}
                      thickness={17}
                      centerTop={`${aiResponseRate}%`}
                      centerSub="응답률"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border-default border border-border-default rounded-2xl overflow-hidden self-start print:break-inside-avoid">
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
              </div>
            </Section>
          )}

          {/* ── AI 인사이트 ── */}
          {insights.length > 0 && (
            <section className="mt-10 rounded-2xl bg-primary-soft/50 border border-primary-soft p-5 print:break-inside-avoid">
              <div className="flex gap-4">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: soft(RC.blue), color: RC.blue }}
                >
                  <Bot className="w-6 h-6" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] tracking-[0.14em] text-primary-deep font-semibold mb-3">
                    <Sparkles className="w-3.5 h-3.5" strokeWidth={2.25} />
                    AI INSIGHT · 종합 인사이트
                  </div>
                  <ul className="space-y-2">
                    {insights.map((node, i) => (
                      <li
                        key={i}
                        className="flex gap-2.5 text-[13px] leading-relaxed text-ink-soft"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0 mt-[8px]"
                          style={{
                            background: KW_COLORS[i % KW_COLORS.length],
                          }}
                        />
                        <span>{node}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
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

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10.5px] tracking-[0.16em] text-primary font-semibold">
      {children}
    </div>
  );
}

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
        <span className="text-xs font-bold text-primary tabular-nums">{n}</span>
        <h2 className="text-[17px] font-bold text-ink">{title}</h2>
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

function MetaItem({
  label,
  value,
  span,
}: {
  label: string;
  value: string;
  span?: boolean;
}) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <div className="text-[10.5px] text-ink-muted">{label}</div>
      <div className="text-[13px] text-ink font-medium mt-0.5">{value}</div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  unit,
  sub,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-card p-3.5 print:break-inside-avoid">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: soft(color), color }}
      >
        {icon}
      </div>
      <div className="text-[10.5px] text-ink-muted mt-2.5">{label}</div>
      <div className="text-[26px] leading-none font-bold text-ink tabular-nums tracking-tight mt-1">
        {value}
        {unit && (
          <span className="text-[13px] font-medium text-ink-muted"> {unit}</span>
        )}
      </div>
      {sub && <div className="text-[10.5px] text-ink-muted mt-1">{sub}</div>}
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
      <div className="text-[22px] font-bold text-ink tabular-nums mt-1">
        {value}
        {unit && (
          <span className="text-xs font-medium text-ink-muted">{unit}</span>
        )}
      </div>
    </div>
  );
}

function SpeedTimeline({
  segs,
  totalDays,
}: {
  segs: { from: string; to: string; v: number }[];
  totalDays: string | null;
}) {
  return (
    <div className="flex items-center gap-5">
      <div className="flex-1 flex items-center min-w-0">
        {segs.map((s, i) => (
          <div key={i} className="flex-1 min-w-0 px-1">
            <div className="text-[10.5px] text-ink-muted text-center truncate">
              {s.from} → {s.to}
            </div>
            <div className="flex items-center mt-2">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: RC.blue }}
              />
              <div className="flex-1 border-t border-dashed border-border-strong" />
              {i === segs.length - 1 ? (
                <ArrowRight className="w-3.5 h-3.5 shrink-0 text-ink-muted" />
              ) : (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: RC.blue }}
                />
              )}
            </div>
            <div className="text-center text-[15px] font-bold text-ink tabular-nums mt-2">
              {s.v.toFixed(1)}
              <span className="text-[11px] font-medium text-ink-muted">일</span>
            </div>
          </div>
        ))}
      </div>
      {totalDays != null && (
        <div
          className="shrink-0 rounded-lg px-3.5 py-2 text-center"
          style={{ background: soft(RC.blue) }}
        >
          <div className="text-[10px] text-ink-muted">총 평균</div>
          <div
            className="text-[18px] font-bold tabular-nums leading-tight"
            style={{ color: RC.blue }}
          >
            {totalDays}
            <span className="text-[11px] font-medium">일</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RecBadge({ rec }: { rec: string }) {
  const st = REC_STYLE[rec] ?? REC_STYLE["보류"];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium ${st.bg} ${st.text}`}
    >
      {rec}
    </span>
  );
}

function ScoreRow({
  label,
  score,
  comment,
}: {
  label: string;
  score: number | null;
  comment?: string;
}) {
  return (
    <div className="text-xs">
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-ink-soft">{label}</span>
        <div className="flex-1 bg-surface-alt rounded h-5 relative overflow-hidden">
          {score != null && (
            <div
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${score}%`,
                background: RC.blue,
                opacity: 0.85,
              }}
            />
          )}
        </div>
        <span className="w-8 shrink-0 text-right tabular-nums font-semibold text-ink">
          {score ?? "—"}
        </span>
      </div>
      {comment && (
        <p className="text-[11px] text-ink-muted leading-snug mt-1 ml-[92px]">
          {comment}
        </p>
      )}
    </div>
  );
}

// LLM 요약(screeningReport/evaluation summary)은 마크다운 **볼드** 를 포함할 수 있다.
function renderBold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    return m ? (
      <strong key={i} className="font-semibold text-ink">
        {m[1]}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

type DossierData = {
  id: number;
  name: string;
  careerYears: number | null;
  educationLevel: string | null;
  educationMajor: string | null;
  screenRec: string | null;
  aiRec: string | null;
  paper: number | null;
  ai: number | null;
  human: number | null;
  overall: number | null;
  axisVals: number[] | null;
  aiComp: { label: string; score: number; comment: string }[];
  keywords: string[];
  screenOpinion: string | null;
  aiOpinion: string | null;
  strengths: string[];
  concerns: string[];
  culture: {
    items: {
      topic: string;
      self_report: string;
      verification: "일치" | "불일치" | "미검증";
      evidence: string;
    }[];
    note: string | null;
  } | null;
};

function HiredDossier({
  h,
  showHuman,
}: {
  h: DossierData;
  showHuman: boolean;
}) {
  const meta = [
    h.careerYears != null
      ? h.careerYears <= 0
        ? "신입"
        : `경력 ${h.careerYears}년`
      : null,
    [h.educationMajor, h.educationLevel].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ");
  const hasQual = h.strengths.length > 0 || h.concerns.length > 0;
  const stageScores = [
    { label: "서류", score: h.paper },
    { label: "AI 면접", score: h.ai },
    ...(showHuman || h.human != null
      ? [{ label: "대면", score: h.human }]
      : []),
  ];

  return (
    <div className="rounded-2xl border border-border-default bg-card overflow-hidden print:break-inside-avoid">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-4 p-5 bg-surface-alt/50 border-b border-border-default">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center text-lg font-semibold shrink-0">
            {h.name?.[0] ?? "?"}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[18px] font-bold text-ink truncate">
                {h.name}
              </span>
              {h.screenRec && <RecBadge rec={h.screenRec} />}
            </div>
            {meta && (
              <div className="text-xs text-ink-muted mt-0.5 truncate">
                {meta}
              </div>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] tracking-wide text-ink-muted">
            종합 점수
          </div>
          <div className="text-[34px] leading-none font-bold text-primary tabular-nums tracking-tight">
            {h.overall ?? "—"}
            <span className="text-[13px] font-medium text-ink-muted tracking-normal">
              {" "}
              /100
            </span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* 단계별 점수 요약 바 */}
        <div className="grid grid-cols-3 gap-2.5">
          {stageScores.map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-border-default bg-surface-alt/40 px-3 py-2.5 text-center"
            >
              <div className="text-[10.5px] text-ink-muted">{s.label}</div>
              <div className="text-[20px] font-bold text-ink tabular-nums mt-0.5">
                {s.score ?? "—"}
              </div>
            </div>
          ))}
        </div>

        {/* 서류 4축 레이더 + AI 면접 역량 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {h.axisVals && (
            <div>
              <div className="text-[10.5px] tracking-wide text-ink-muted mb-2">
                서류 4축 프로필
              </div>
              <Radar
                axes={["기술", "경험", "직무", "성장"]}
                series={[
                  { label: "서류 평가", color: RC.blue, values: h.axisVals },
                ]}
                size={188}
              />
            </div>
          )}
          {h.aiComp.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10.5px] tracking-wide text-ink-muted">
                  AI 면접 역량별
                </div>
                {h.aiRec && <RecBadge rec={h.aiRec} />}
              </div>
              <div className="space-y-2.5">
                {h.aiComp.map((c) => (
                  <ScoreRow
                    key={c.label}
                    label={c.label}
                    score={c.score}
                    comment={c.comment}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 매칭 키워드 */}
        {h.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {h.keywords.map((k) => (
              <span
                key={k}
                className="text-[11px] text-primary-deep bg-primary-soft px-2.5 py-0.5 rounded-full"
              >
                {k}
              </span>
            ))}
          </div>
        )}

        {/* 강점 / 보완점 */}
        {hasQual && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pt-1">
            {h.strengths.length > 0 && (
              <QualList label="핵심 강점" items={h.strengths} tone="primary" />
            )}
            {h.concerns.length > 0 && (
              <QualList label="보완 필요" items={h.concerns} tone="muted" />
            )}
          </div>
        )}

        {/* AI 종합 의견 (서류 + 면접) */}
        {(h.screenOpinion || h.aiOpinion) && (
          <div className="pt-4 border-t border-border-default space-y-3">
            {h.aiOpinion && (
              <OpinionBlock label="AI 면접 총평" text={h.aiOpinion} />
            )}
            {h.screenOpinion && (
              <OpinionBlock label="서류 평가 요약" text={h.screenOpinion} />
            )}
          </div>
        )}

        {/* 컬처핏 검증 */}
        {h.culture && (
          <div className="pt-4 border-t border-border-default">
            <div className="text-[10.5px] tracking-wide text-primary mb-2">
              컬처핏 · 정성 검증
            </div>
            <div className="space-y-1.5">
              {h.culture.items.map((it, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-[12px] leading-relaxed"
                >
                  <VerifyMark v={it.verification} />
                  <span className="text-ink-soft">
                    <span className="font-medium text-ink">{it.topic}</span>
                    {it.evidence ? ` — ${it.evidence}` : ""}
                  </span>
                </div>
              ))}
            </div>
            {h.culture.note && (
              <p className="text-[11.5px] text-ink-muted leading-relaxed mt-2">
                {h.culture.note}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OpinionBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[10.5px] tracking-wide text-primary mb-1.5">
        {label}
      </div>
      <p className="text-[13px] leading-relaxed text-ink-soft">
        {renderBold(text)}
      </p>
    </div>
  );
}

function VerifyMark({ v }: { v: "일치" | "불일치" | "미검증" }) {
  const style =
    v === "일치"
      ? "bg-primary-soft text-primary-deep"
      : v === "불일치"
        ? "bg-accent-soft text-accent-deep"
        : "bg-surface-alt text-ink-muted";
  return (
    <span
      className={`shrink-0 mt-[1px] inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-medium ${style}`}
    >
      {v}
    </span>
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
            <span
              className={`shrink-0 ${
                tone === "primary" ? "text-primary" : "text-ink-muted"
              }`}
            >
              ·
            </span>
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

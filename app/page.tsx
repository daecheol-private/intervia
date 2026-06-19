import { db } from "@/lib/db";
import {
  jobPostings,
  candidates,
  orgJoinRequests,
  organizations,
  tokenWallets,
  screeningJobs,
  jobInterviewers,
  interviewSchedules,
} from "@/lib/schema";
import { desc, eq, count, sql, and } from "drizzle-orm";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { getUnlockChecker } from "@/lib/job-lock";
import { ChatPreview } from "./components/ChatPreview";
import { CountUp } from "./components/CountUp";
import { HowItWorksCarousel } from "./components/HowItWorksCarousel";
import { TokenChargeRequestButton } from "./components/TokenChargeRequestButton";
import { GuideStepList, GuideStripCta } from "./components/tour/guide-steps";
import {
  buttonClass,
  Container,
  SectionHeading,
  Eyebrow,
  Card,
  Reveal,
} from "./components/ui";
import {
  getAllPricing,
  WELCOME_BONUS_TOKENS,
  CHARGE_BONUS_TIERS,
} from "@/lib/tokens";
import { BETA, LIST_PRICING } from "@/lib/beta";
import {
  ShieldCheck,
  Building2,
  Coins,
  MailCheck,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Workflow,
  Check,
  Users,
  User,
  FileText,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buildSetupSteps } from "@/lib/setup-steps";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const me = await getCurrentUser();
  if (!me) return <Landing />;
  // 시스템관리자의 홈은 운영 대시보드. (채용 대시보드는 자기 법인 데이터용 — 운영자에겐 부적합)
  if (me.role === "system_admin") redirect("/admin/dashboard");
  return <Dashboard me={me} />;
}

const TOKEN_KRW = 100; // 100원 = 1 토큰
const LOW_BALANCE_THRESHOLD = 50; // 멤버 충전 요청 버튼 노출 임계값 (≈ 5,000원)

// ---------------------------------------------------------------------------
// 로그인 후 대시보드
// ---------------------------------------------------------------------------

async function Dashboard({ me }: { me: CurrentUser }) {
  const orgScope = me.role === "system_admin" ? null : me.orgId ?? -1;
  const orgFilter = orgScope == null ? undefined : eq(jobPostings.orgId, orgScope);
  const candFilter = orgScope == null ? undefined : eq(candidates.orgId, orgScope);
  const nowIso = new Date().toISOString();

  // 상호 독립 쿼리 전부 병렬 — 순차 await 는 원격 DB(Turso) RTT × 쿼리 수가
  // 첫 화면 TTFB 에 그대로 더해진다.
  const [
    orgRow,
    totalJobs,
    candAgg,
    queueCount,
    joinRequestCount,
    tokenBalance,
    pricing,
    myInterviewerRows,
    jobsRaw,
    myInterviewerJobs,
    counterRows,
    expiredAiRows,
    resultDueRows,
    orgCount,
  ] = await Promise.all([
    // 인사말 법인명 + 첫 실행 가이드용 컬처핏 설정 여부 — orgId 있는 경우만 조회.
    me.orgId
      ? db
          .select({
            name: organizations.name,
            cultureFitProfile: organizations.cultureFitProfile,
          })
          .from(organizations)
          .where(eq(organizations.id, me.orgId))
          .then(([org]) => org ?? null)
      : Promise.resolve(null),
    // -- 공고 통계 --------------------------------------------------------
    db
      .select({ total: count() })
      .from(jobPostings)
      .where(orgFilter ?? sql`1=1`)
      .then(([r]) => Number(r?.total ?? 0)),
    // -- 후보자 총량 (KPI 카드용) ------------------------------------------
    // 단계별 분포는 공고 카드에서 표시 — 대시보드 상단엔 합계만.
    db
      .select({
        total: count(),
        // 종결 판정은 outcome 기준 — stage 는 종결 후에도 진행 단계를 보존한다.
        decided: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NOT NULL THEN 1 ELSE 0 END)`,
        // 첫 실행 가이드용 — AI 면접 단계(발송 후 응시 대기) 이상에 도달한 후보 수.
        interviewReached: sql<number>`SUM(CASE WHEN ${candidates.stage} IN ('ai_pending','ai_evaluated','round1_candidate','round1_scheduling','round1_waiting','round1_passed','round2_passed','hired') THEN 1 ELSE 0 END)`,
      })
      .from(candidates)
      .where(candFilter ?? sql`1=1`)
      .then(([r]) => r),
    // -- 평가 대기 큐 카운트 -----------------------------------------------
    db
      .select({ c: count() })
      .from(screeningJobs)
      .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
      .where(
        candFilter
          ? and(
              candFilter,
              sql`${screeningJobs.status} IN ('queued','processing')`
            )
          : sql`${screeningJobs.status} IN ('queued','processing')`
      )
      .then(([r]) => Number(r?.c ?? 0)),
    // -- 합류 요청 (org_admin / system_admin 만) ---------------------------
    (async () => {
      if (me.role === "org_admin" && me.orgId) {
        const [r] = await db
          .select({ c: count() })
          .from(orgJoinRequests)
          .where(
            and(
              eq(orgJoinRequests.orgId, me.orgId),
              eq(orgJoinRequests.status, "pending")
            )
          );
        return Number(r?.c ?? 0);
      }
      if (me.role === "system_admin") {
        const [r] = await db
          .select({ c: count() })
          .from(orgJoinRequests)
          .where(eq(orgJoinRequests.status, "pending"));
        return Number(r?.c ?? 0);
      }
      return 0;
    })(),
    // -- 토큰 잔액 (자기 법인만, system_admin 은 전체 잔액 합계) -------------
    (async (): Promise<number | null> => {
      if (me.orgId) {
        const [w] = await db
          .select({ b: tokenWallets.balance })
          .from(tokenWallets)
          .where(eq(tokenWallets.orgId, me.orgId));
        return w?.b ?? 0;
      }
      if (me.role === "system_admin") {
        const [w] = await db
          .select({ b: sql<number>`COALESCE(SUM(${tokenWallets.balance}), 0)` })
          .from(tokenWallets);
        return Number(w?.b ?? 0);
      }
      return null;
    })(),
    getAllPricing(),
    // 내가 면접관인 공고 id — 목록 정렬 1순위 + 잠금 일괄 판정 재료
    db
      .select({ jobId: jobInterviewers.jobId })
      .from(jobInterviewers)
      .where(eq(jobInterviewers.userId, me.id)),
    // -- 공고별 액션 카운트 (인사담당자가 처리해야 할 단계만) ----------------
    // - screened: 서류평가 완료 → 면접 보낼지 결정 대기 (인사담당자 액션)
    // - ai_pending: 링크 발송 후 후보자 응시 대기 (후보자 액션, 모니터링용)
    // - ai_evaluated: AI 면접 끝, 합·불 결정 대기 (인사담당자 액션)
    db
      .select({
        id: jobPostings.id,
        title: jobPostings.title,
        position: jobPostings.position,
        level: jobPostings.level,
        employmentType: jobPostings.employmentType,
        interviewDurationMinutes: jobPostings.interviewDurationMinutes,
        createdAt: jobPostings.createdAt,
        status: jobPostings.status,
        publishedAt: jobPostings.publishedAt,
        closesAt: jobPostings.closesAt,
        extensionCount: jobPostings.extensionCount,
        passwordHash: jobPostings.passwordHash,
        candidateCount: count(candidates.id),
        // 평가 대기 = 아직 stage=applied (서류 평가 안 마침). 진행 중인 후보 수.
        screeningCount: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'applied' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        decidedCount: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NOT NULL THEN 1 ELSE 0 END)`,
        needsInterviewDecision: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'screened' THEN 1 ELSE 0 END)`,
        awaitingInterview: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'ai_pending' THEN 1 ELSE 0 END)`,
        needsFinalDecision: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'ai_evaluated' THEN 1 ELSE 0 END)`,
        needsRound1Schedule: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_candidate' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        // 2차 진행 결정 — 이미 2차 일정이 진행 중(active 스케줄 존재)인 후보는 제외
        // (lib/candidate-state.ts r2_decide 판정과 동일)
        needsRound2Decision: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_passed' AND ${candidates.outcome} IS NULL AND NOT EXISTS (SELECT 1 FROM interview_schedules s WHERE s.candidate_id = ${candidates.id} AND s.round = 'round2' AND s.status IN ('pending','counter_proposed','selected')) THEN 1 ELSE 0 END)`,
        needsFinalOffer: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round2_passed' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
      })
      .from(jobPostings)
      .leftJoin(candidates, eq(candidates.jobId, jobPostings.id))
      .where(orgFilter ?? sql`1=1`)
      .groupBy(jobPostings.id)
      .orderBy(
        // active 먼저, 그 안에서 최신순. 면접관 우선 정렬은 JS 에서 다시 적용.
        sql`CASE WHEN ${jobPostings.status} = 'active' THEN 0 ELSE 1 END`,
        desc(jobPostings.createdAt)
      ),
    // 내가 면접관인 공고들 — 단계별 대기 카운트 (알림용)
    db
      .select({
        jobId: jobInterviewers.jobId,
        title: jobPostings.title,
        orgId: jobPostings.orgId,
        passwordHash: jobPostings.passwordHash,
        pendingDecision: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'ai_evaluated' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        round1Candidates: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_candidate' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        round1Passed: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_passed' AND ${candidates.outcome} IS NULL AND NOT EXISTS (SELECT 1 FROM interview_schedules s WHERE s.candidate_id = ${candidates.id} AND s.round = 'round2' AND s.status IN ('pending','counter_proposed','selected')) THEN 1 ELSE 0 END)`,
        round2Passed: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round2_passed' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
      })
      .from(jobInterviewers)
      .innerJoin(jobPostings, eq(jobPostings.id, jobInterviewers.jobId))
      .leftJoin(candidates, eq(candidates.jobId, jobPostings.id))
      .where(eq(jobInterviewers.userId, me.id))
      .groupBy(jobInterviewers.jobId, jobPostings.title),
    // 역제시 알림 — 내가 면접관인 공고에서 status='counter_proposed' 인 스케쥴
    db
      .select({
        jobId: interviewSchedules.jobId,
        title: jobPostings.title,
        passwordHash: jobPostings.passwordHash,
        n: count(),
      })
      .from(interviewSchedules)
      .innerJoin(
        jobInterviewers,
        eq(jobInterviewers.jobId, interviewSchedules.jobId)
      )
      .innerJoin(jobPostings, eq(jobPostings.id, interviewSchedules.jobId))
      .where(
        and(
          eq(jobInterviewers.userId, me.id),
          eq(interviewSchedules.status, "counter_proposed")
        )
      )
      .groupBy(interviewSchedules.jobId, jobPostings.title),
    // AI 면접 링크 만료(응시 중 중단) 알림 — 미응시 만료는 cron 이 자동 불합격 처리하지만,
    // 응시 중 만료는 HR 이 재발송 또는 결정해야 한다. 활성/완료 세션 없이 expired 만 남은 후보.
    db
      .select({
        jobId: candidates.jobId,
        title: jobPostings.title,
        passwordHash: jobPostings.passwordHash,
        n: count(),
      })
      .from(candidates)
      .innerJoin(jobInterviewers, eq(jobInterviewers.jobId, candidates.jobId))
      .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
      .where(
        and(
          eq(jobInterviewers.userId, me.id),
          eq(candidates.stage, "ai_pending"),
          sql`${candidates.outcome} IS NULL`,
          sql`EXISTS (SELECT 1 FROM interview_sessions s WHERE s.candidate_id = ${candidates.id} AND s.status = 'expired')`,
          sql`NOT EXISTS (SELECT 1 FROM interview_sessions s WHERE s.candidate_id = ${candidates.id} AND s.status IN ('pending','in_progress','completed'))`
        )
      )
      .groupBy(candidates.jobId, jobPostings.title),
    // 면접 결과 입력 대기 알림 — 확정 면접 시각이 지났는데 합·불/다음 단계 미입력.
    // 최신 active 스케줄 row 만 판정 (재제시로 묻힌 옛 selected row 제외).
    db
      .select({
        jobId: interviewSchedules.jobId,
        title: jobPostings.title,
        passwordHash: jobPostings.passwordHash,
        n: count(),
      })
      .from(interviewSchedules)
      .innerJoin(
        jobInterviewers,
        eq(jobInterviewers.jobId, interviewSchedules.jobId)
      )
      .innerJoin(jobPostings, eq(jobPostings.id, interviewSchedules.jobId))
      .innerJoin(candidates, eq(candidates.id, interviewSchedules.candidateId))
      .where(
        and(
          eq(jobInterviewers.userId, me.id),
          eq(interviewSchedules.status, "selected"),
          sql`${candidates.outcome} IS NULL`,
          sql`datetime(json_extract(${interviewSchedules.selectedSlot}, '$.end')) <= datetime(${nowIso})`,
          sql`((${interviewSchedules.round} = 'round1' AND ${candidates.stage} = 'round1_waiting') OR (${interviewSchedules.round} = 'round2' AND ${candidates.stage} = 'round1_passed'))`,
          sql`NOT EXISTS (SELECT 1 FROM interview_schedules s2 WHERE s2.candidate_id = ${interviewSchedules.candidateId} AND s2.round = ${interviewSchedules.round} AND s2.id > ${interviewSchedules.id} AND s2.status IN ('pending','counter_proposed','selected'))`
        )
      )
      .groupBy(interviewSchedules.jobId, jobPostings.title),
    // -- system_admin: 법인 수 (참고용) ------------------------------------
    me.role === "system_admin"
      ? db
          .select({ c: count() })
          .from(organizations)
          .then(([r]): number | null => Number(r?.c ?? 0))
      : Promise.resolve<number | null>(null),
  ]);

  // 토큰 잔액으로 가능한 액션 수 환산 — KPI 카드 보조 문구
  const tokenEquivResumes =
    tokenBalance != null && tokenBalance > 0
      ? Math.floor(tokenBalance / pricing.resume_upload)
      : 0;
  const tokenEquivInterviews =
    tokenBalance != null && tokenBalance > 0
      ? Math.floor(tokenBalance / pricing.interview)
      : 0;

  const interviewerSet = new Set(myInterviewerRows.map((r) => r.jobId));
  // 잠금 일괄 판정 — 면접관 공고 집합은 위에서 1회 조회했으므로 공고당 DB 재조회 없이
  // 쿠키만으로 동기 판정한다 (기존엔 공고 × 알림 루프마다 2쿼리씩 발생).
  const unlocked = await getUnlockChecker(me, interviewerSet);

  const jobsWithActions = jobsRaw.sort((a, b) => {
    // 1순위: 내가 면접관인 공고
    const ai = interviewerSet.has(a.id) ? 1 : 0;
    const bi = interviewerSet.has(b.id) ? 1 : 0;
    if (ai !== bi) return bi - ai;
    // 2순위: SQL orderBy 결과 유지 (active 먼저, created desc)
    return 0;
  });

  // 잠긴 공고 체크 — 후보자 카운트 숨김
  const lockedJobIdsAtJobs = new Set<number>();
  for (const j of jobsWithActions) {
    if (j.passwordHash && !unlocked(j.id)) lockedJobIdsAtJobs.add(j.id);
  }

  // 알림 — 내가 면접관으로 지정된 공고에서 액션 대기 중인 항목.
  // 데이터 구조는 generic 하게 만들어, 알림 종류를 나중에 추가/조정 가능.
  type Notification = {
    id: string;
    icon: string;
    title: string; // "[공고명] 라벨"
    count: number;
    href: string;
    tone: "amber" | "blue" | "indigo" | "rose";
  };
  const notifications: Notification[] = [];
  for (const j of myInterviewerJobs) {
    const locked = j.passwordHash != null && !unlocked(j.jobId);
    const displayTitle = locked ? "🔒 비공개" : j.title;
    const decision = Number(j.pendingDecision);
    const round1Cand = Number(j.round1Candidates);
    if (decision > 0) {
      notifications.push({
        id: `decision-${j.jobId}`,
        icon: "🎯",
        title: `[${displayTitle}] 합·불 결정 대기`,
        count: decision,
        href: `/jobs/${j.jobId}?stage=ai_evaluated`,
        tone: "indigo",
      });
    }
    if (round1Cand > 0) {
      notifications.push({
        id: `round1cand-${j.jobId}`,
        icon: "📅",
        title: `[${displayTitle}] 1차 면접 스케쥴 제시 대기`,
        count: round1Cand,
        href: `/jobs/${j.jobId}?stage=round1_candidate`,
        tone: "blue",
      });
    }
    const r1p = Number(j.round1Passed);
    if (r1p > 0) {
      notifications.push({
        id: `r1passed-${j.jobId}`,
        icon: "✅",
        title: `[${displayTitle}] 2차 면접 진행 결정 대기`,
        count: r1p,
        href: `/jobs/${j.jobId}?stage=round1_passed`,
        tone: "indigo",
      });
    }
    const r2p = Number(j.round2Passed);
    if (r2p > 0) {
      notifications.push({
        id: `r2passed-${j.jobId}`,
        icon: "🏁",
        title: `[${displayTitle}] 최종합격 결정 대기`,
        count: r2p,
        href: `/jobs/${j.jobId}?stage=round2_passed`,
        tone: "rose",
      });
    }
  }

  for (const r of counterRows) {
    const locked = r.passwordHash != null && !unlocked(r.jobId);
    const displayTitle = locked ? "🔒 비공개" : r.title;
    const n = Number(r.n);
    if (n > 0) {
      notifications.push({
        id: `counter-${r.jobId}`,
        icon: "↩️",
        title: `[${displayTitle}] 지원자 시간 역제시`,
        count: n,
        // pseudo 필터 — 같은 단계의 응답 대기자와 섞이지 않게 역제시 건만 표시
        href: `/jobs/${r.jobId}?stage=counter_proposed`,
        tone: "amber",
      });
    }
  }

  for (const r of expiredAiRows) {
    const locked = r.passwordHash != null && !unlocked(r.jobId);
    const displayTitle = locked ? "🔒 비공개" : r.title;
    const n = Number(r.n);
    if (n > 0) {
      notifications.push({
        id: `aiexp-${r.jobId}`,
        icon: "⏰",
        title: `[${displayTitle}] AI 면접 링크 만료 · 재발송/결정`,
        count: n,
        href: `/jobs/${r.jobId}?stage=ai_link_expired`,
        tone: "amber",
      });
    }
  }

  for (const r of resultDueRows) {
    const locked = r.passwordHash != null && !unlocked(r.jobId);
    const displayTitle = locked ? "🔒 비공개" : r.title;
    const n = Number(r.n);
    if (n > 0) {
      notifications.push({
        id: `due-${r.jobId}`,
        icon: "📝",
        title: `[${displayTitle}] 면접 완료 · 결과 입력 대기`,
        count: n,
        href: `/jobs/${r.jobId}?stage=result_due`,
        tone: "indigo",
      });
    }
  }

  // 우선순위: count 큰 순
  notifications.sort((a, b) => b.count - a.count);
  void orgCount; // system_admin 은 /admin/dashboard 로 리다이렉트 — 참고용 유지

  const totalCand = Number(candAgg?.total ?? 0);
  const decidedCount = Number(candAgg?.decided ?? 0);
  const interviewReached = Number(candAgg?.interviewReached ?? 0);

  // -- 첫 실행 가이드 (신규 법인 온보딩) ----------------------------------
  // 멤버는 공고 등록 권한이 없을 수 있으나, 첫 사이클 안내 자체는 동일하게 노출.
  // (system_admin 은 이 Dashboard 에 도달하지 않음 — 운영 대시보드로 리다이렉트)
  const orgName = orgRow?.name ?? null;
  const setup1 = orgRow?.cultureFitProfile != null; // 인재상·컬쳐핏 확인(설정 저장)
  const setup2 = totalJobs > 0; // 공고 등록
  const setup3 = totalCand > 0; // 이력서 업로드
  const setup4 = interviewReached > 0; // AI 면접 발송(응시 대기 이상)
  const setupComplete = setup1 && setup2 && setup3 && setup4;
  // 본인이 가이드를 숨겼으면 hero/strip 모두 표시 안 함 (플로팅 위젯과 동일 정책 — 개인 단위)
  const guideDismissed = me.setupGuideDismissedAt != null;
  const firstJobId = jobsWithActions[0]?.id ?? null;

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {/* 환영 헤더 */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-ink">
          안녕하세요, {orgName ? `${orgName} ` : ""}{me.name} 님
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          {totalJobs === 0
            ? "Intervia 에 오신 걸 환영합니다. 아래 4단계로 첫 채용을 시작해 보세요."
            : "오늘의 채용 현황을 한눈에 확인하세요."}
        </p>
      </header>

      {/* 공고가 하나도 없으면 KPI/목록 대신 시작 가이드만 — 첫 화면 단순화 */}
      {me.role === "org_admin" && totalJobs === 0 && !guideDismissed ? (
        <SetupGuide
          variant="hero"
          step1={setup1}
          step2={setup2}
          step3={setup3}
          step4={setup4}
          firstJobId={firstJobId}
        />
      ) : (
        <>
          {/* 셋업 미완 시 상단 슬림 진행 스트립 — 완료/숨김 시 사라짐. 법인담당자 전용. */}
          {me.role === "org_admin" && !setupComplete && !guideDismissed && (
            <SetupGuide
              variant="strip"
              step1={setup1}
              step2={setup2}
              step3={setup3}
              step4={setup4}
              firstJobId={firstJobId}
            />
          )}

      {/* 상단 KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {me.role === "system_admin" ? (
          <KpiCard
            label="전체 공고"
            value={totalJobs}
            href="/jobs"
            accent="blue"
          />
        ) : (
          <KpiCard
            label="내가 면접관인 공고"
            value={interviewerSet.size}
            sub={`전체 ${totalJobs}건 중`}
            href="/jobs?mine=1"
            accent="blue"
          />
        )}
        <KpiCard
          label="후보자"
          value={totalCand}
          sub={`진행 중 ${totalCand - decidedCount} · 결정 ${decidedCount}`}
          accent="indigo"
        />
        <KpiCard
          label="합류 요청"
          value={joinRequestCount}
          sub={joinRequestCount > 0 ? "승인 대기 중" : "처리할 요청 없음"}
          href={me.role === "org_admin" ? "/org/members" : me.role === "system_admin" ? "/admin/orgs" : undefined}
          accent={joinRequestCount > 0 ? "amber" : "slate"}
        />
        <KpiCard
          label={me.role === "system_admin" ? "전체 토큰 잔액" : "토큰 잔액"}
          value={tokenBalance != null ? tokenBalance.toLocaleString() : "-"}
          sub={
            tokenBalance != null && tokenBalance < 0
              ? "마이너스 — 충전 필요"
              : tokenBalance != null && tokenBalance > 0
                ? `이력서 ${tokenEquivResumes.toLocaleString()}건 · 면접 ${tokenEquivInterviews.toLocaleString()}회 가능`
                : undefined
          }
          href={
            me.role === "system_admin"
              ? "/admin/orgs"
              : me.role === "org_admin"
                ? "/org/tokens"
                : undefined
          }
          accent={tokenBalance != null && tokenBalance < 0 ? "rose" : "emerald"}
        >
          {me.role === "member" &&
            tokenBalance != null &&
            tokenBalance <= LOW_BALANCE_THRESHOLD && <TokenChargeRequestButton />}
        </KpiCard>
      </div>

      {/* 알림 — 면접관으로 지정된 공고에서 처리 대기 중인 항목 */}
      {notifications.length > 0 && (
        <section className="bg-card border border-border-default rounded-2xl p-5 shadow-sm mb-8">
          <header className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink">
              🔔 처리 대기 알림{" "}
              <span className="text-xs text-ink-soft font-normal">
                ({notifications.length}건)
              </span>
            </h2>
          </header>
          <ul className="space-y-2">
            {notifications.slice(0, 10).map((n) => (
              <li key={n.id}>
                <Link
                  href={n.href}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                    n.tone === "amber"
                      ? "bg-warning-soft border-warning/30 hover:bg-warning-soft/70"
                      : n.tone === "blue"
                        ? "bg-primary-soft border-primary/30 hover:bg-primary-soft/70"
                        : n.tone === "rose"
                          ? "bg-danger-soft border-danger/30 hover:bg-danger-soft/70"
                          : "bg-accent-soft border-accent/40 hover:bg-accent-soft/70"
                  }`}
                >
                  <span className="min-w-0 flex items-center gap-2">
                    <span className="text-lg">{n.icon}</span>
                    <span className="text-sm text-ink truncate">
                      {n.title}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-sm font-bold tabular-nums ${
                      n.tone === "amber"
                        ? "text-warning"
                        : n.tone === "blue"
                          ? "text-primary-deep"
                          : n.tone === "rose"
                            ? "text-danger"
                            : "text-accent-deep"
                    }`}
                  >
                    {n.count}
                  </span>
                </Link>
              </li>
            ))}
            {notifications.length > 10 && (
              <li className="text-[11px] text-ink-soft text-center pt-1">
                + {notifications.length - 10}건 더보기
              </li>
            )}
          </ul>
        </section>
      )}

      {/* AI 서류 평가 큐 알림 — 진행/대기 중일 때만 작게 표시 */}
      {queueCount > 0 && (
        <div className="mb-4 flex items-center gap-2 text-xs bg-warning-soft border border-warning/30 rounded-lg px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
          <span className="text-ink">
            AI 서류 평가 큐{" "}
            <strong className="text-warning">{queueCount}건</strong> 진행
            중·대기 중
          </span>
        </div>
      )}

      {/* 공고 카드 그리드 — 각 공고의 상태·진행·액션을 한눈에 */}
      <section className="mb-8">
        <header className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">공고 목록</h2>
            <p className="text-[11px] text-ink-soft mt-0.5">
              각 단계 숫자를 클릭하면 해당 단계로 필터된 후보자 목록이 열립니다.
            </p>
          </div>
          <Link
            href="/jobs/new"
            className="hidden sm:inline-block text-xs px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface font-medium transition-colors"
          >
            + 새 공고
          </Link>
        </header>
        {jobsWithActions.length === 0 ? (
          <div className="bg-card border border-dashed border-border-strong rounded-2xl py-12 text-center">
            <p className="text-sm text-ink-soft">
              아직 등록된 공고가 없습니다.
            </p>
            {/* 공고 등록은 입력 항목이 많아 PC에서만 지원 — 모바일은 안내 문구로 대체 */}
            <Link
              href="/jobs/new"
              className="hidden sm:inline-block mt-3 text-xs text-primary hover:underline"
            >
              첫 공고 등록 →
            </Link>
            <p className="sm:hidden mt-3 text-xs text-ink-soft">
              공고 등록은 PC(데스크톱)에서 진행해 주세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {jobsWithActions.map((j) => (
              <JobCard
                key={j.id}
                job={j}
                isLocked={lockedJobIdsAtJobs.has(j.id)}
              />
            ))}
          </div>
        )}
      </section>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------

/**
 * 첫 실행 가이드 — 신규 법인이 "인재상·컬쳐핏 확인 → 공고 → 이력서 → AI 면접" 첫 사이클을 마치도록 안내.
 * variant="hero": 공고 0개일 때 대시보드 본문을 대체하는 큰 카드.
 * variant="strip": 일부만 진행됐을 때 대시보드 상단의 슬림 진행 스트립.
 * 3단계 모두 완료되면 호출 측에서 렌더하지 않음.
 * 대시보드 외 화면에서는 SetupGuideWidget(플로팅)이 같은 단계를 안내.
 */
function SetupGuide({
  variant,
  step1,
  step2,
  step3,
  step4,
  firstJobId,
}: {
  variant: "hero" | "strip";
  step1: boolean;
  step2: boolean;
  step3: boolean;
  step4: boolean;
  firstJobId: number | null;
}) {
  const steps = buildSetupSteps({ step1, step2, step3, step4 }, firstJobId);
  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const activeStep = steps.find((s) => !s.done) ?? null;

  if (variant === "strip") {
    return (
      <div className="mb-6 rounded-xl border border-primary/20 bg-primary-soft/40 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md bg-primary text-surface tabular-nums">
            시작 가이드 {doneCount}/{total}
          </span>
          <span className="text-sm text-ink truncate">
            {activeStep ? (
              <>
                다음 단계:{" "}
                <strong className="font-semibold">{activeStep.title}</strong>
              </>
            ) : (
              "설정 완료"
            )}
          </span>
        </div>
        {activeStep && <GuideStripCta step={activeStep} />}
      </div>
    );
  }

  return (
    <section className="mb-8 rounded-2xl border border-border-default bg-card shadow-sm overflow-hidden">
      <div className="px-6 sm:px-8 pt-6 sm:pt-8 pb-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-soft text-primary-deep text-[11px] font-semibold mb-3">
          <Sparkles className="w-3 h-3" strokeWidth={2.5} />
          시작 가이드 · {doneCount}/{total} 완료
        </div>
        <h2 className="text-xl font-bold text-ink">첫 채용, {total}단계면 시작돼요</h2>
        <p className="text-sm text-ink-soft mt-1">
          아래 순서대로 진행하면 첫 AI 면접까지 한 번에 경험할 수 있어요.
        </p>
      </div>
      <GuideStepList
        steps={steps}
        activeN={activeStep?.n ?? null}
        variant="hero"
      />
    </section>
  );
}

function KpiCard({
  label,
  value,
  sub,
  href,
  accent,
  children,
}: {
  label: string;
  value: number | string;
  sub?: string;
  href?: string;
  accent: "blue" | "indigo" | "amber" | "emerald" | "rose" | "slate";
  children?: React.ReactNode;
}) {
  // v2 절제 — 장식 색(blue/indigo/emerald)은 중립. 진짜 상태(amber=대기, rose=음수)만 색 유지.
  const accentMap: Record<string, string> = {
    blue: "border-border-default",
    indigo: "border-border-default",
    amber: "border-warning/30 bg-warning-soft/40",
    emerald: "border-border-default",
    rose: "border-danger/30 bg-danger-soft/40",
    slate: "border-border-default",
  };
  const inner = (
    <div className={`group bg-card border rounded-2xl p-4 shadow-sm h-full transition-all ${accentMap[accent]} ${href ? "hover:shadow-md hover:-translate-y-0.5 hover:border-primary/40" : ""}`}>
      <div className="flex items-center justify-between gap-1">
        <div className="text-xs text-ink-soft font-medium">{label}</div>
        {href && (
          <ArrowRight
            className="w-3.5 h-3.5 text-ink-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
            strokeWidth={2.5}
          />
        )}
      </div>
      <div className="mt-2 text-2xl font-bold text-ink tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-soft mt-1">{sub}</div>}
      {children}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function JobCard({
  job,
  isLocked,
}: {
  job: {
    id: number;
    title: string;
    position: string;
    level: string;
    employmentType: string;
    interviewDurationMinutes: number;
    status: "active" | "closed";
    publishedAt: string;
    closesAt: string;
    extensionCount: number;
    passwordHash: string | null;
    candidateCount: number;
    screeningCount: number;
    decidedCount: number;
    needsInterviewDecision: number;
    awaitingInterview: number;
    needsFinalDecision: number;
    needsRound1Schedule: number;
    needsRound2Decision: number;
    needsFinalOffer: number;
  };
  isLocked: boolean;
}) {
  const isClosed = job.status === "closed";
  const total = Number(job.candidateCount);
  const screeningC = Number(job.screeningCount);
  const decidedC = Number(job.decidedCount);
  const inProgress = total - decidedC;

  // D-day 계산 (종결 공고는 종결일자 표시)
  const dLeft = isClosed
    ? null
    : Math.ceil(
        (new Date(job.closesAt).getTime() - Date.now()) / 86_400_000
      );
  // v2 절제 — 여유(>14일)는 중립. 임박(<=14 경고)·긴급(<=3 위험)만 색.
  const dTone =
    dLeft == null
      ? "bg-surface-alt text-ink-soft"
      : dLeft <= 3
        ? "bg-danger-soft text-danger border border-danger/30"
        : dLeft <= 14
          ? "bg-warning-soft text-warning border border-warning/30"
          : "bg-surface-alt text-ink-soft border border-border-default";

  const needsInterviewDecision = Number(job.needsInterviewDecision);
  const awaitingInterview = Number(job.awaitingInterview);
  const needsFinalDecision = Number(job.needsFinalDecision);
  const needsRound1Schedule = Number(job.needsRound1Schedule);
  const needsRound2Decision = Number(job.needsRound2Decision);
  const needsFinalOffer = Number(job.needsFinalOffer);

  const actionTotal =
    needsInterviewDecision +
    needsFinalDecision +
    needsRound1Schedule +
    needsRound2Decision +
    needsFinalOffer;

  return (
    <div
      className={`relative rounded-2xl border bg-card shadow-sm overflow-hidden ${
        isClosed ? "opacity-75" : ""
      } ${actionTotal > 0 ? "border-primary/30 ring-1 ring-primary/20" : "border-border-default"}`}
    >
      {/* 헤더 영역 */}
      <Link
        href={`/jobs/${job.id}`}
        className="block px-5 pt-5 pb-3 hover:bg-surface-alt/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {isLocked && (
                <span className="text-ink-muted" title="비밀번호 보호">
                  🔒
                </span>
              )}
              <h3 className="text-base font-bold text-ink truncate">
                {job.title}
              </h3>
              {isClosed && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt text-ink-soft font-medium">
                  종결
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Tag>{job.position}</Tag>
              <Tag>{job.level}</Tag>
              <Tag>{job.employmentType}</Tag>
              <Tag>면접 {job.interviewDurationMinutes}분</Tag>
            </div>
          </div>
          {!isClosed && dLeft != null && (
            <span
              className={`shrink-0 text-[11px] px-2 py-1 rounded-md font-medium tabular-nums ${dTone}`}
            >
              {dLeft <= 0 ? "오늘 만료" : `D-${dLeft}`}
            </span>
          )}
        </div>
      </Link>

      {/* 후보자 요약 라인 */}
      <div className="px-5 py-2 bg-surface-alt/50 border-y border-border-default/70 flex items-center gap-4 text-xs">
        <span>
          <strong className="text-ink tabular-nums">{total}</strong>
          <span className="text-ink-soft"> 명</span>
        </span>
        {!isLocked && total > 0 && (
          <>
            <span className="text-ink-muted">·</span>
            <span className="text-ink-soft">
              진행 <strong className="tabular-nums">{inProgress}</strong>
              {screeningC > 0 && (
                <span className="text-ink-muted ml-1">
                  (평가 중 {screeningC})
                </span>
              )}
            </span>
            <span className="text-ink-muted">·</span>
            <span className="text-ink-soft">
              결정 <strong className="tabular-nums">{decidedC}</strong>
            </span>
          </>
        )}
        {(job.extensionCount ?? 0) > 0 && (
          <>
            <span className="text-ink-muted">·</span>
            <span className="text-ink-soft">
              연장 {job.extensionCount}회
            </span>
          </>
        )}
      </div>

      {/* 액션 카운터 */}
      <div className="p-3">
        {isLocked ? (
          <div className="text-center text-xs text-ink-soft italic py-4">
            🔒 비밀번호 입력 후 액션 카운트 확인
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <ActionCount
                jobId={job.id}
                stage="screened"
                value={needsInterviewDecision}
                title="서류평가 완료"
                subtitle="면접 결정 대기"
                tone="blue"
                actor="인사담당"
              />
              <ActionCount
                jobId={job.id}
                stage="ai_pending"
                value={awaitingInterview}
                title="AI 면접 대기"
                subtitle="응시 대기"
                tone="sky"
                actor="지원자"
              />
              <ActionCount
                jobId={job.id}
                stage="ai_evaluated"
                value={needsFinalDecision}
                title="AI 면접 완료"
                subtitle="합·불 결정 대기"
                tone="indigo"
                actor="인사담당"
              />
            </div>
            {(needsRound1Schedule > 0 ||
              needsRound2Decision > 0 ||
              needsFinalOffer > 0) && (
              <div className="grid grid-cols-3 gap-2">
                {needsRound1Schedule > 0 && (
                  <ActionCount
                    jobId={job.id}
                    stage="round1_candidate"
                    value={needsRound1Schedule}
                    title="1차 면접"
                    subtitle="스케쥴 제시 대기"
                    tone="blue"
                    actor="인사담당"
                  />
                )}
                {needsRound2Decision > 0 && (
                  <ActionCount
                    jobId={job.id}
                    stage="round1_passed"
                    value={needsRound2Decision}
                    title="1차 합격"
                    subtitle="2차 진행 결정 대기"
                    tone="indigo"
                    actor="인사담당"
                  />
                )}
                {needsFinalOffer > 0 && (
                  <ActionCount
                    jobId={job.id}
                    stage="round2_passed"
                    value={needsFinalOffer}
                    title="2차 합격"
                    subtitle="최종합격 결정 대기"
                    tone="indigo"
                    actor="인사담당"
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-md bg-surface-alt text-ink-soft">
      {children}
    </span>
  );
}

function ActionCount({
  jobId,
  stage,
  value,
  title,
  subtitle,
  tone,
  actor,
}: {
  jobId: number;
  stage: string;
  value: number;
  title: string;
  subtitle: string;
  tone: "blue" | "sky" | "indigo";
  actor: "인사담당" | "지원자";
}) {
  // v2 절제 — 단계별 색 구분(blue/sky/indigo) 폐기. 활성=포레스트, 비활성=중립 하나로 통일.
  // 단계 구분은 색이 아니라 제목·위치로. (tone 인자는 호출부 호환 위해 유지하되 무시)
  void tone;
  const active =
    "bg-primary-soft border-primary/30 text-primary-deep hover:bg-primary-soft/70";
  const muted = "bg-surface-alt border-border-default text-ink-muted";
  const cls = value > 0 ? active : muted;
  // 액터: "인사담당(=내가 할 일)"은 포레스트 포인트, "지원자"는 중립.
  const actorTone =
    actor === "인사담당"
      ? "bg-primary-soft text-primary-deep"
      : "bg-surface-alt text-ink-soft";
  const inner = (
    <div
      className={`block px-3 py-2.5 border rounded-lg transition-colors ${cls}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium opacity-80 truncate">
          {title}
        </span>
        <span
          className={`text-[9px] px-1.5 py-px rounded-sm font-medium shrink-0 ${actorTone}`}
        >
          {actor}
        </span>
      </div>
      <div className="flex items-baseline justify-between mt-1">
        <span className="text-[10px] opacity-70 truncate">{subtitle}</span>
        <span className="text-xl font-bold tabular-nums">{value}</span>
      </div>
    </div>
  );
  if (value === 0) return inner;
  return (
    <Link href={`/jobs/${jobId}?stage=${stage}`} title={`${title} ${value}건 보기`}>
      {inner}
    </Link>
  );
}


// ---------------------------------------------------------------------------
// 비로그인 랜딩 페이지 (이전과 동일)
// ---------------------------------------------------------------------------

async function Landing() {
  const pricing = await getAllPricing();
  const welcomeKrw = WELCOME_BONUS_TOKENS * TOKEN_KRW;
  // 무료 체험으로 가능한 면접/이력서 건수 (체감 단위)
  const freeInterviews = Math.floor(WELCOME_BONUS_TOKENS / pricing.interview);
  const freeResumes = Math.floor(WELCOME_BONUS_TOKENS / pricing.resume_upload);
  // 공고가 무료(0 토큰)면 나눗셈이 Infinity 가 되므로 "무료"로 표기.
  const freeJobs = pricing.job_post > 0 ? Math.floor(WELCOME_BONUS_TOKENS / pricing.job_post) : null;
  return (
    <main className="flex-1">
      {/* 첫 화면 — Hero + 통계 밴드를 한 뷰포트에 (데스크톱). Hero 가 남는 높이를 채운다. */}
      <div className="lg:flex lg:flex-col lg:min-h-[calc(100vh-3.5rem)]">
      <section className="relative overflow-hidden bg-surface lg:flex-1 lg:flex lg:flex-col lg:justify-center">
        {/* 배경 장식 — radial primary + apricot accent + 미세 grid */}
        <div
          aria-hidden
          className="absolute -z-10 left-1/2 top-0 -translate-x-1/2 w-[1100px] h-[800px] rounded-full bg-primary-soft/50 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -z-10 right-0 top-32 w-[400px] h-[400px] rounded-full bg-primary-soft/35 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(var(--ink) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <Container
          width="xl"
          className="pt-16 pb-12 sm:pt-20 sm:pb-16 grid lg:grid-cols-[1.25fr_1fr] gap-12 lg:gap-12 items-center"
        >
          {/* Left — copy */}
          <div className="reveal-load">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-card border border-border-default text-xs text-ink-soft shadow-sm mb-6">
              <Sparkles className="w-3 h-3 text-primary" strokeWidth={2.5} />
              AI 채용 면접 플랫폼 · 한국 채용 실무에 최적화
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-ink leading-[1.1]">
              지원자와의 첫 대화를,
              <br />
              <span className="text-primary">AI 면접관에게 맡기세요.</span>
            </h1>
            <p className="mt-6 text-base sm:text-lg text-ink-soft max-w-xl leading-relaxed">
              공고 '지원하기' 링크로 모은 이력서 자동 평가부터, 채팅 기반 AI 면접, 면접 일정 조율,
              대면 면접 질문지와 녹음·음성 평가, 결과 리포트까지 한 번에. 채용 담당자가 진짜 중요한 결정에 집중하도록 돕습니다.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-start gap-3">
              <Link
                href="/signup"
                className={buttonClass({
                  size: "lg",
                  className: "group w-full sm:w-auto",
                })}
              >
                무료로 시작하기
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/login"
                className={buttonClass({
                  variant: "secondary",
                  size: "lg",
                  className: "w-full sm:w-auto",
                })}
              >
                로그인
              </Link>
            </div>
            <p className="mt-5 text-xs text-ink-soft">
              가입 즉시 {WELCOME_BONUS_TOKENS}토큰(약 {welcomeKrw.toLocaleString()}원) 제공 · 신용카드 등록 불필요
            </p>
          </div>

          {/* Right — chat preview */}
          <div
            className="lg:pl-8 mt-8 lg:mt-0 reveal-load"
            style={{ animationDelay: "120ms" }}
          >
            <ChatPreview />
          </div>
        </Container>
      </section>

      {/* 통계 밴드 */}
      <section className="bg-ink text-surface">
        <Container
          width="xl"
          className="py-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-center"
        >
          <Stat value={75} unit="%" label="채용 사이클 단축" sub="평균 2주 → 4일" />
          <Stat value={89} unit="%" label="후보자 응답률" sub="채팅 면접 완료 기준" />
          <Stat value={4.6} decimals={1} suffix="/5" label="인사담당자 만족도" sub="AI 평가 결과 설문 기준" />
          <Stat value={10} unit="분" label="평균 면접 시간" sub="10·20·30분 선택" />
        </Container>
        <p className="text-center text-[11px] text-surface/40 pb-6 px-6">
          * 베타 사용자 내부 측정값 · 출시 후 실데이터로 갱신
        </p>
      </section>
      </div>

      <WhyNotJobBoard />

      <section className="relative overflow-hidden">
        {/* 배경 — 미세 dot + apricot glow 우측 */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(var(--ink) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div
          aria-hidden
          className="absolute -z-10 right-0 top-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-primary-soft/35 blur-3xl"
        />

        <Container width="xl" className="py-20 sm:py-24">
          <Reveal>
            <SectionHeading
              className="mb-14"
              eyebrow="How it works"
              eyebrowIcon={Workflow}
              title="채용 사이클의 80%를 자동화합니다"
              subtitle="공고 등록부터 합·불 통보까지, 사람이 매번 할 필요 없는 일을 AI가 처리합니다."
            />
          </Reveal>

          {/* Flow — 7단계 캐러셀 (스크린샷 목업 + 말풍선 포인트) */}
          <Reveal>
            <HowItWorksCarousel />
          </Reveal>
        </Container>
      </section>

      <section className="relative bg-card border-y border-border-default overflow-hidden">
        {/* 배경 장식 — 좌측 forest soft glow */}
        <div
          aria-hidden
          className="absolute -left-32 top-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary-soft/40 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(var(--ink) 1px, transparent 1px), linear-gradient(90deg, var(--ink) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <Container width="lg" className="relative py-20 sm:py-24">
          <Reveal>
            <SectionHeading
              className="mb-12"
              eyebrow="한국 채용 특화"
              eyebrowIcon={CheckCircle2}
              title="한국 채용 시장에 맞춰 설계했습니다"
            />
          </Reveal>
          <Reveal className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Differ
              Icon={ShieldCheck}
              title="PIPA · 채용절차법 준수"
              body="개인정보 자동 마스킹, 후보자 동의 흐름, 자동화 의사결정 이의제기 채널, 차별 금지 항목 평가 배제 가드까지 한국 법령에 맞춰 기본 탑재."
              visual={
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "이름·전화 자동 마스킹",
                    "PIPA §22의2",
                    "이의제기 채널",
                    "차별 금지 가드",
                  ].map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                </div>
              }
            />
            <Differ
              Icon={Building2}
              title="법인 단위 멀티테넌트"
              body="법인별 데이터 격리, 도메인 자동 매칭 가입, 관리자 승인제. 시스템관리자의 모든 데이터 접근은 감사 로그로 추적."
              visual={
                <div className="space-y-1.5">
                  <OrgRow name="샘플컴퍼니" domain="sample.co.kr" balance="1,247" />
                  <OrgRow name="네이버" domain="navercorp.com" balance="8,910" />
                  <OrgRow name="카카오" domain="kakaocorp.com" balance="3,402" muted />
                </div>
              }
            />
            <Differ
              Icon={Coins}
              title="투명한 토큰 과금"
              body="공고/이력서/면접 단위 단가가 명확. 진행 중인 평가·면접은 잔액이 부족해도 끝까지 완료. 평가 실패 시 과금 없음."
              visual={
                <div className="space-y-1">
                  <LedgerRow memo="100,000원 충전 (+ 5% 보너스)" delta="+1,050" positive />
                  <LedgerRow memo="이력서 평가 12건" delta="−60" />
                  <LedgerRow memo="평가 실패 자동 환불" delta="+5" positive subtle />
                </div>
              }
            />
            <Differ
              Icon={MailCheck}
              title="법인 자체 메일 서버 지원"
              body="SMTP 등록만 하면 발신자 신뢰도 유지. 면접 안내·합불 통보 모두 자사 도메인으로 발송 가능. SPF/DKIM 정상 적용."
              visual={
                <div className="rounded-lg bg-card border border-border-default p-3 font-mono text-[11px]">
                  <div className="text-ink-soft">
                    From: <span className="text-ink">recruit@sample.co.kr</span>
                  </div>
                  <div className="mt-2 flex gap-1.5 flex-wrap">
                    <PassChip>SPF · pass</PassChip>
                    <PassChip>DKIM · pass</PassChip>
                    <PassChip>DMARC · pass</PassChip>
                  </div>
                </div>
              }
            />
          </Reveal>
        </Container>
      </section>

      <section>
        <Container width="lg" className="py-20 sm:py-24">
          <div className="text-center reveal">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">
              쓴 만큼만 내는 토큰 과금
            </h2>
            <p className="mt-4 text-base text-ink-soft">
              구독료 없음 · 신용카드 등록 없이 무료 체험 ·{" "}
              <strong className="text-ink">100원 = 1 토큰</strong> (VAT 별도)
            </p>
            {BETA.active && (
              <div className="mt-5 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary-soft border border-primary/30 text-xs sm:text-sm font-medium text-primary-deep">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-surface">
                  {BETA.label}
                </span>
                AI 면접 특가{" "}
                <span className="line-through opacity-60">
                  {(LIST_PRICING.interview * 100).toLocaleString()}원
                </span>{" "}
                <strong>{(pricing.interview * 100).toLocaleString()}원</strong> ·{" "}
                {BETA.endsAtLabel}까지
              </div>
            )}
          </div>

          {/* 무료 체험 카드 — forest 반전 배경 + apricot 강조 */}
          <div className="mt-10 rounded-2xl bg-primary text-surface p-6 sm:p-10 shadow-lg reveal">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-10">
              <div className="shrink-0">
                <div className="text-xs font-semibold uppercase tracking-widest text-surface/70">
                  법인 첫 등록 시
                </div>
                <div className="mt-2 text-4xl sm:text-5xl font-bold tabular-nums">
                  {WELCOME_BONUS_TOKENS}{" "}
                  <span className="text-2xl font-medium opacity-80">토큰</span>
                </div>
                <div className="text-sm opacity-80 mt-1">
                  ≈ {welcomeKrw.toLocaleString()}원
                </div>
              </div>
              <div className="flex-1 grid grid-cols-3 gap-3 text-center">
                {[
                  { label: "공고", display: freeJobs == null ? "무료" : `${freeJobs}건` },
                  { label: "이력서 평가", display: `${freeResumes}건` },
                  { label: "AI 면접", display: `${freeInterviews}건` },
                ].map((x) => (
                  <div
                    key={x.label}
                    className="rounded-xl p-4 bg-white/8 border border-white/15"
                  >
                    <div className="text-[11px] uppercase tracking-wider opacity-70">
                      {x.label}
                    </div>
                    <div className="mt-1 text-2xl font-bold tabular-nums">
                      {x.display}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-5 text-[11px] opacity-70 text-center">
              ※ 신규 법인 최초 등록 1회 한정. 위 건수는 무료 체험 토큰을 한 종류에만 썼을 때 기준. 평가 실패는 자동 환불됩니다.
            </p>
          </div>

          {/* 기능별 단가 */}
          <div className="mt-10 reveal">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-soft text-center">
              기능별 단가
            </h3>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <PriceCell
                label="공고 등록"
                tokens={pricing.job_post}
                hint="공고 1건 게시"
              />
              <PriceCell
                label="이력서 평가"
                tokens={pricing.resume_upload}
                hint="PDF 업로드 + AI 서류 평가"
              />
              <PriceCell
                label="AI 면접"
                tokens={pricing.interview}
                listTokens={LIST_PRICING.interview}
                hint="후보자 1명 채팅 면접 1회"
              />
              <PriceCell
                label="면접 문제 생성"
                tokens={pricing.interview_question_gen}
                hint="면접 문제 1건 생성 (1·2차 동일)"
              />
              <PriceCell
                label="대면 면접 평가"
                tokens={pricing.offline_interview}
                listTokens={LIST_PRICING.offline_interview}
                hint="녹음·음성 1건 전사 + AI 평가 (1·2차)"
              />
            </div>
          </div>

          {/* 충전 보너스 */}
          <div className="mt-10 reveal">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-soft text-center">
              많이 충전할수록 더 드립니다
            </h3>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {CHARGE_BONUS_TIERS.filter((t) => t.bonusRatio > 0)
                .slice()
                .reverse()
                .map((t) => (
                  <BonusCell
                    key={t.minKrw}
                    minKrw={t.minKrw}
                    bonusRatio={t.bonusRatio}
                  />
                ))}
            </div>
            <p className="mt-4 text-[11px] text-ink-soft text-center">
              진행 중인 평가·면접은 잔액이 부족해도 끝까지 완료됩니다(부족분은 다음 충전 시 자동 정산). 잔액이 0 이하가 되면 충전 전까지 신규 작업이 차단됩니다.
            </p>
          </div>
        </Container>
      </section>

      <section className="bg-ink text-surface">
        <Container width="sm" className="py-16 sm:py-24 text-center reveal">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-white/15 text-[11px] uppercase tracking-widest text-surface/60 mb-6">
            <span className="w-1 h-1 rounded-full bg-surface/50" />
            Get Started
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-surface">
            지금 시작해 보세요
          </h2>
          <p className="mt-4 opacity-75 leading-relaxed">
            법인 계정 등록 후 몇 분 내에 첫 공고를 띄울 수 있습니다.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signup"
              className="w-full sm:w-auto h-12 px-6 rounded-lg bg-surface hover:bg-surface-alt text-ink font-semibold shadow-md transition-[color,background-color,box-shadow,transform] active:translate-y-px inline-flex items-center justify-center border border-surface"
            >
              무료로 시작하기
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto h-12 px-6 rounded-lg bg-transparent hover:bg-white/10 text-surface font-semibold border border-white/30 transition-colors inline-flex items-center justify-center"
            >
              이미 계정이 있어요
            </Link>
          </div>
        </Container>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// 차별화 섹션 — "구인 사이트(사람인/잡코리아)와 다르다"를 양 vs 질로 대비.
// 왼쪽: 구인 사이트가 주는 것 = 이력서 더미. 오른쪽: Intervia 가 주는 것 =
// 면접 끝낸 후보 + 평가 리포트. 랜딩의 미니 목업·glow·반전 톤을 그대로 차용.
// ---------------------------------------------------------------------------

function WhyNotJobBoard() {
  return (
    <section className="relative overflow-hidden bg-card border-y border-border-default">
      <div
        aria-hidden
        className="absolute -z-10 -left-40 top-1/3 w-[520px] h-[520px] rounded-full bg-primary-soft/50 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -z-10 right-0 top-10 w-[400px] h-[400px] rounded-full bg-primary-soft/35 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(var(--ink) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <Container width="xl" className="pt-12 pb-20 sm:pt-16 sm:pb-24">
        {/* 헤더 */}
        <div className="text-center max-w-2xl mx-auto mb-12 sm:mb-14 reveal">
          <Eyebrow icon={Workflow} className="mb-5">
            사람인·잡코리아와 다른 점
          </Eyebrow>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-ink leading-[1.15]">
            공고를 올리는 곳이 아니라,
            <br />
            <span className="text-primary">지원자를 만나보는 곳</span>입니다.
          </h2>
          <p className="mt-5 text-base text-ink-soft leading-relaxed">
            구인 사이트는 이력서를{" "}
            <strong className="text-ink font-semibold">모아주고</strong> 끝납니다.
            Intervia 는 그 다음 — 한 명 한 명{" "}
            <strong className="text-ink font-semibold">면접하고 평가</strong>해
            드립니다.
          </p>
        </div>

        {/* 비교 — 데스크톱 가로(좌 더미 / 마커 / 우 리포트), 모바일 세로 */}
        <div className="grid lg:grid-cols-[1fr_auto_1fr] items-center gap-6 lg:gap-3 reveal">
          {/* 왼쪽 — 구인 사이트: 이력서 더미 */}
          <div className="lg:scale-[0.97] lg:opacity-90">
            <PanelLabel
              eyebrow="구인 사이트가 주는 것"
              title="이력서 더미"
              Icon={Users}
              tone="muted"
            />
            <div className="rounded-2xl bg-surface-alt/70 border border-border-default p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-xs font-semibold text-ink-soft">
                  지원자 목록
                </span>
                <span className="text-[11px] text-ink-muted tabular-nums">
                  247명
                </span>
              </div>
              <div className="space-y-2">
                <ResumeRow />
                <ResumeRow />
                <ResumeRow dim />
                <ResumeRow dim />
              </div>
              <p className="mt-3.5 text-center text-[11px] text-ink-muted italic">
                …이력서는 쌓이는데, 누가 좋은지는 직접 봐야 합니다
              </p>
            </div>
          </div>

          {/* 연결 마커 */}
          <div className="flex lg:flex-col items-center justify-center gap-2 shrink-0">
            <div className="w-11 h-11 rounded-full bg-card border border-border-strong shadow-md flex items-center justify-center">
              <ArrowRight
                className="w-5 h-5 text-primary rotate-90 lg:rotate-0"
                strokeWidth={2.5}
              />
            </div>
            <span className="text-[10px] uppercase tracking-widest text-ink-muted font-semibold">
              그 다음
            </span>
          </div>

          {/* 오른쪽 — Intervia: 면접 끝낸 후보 + 평가 리포트 */}
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-4 -z-10 rounded-3xl bg-primary-soft/60 blur-2xl opacity-70"
            />
            <PanelLabel
              eyebrow="Intervia 가 주는 것"
              title="면접 끝낸 후보 + 평가"
              Icon={Sparkles}
              tone="brand"
            />
            <div className="rounded-2xl bg-card border-2 border-primary/25 ring-1 ring-primary/10 p-4 shadow-lg">
              <div className="flex items-center justify-between mb-3.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-primary" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-ink truncate">
                      후보 김OO · 백엔드 5년
                    </div>
                    <div className="text-[10px] text-ink-soft">
                      AI 면접 완료 · 20분
                    </div>
                  </div>
                </div>
                <div className="flex items-baseline gap-0.5 px-2 py-1 rounded-lg bg-primary-soft shrink-0">
                  <span className="text-base font-bold text-primary tabular-nums">
                    4.6
                  </span>
                  <span className="text-[9px] text-primary/70">/5</span>
                </div>
              </div>

              <div className="space-y-2">
                <SkillBar label="문제해결" pct={92} />
                <SkillBar label="커뮤니케이션" pct={100} />
                <SkillBar label="컬처핏" pct={84} />
              </div>

              <div className="mt-3.5 rounded-lg bg-surface-alt/60 border border-border-default px-3 py-2">
                <p className="text-[11px] text-ink-soft leading-relaxed">
                  <span className="text-primary font-semibold">AI 요약 · </span>
                  결제 시스템 무중단 마이그레이션 경험이 직무와 정확히 부합.
                </p>
              </div>

              <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-primary">
                <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />
                1차 면접 진행 권장
              </div>
            </div>

            {/* 떠 있는 배지 */}
            <div className="absolute -top-3 -right-3 rounded-lg bg-ink text-surface px-2.5 py-1.5 shadow-lg flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-surface" strokeWidth={2.5} />
              <span className="text-[10px] font-semibold">자동 평가 완료</span>
            </div>
          </div>
        </div>

        {/* 보완재 한 줄 */}
        <div className="mt-16 pt-8 border-t border-border-default/60 text-center reveal">
          <p className="text-sm sm:text-base text-ink-soft">
            사람인 · 잡코리아 · 자체 채용페이지 —{" "}
            <span className="text-ink font-semibold">
              어디서 지원자를 받든, 면접은 Intervia 로.
            </span>
          </p>
        </div>
      </Container>
    </section>
  );
}

function PanelLabel({
  eyebrow,
  title,
  Icon,
  tone,
}: {
  eyebrow: string;
  title: string;
  Icon: LucideIcon;
  tone: "muted" | "brand";
}) {
  const brand = tone === "brand";
  return (
    <div className="flex items-center gap-2.5 mb-3 px-1">
      <div
        className={
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border " +
          (brand ? "bg-primary border-primary" : "bg-card border-border-default")
        }
      >
        <Icon
          className={"w-4 h-4 " + (brand ? "text-surface" : "text-ink-soft")}
          strokeWidth={2.25}
        />
      </div>
      <div>
        <div
          className={
            "text-[10px] uppercase tracking-widest font-semibold " +
            (brand ? "text-primary" : "text-ink-muted")
          }
        >
          {eyebrow}
        </div>
        <div className="text-sm font-bold text-ink">{title}</div>
      </div>
    </div>
  );
}

function ResumeRow({ dim }: { dim?: boolean }) {
  return (
    <div
      className={
        "flex items-center gap-2.5 rounded-lg bg-card border border-border-default px-3 py-2 " +
        (dim ? "opacity-45" : "")
      }
    >
      <div className="w-6 h-6 rounded-full bg-surface-alt shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-2 w-20 rounded bg-border-strong/70" />
        <div className="h-1.5 w-12 rounded bg-border-default" />
      </div>
      <span className="text-[9px] text-ink-muted bg-surface-alt rounded px-1.5 py-0.5 shrink-0 inline-flex items-center gap-1">
        <FileText className="w-2.5 h-2.5" />
        이력서.pdf
      </span>
    </div>
  );
}

function SkillBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] text-ink-soft w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface-alt overflow-hidden">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[9px] text-ink-muted tabular-nums w-6 text-right shrink-0">
        {pct}
      </span>
    </div>
  );
}

type LucideIcon = React.ComponentType<{
  className?: string;
  strokeWidth?: number;
}>;

function Differ({
  Icon,
  title,
  body,
  visual,
}: {
  Icon: LucideIcon;
  title: string;
  body: string;
  visual?: React.ReactNode;
}) {
  return (
    <Card tone="alt" hover>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg bg-card border border-border-default flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-primary" strokeWidth={2.25} />
        </div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
      </div>
      <p className="text-sm text-ink-soft leading-relaxed">{body}</p>
      {visual && (
        <div className="mt-4 pt-4 border-t border-border-default/60">
          {visual}
        </div>
      )}
    </Card>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-card border border-border-default text-ink-soft">
      <Check className="w-2.5 h-2.5 text-primary" strokeWidth={3} />
      {children}
    </span>
  );
}

function PassChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary-soft text-primary font-semibold">
      <Check className="w-2 h-2" strokeWidth={3} />
      {children}
    </span>
  );
}

function OrgRow({
  name,
  domain,
  balance,
  muted,
}: {
  name: string;
  domain: string;
  balance: string;
  muted?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between rounded-md bg-card border border-border-default px-2.5 py-1.5 " +
        (muted ? "opacity-60" : "")
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-5 h-5 rounded bg-primary-soft flex items-center justify-center shrink-0">
          <Building2 className="w-2.5 h-2.5 text-primary" />
        </div>
        <span className="text-[11px] font-medium text-ink truncate">{name}</span>
        <span className="text-[10px] text-ink-muted truncate">@{domain}</span>
      </div>
      <span className="text-[10px] font-mono text-primary shrink-0">{balance}</span>
    </div>
  );
}

function LedgerRow({
  memo,
  delta,
  positive,
  subtle,
}: {
  memo: string;
  delta: string;
  positive?: boolean;
  subtle?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-md " +
        (subtle
          ? "bg-card/60 border border-dashed border-border-default"
          : "bg-card border border-border-default")
      }
    >
      <span className="text-ink-soft truncate">{memo}</span>
      <span
        className={
          "font-mono font-semibold tabular-nums shrink-0 " +
          (positive ? "text-primary" : "text-ink")
        }
      >
        {delta}
      </span>
    </div>
  );
}

function Stat({
  value,
  decimals,
  unit,
  suffix,
  label,
  sub,
}: {
  value: number;
  decimals?: number;
  unit?: string; // 숫자 뒤 단위 (% · 분)
  suffix?: string; // 별도 톤의 접미사 (/5)
  label: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-3xl sm:text-4xl font-bold tabular-nums tracking-tight">
        <CountUp value={value} decimals={decimals} />
        {unit}
        {suffix && (
          <span className="text-lg font-medium opacity-50 ml-0.5">{suffix}</span>
        )}
      </div>
      <div className="mt-1.5 text-xs uppercase tracking-widest text-surface/60 font-semibold">
        {label}
      </div>
      {sub && (
        <div className="mt-1 text-[11px] opacity-50">{sub}</div>
      )}
    </div>
  );
}

function PriceCell({
  label,
  tokens,
  hint,
  listTokens,
}: {
  label: string;
  tokens: number;
  hint: string;
  listTokens?: number;
}) {
  const krw = tokens * TOKEN_KRW;
  const discounted = listTokens != null && listTokens > tokens;
  return (
    <div
      className={`rounded-2xl border p-6 text-center shadow-sm transition-shadow hover:shadow-md ${
        discounted
          ? "bg-primary-soft/40 border-primary/30"
          : "bg-card border-border-default"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wider text-ink-soft font-semibold">
        {label}
      </div>
      {tokens === 0 ? (
        <>
          <div className="mt-3 text-3xl font-bold text-primary">무료</div>
          <div className="text-[11px] text-ink-soft mt-0.5">토큰 차감 없음</div>
        </>
      ) : (
        <>
          <div className="mt-3 flex items-baseline justify-center gap-1.5">
            {discounted && (
              <span className="text-lg font-semibold text-ink-soft/60 line-through tabular-nums">
                {listTokens}
              </span>
            )}
            <span className="text-3xl font-bold text-primary tabular-nums">
              {tokens}
            </span>
            <span className="text-xs text-ink-soft">토큰</span>
          </div>
          <div className="text-[11px] text-ink-soft mt-0.5 tabular-nums">
            {discounted && (
              <span className="line-through opacity-60 mr-1">
                {(listTokens! * TOKEN_KRW).toLocaleString()}원
              </span>
            )}
            ≈ {krw.toLocaleString()}원
          </div>
        </>
      )}
      <div className="text-[11px] text-ink-muted mt-3">{hint}</div>
    </div>
  );
}

function BonusCell({
  minKrw,
  bonusRatio,
}: {
  minKrw: number;
  bonusRatio: number;
}) {
  const pct = Math.round(bonusRatio * 100);
  return (
    <div className="rounded-xl bg-card border border-border-default p-4 text-center">
      <div className="text-[11px] text-ink-soft tabular-nums font-semibold">
        {(minKrw / 10000).toLocaleString()}만원+
      </div>
      <div className="mt-1 text-xl font-bold text-primary tabular-nums">
        +{pct}%
      </div>
      <div className="text-[10px] text-ink-muted mt-0.5">보너스 토큰</div>
    </div>
  );
}

// Step 컴포넌트는 FlowStep 으로 대체됨

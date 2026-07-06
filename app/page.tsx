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
  users,
} from "@/lib/schema";
import { desc, eq, count, sql, and, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { getUnlockChecker } from "@/lib/job-lock";
import { AppShell } from "./components/AppShell";
import { ChatPreview } from "./components/ChatPreview";
import { ProductTour } from "./components/ProductTour";
import { CountUp } from "./components/CountUp";
import { HowItWorksCarousel } from "./components/HowItWorksCarousel";
import { TokenChargeRequestButton } from "./components/TokenChargeRequestButton";
import { JobRowLink } from "./components/JobRowLink";
import {
  buttonClass,
  cn,
  Container,
  SectionHeading,
  Eyebrow,
  Card,
  Reveal,
} from "./components/ui";
import { getAllPricing, WELCOME_BONUS_TOKENS } from "@/lib/tokens";
import {
  BETA,
  LIST_PRICING,
  CHARGE_PACKAGES,
  CHARGE_BONUS_BOOSTED,
  BETA_BONUS_MULTIPLIER,
} from "@/lib/beta";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Columns3,
  EyeOff,
  FileSearch,
  FileText,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Lock,
  MapPin,
  MessageSquare,
  Mic,
  Paperclip,
  ScrollText,
  Server,
  Share2,
  ShieldAlert,
  Sparkles,
  StickyNote,
  Target,
  TrendingUp,
  Upload,
  Users,
  User,
  Workflow,
} from "lucide-react";
import { Donut, MultiLineCumulative, CATEGORICAL } from "@/components/charts";
import Link from "next/link";
import { redirect } from "next/navigation";

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
  const nowIso = new Date().toISOString();
  // 최근 7일 기준선 — KPI 트렌드("최근 7일 신규")용. createdAt 비교로 실제 신규만 집계.
  const cutoff7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // 대시보드 스코프 — 토큰 잔액을 제외한 모든 값(KPI·파이프라인·지원자 응답 대기·
  // 오늘 할 일·공고 목록)이 같은 스코프를 공유한다:
  //   · 멤버(member)         → "내가 면접관으로 지정된 공고"만 (공고 생성자는 자동 면접관)
  //   · 법인담당자(org_admin) → 법인 전체
  // system_admin 은 홈에서 운영 대시보드로 리다이렉트되므로 여기 도달하지 않는다.
  const myInterviewerRows = await db
    .select({ jobId: jobInterviewers.jobId })
    .from(jobInterviewers)
    .where(eq(jobInterviewers.userId, me.id));
  const myJobIds = myInterviewerRows.map((r) => r.jobId);
  const interviewerSet = new Set(myJobIds);
  const scopeIds = myJobIds.length > 0 ? myJobIds : [-1];
  const isOrgScope = me.role === "org_admin";
  // 후보자 단위 필터 (candidates 테이블 대상)
  const candScopeFilter = isOrgScope
    ? eq(candidates.orgId, me.orgId ?? -1)
    : inArray(candidates.jobId, scopeIds);
  // 공고 단위 필터 (jobPostings 테이블 대상) — 공고 목록·오늘 할 일 알림이 공유.
  const jobScopeFilter = isOrgScope
    ? eq(jobPostings.orgId, me.orgId ?? -1)
    : inArray(jobPostings.id, scopeIds);

  // 상호 독립 쿼리 전부 병렬 — 순차 await 는 원격 DB(Turso) RTT × 쿼리 수가
  // 첫 화면 TTFB 에 그대로 더해진다.
  const [
    orgRow,
    candAgg,
    queueCount,
    joinRequestCount,
    tokenBalance,
    pricing,
    jobsRaw,
    jobActionRows,
    counterRows,
    expiredAiRows,
    resultDueRows,
    awaitingAgg,
    perJobElapsed,
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
    // -- 후보자 총량 (KPI 카드용) ------------------------------------------
    // 단계별 분포는 공고 카드에서 표시 — 대시보드 상단엔 합계만.
    db
      .select({
        total: count(),
        // 종결 판정은 outcome 기준 — stage 는 종결 후에도 진행 단계를 보존한다.
        decided: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NOT NULL THEN 1 ELSE 0 END)`,
        // KPI/파이프라인용 집계 (전부 실데이터 — 추정·생성값 없음).
        hired: sql<number>`SUM(CASE WHEN ${candidates.outcome} = 'hired' THEN 1 ELSE 0 END)`,
        evaluated: sql<number>`SUM(CASE WHEN ${candidates.screeningScore} IS NOT NULL THEN 1 ELSE 0 END)`,
        avgScore: sql<number | null>`AVG(CASE WHEN ${candidates.screeningScore} IS NOT NULL THEN ${candidates.screeningScore} END)`,
        newWeek: sql<number>`SUM(CASE WHEN ${candidates.createdAt} >= ${cutoff7d} THEN 1 ELSE 0 END)`,
        // 진행 중(outcome IS NULL) 후보를 파이프라인 버킷으로 (lib/candidate-state STAGE_BUCKET 과 동일).
        pipeResume: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('applied','screened') THEN 1 ELSE 0 END)`,
        pipeAi: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('ai_pending','ai_evaluated') THEN 1 ELSE 0 END)`,
        pipeR1: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('round1_candidate','round1_scheduling','round1_waiting') THEN 1 ELSE 0 END)`,
        pipeR2: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('round1_passed','round2_passed') THEN 1 ELSE 0 END)`,
      })
      .from(candidates)
      .where(candScopeFilter)
      .then(([r]) => r),
    // -- 평가 대기 큐 카운트 -----------------------------------------------
    db
      .select({ c: count() })
      .from(screeningJobs)
      .innerJoin(candidates, eq(candidates.id, screeningJobs.candidateId))
      .where(
        and(
          candScopeFilter,
          sql`${screeningJobs.status} IN ('queued','processing')`
        )
      )
      .then(([r]) => Number(r?.c ?? 0)),
    // -- 합류 요청 (org_admin / system_admin 만) ---------------------------
    // 요청 행(status=pending) 뿐 아니라 요청한 사용자가 아직 pending 인 것만 센다.
    // 다른 승인 경로(예: /admin/users 에서 status 만 active 로 토글)로 사용자가 이미
    // 활성화됐는데 join_request 행이 pending 으로 남는 고아 케이스가 있어(멤버 화면은
    // user.status=pending 일 때만 승인 대상으로 표시하므로 UI 로 정리 불가), 그 행이
    // '오늘 할 일' 에 유령으로 남지 않도록 users 를 조인해 실제 대기자만 집계한다.
    (async () => {
      if (me.role === "org_admin" && me.orgId) {
        const [r] = await db
          .select({ c: count() })
          .from(orgJoinRequests)
          .innerJoin(users, eq(users.id, orgJoinRequests.userId))
          .where(
            and(
              eq(orgJoinRequests.orgId, me.orgId),
              eq(orgJoinRequests.status, "pending"),
              eq(users.status, "pending")
            )
          );
        return Number(r?.c ?? 0);
      }
      if (me.role === "system_admin") {
        const [r] = await db
          .select({ c: count() })
          .from(orgJoinRequests)
          .innerJoin(users, eq(users.id, orgJoinRequests.userId))
          .where(
            and(
              eq(orgJoinRequests.status, "pending"),
              eq(users.status, "pending")
            )
          );
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
        // 단계별 진행 분포 — 진행 중(outcome NULL) 서류·면접 단계 + 최종 합격. 공고 목록의 단계 표시·진행 막대용.
        inResume: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('applied','screened') THEN 1 ELSE 0 END)`,
        inInterview: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('ai_pending','ai_evaluated','round1_candidate','round1_scheduling','round1_waiting','round1_passed','round2_passed') THEN 1 ELSE 0 END)`,
        hiredCount: sql<number>`SUM(CASE WHEN ${candidates.outcome} = 'hired' THEN 1 ELSE 0 END)`,
        // 평가 대기 = 아직 stage=applied (서류 평가 안 마침). 진행 중인 후보 수.
        screeningCount: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'applied' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        decidedCount: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NOT NULL THEN 1 ELSE 0 END)`,
        needsInterviewDecision: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'screened' THEN 1 ELSE 0 END)`,
        awaitingInterview: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'ai_pending' THEN 1 ELSE 0 END)`,
        needsFinalDecision: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'ai_evaluated' THEN 1 ELSE 0 END)`,
        needsRound1Schedule: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_candidate' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        // 2차 진행 결정 — 이미 2차 일정이 진행 중(active 스케줄 존재)인 후보는 제외
        // (lib/candidate-state.ts r2_decide 판정과 동일)
        needsRound2Decision: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_passed' AND ${candidates.outcome} IS NULL AND NOT EXISTS (SELECT 1 FROM interview_schedules s WHERE s.candidate_id = candidates.id AND s.round = 'round2' AND s.status IN ('pending','counter_proposed','selected')) THEN 1 ELSE 0 END)`,
        needsFinalOffer: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round2_passed' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
      })
      .from(jobPostings)
      .leftJoin(candidates, eq(candidates.jobId, jobPostings.id))
      .where(jobScopeFilter)
      .groupBy(jobPostings.id)
      .orderBy(
        // active 먼저, 그 안에서 최신순. 면접관 공고 우선 정렬은 JS 에서 재적용.
        sql`CASE WHEN ${jobPostings.status} = 'active' THEN 0 ELSE 1 END`,
        desc(jobPostings.createdAt)
      ),
    // 오늘 할 일 알림용 — 스코프 내 공고의 단계별 대기 카운트.
    // (멤버=내 면접 공고 / 법인담당자=법인 전체, jobScopeFilter 가 결정)
    db
      .select({
        jobId: jobPostings.id,
        title: jobPostings.title,
        orgId: jobPostings.orgId,
        passwordHash: jobPostings.passwordHash,
        pendingDecision: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'ai_evaluated' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        round1Candidates: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_candidate' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        round1Passed: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_passed' AND ${candidates.outcome} IS NULL AND NOT EXISTS (SELECT 1 FROM interview_schedules s WHERE s.candidate_id = candidates.id AND s.round = 'round2' AND s.status IN ('pending','counter_proposed','selected')) THEN 1 ELSE 0 END)`,
        round2Passed: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round2_passed' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        // 서류평가 완료 → 면접 진행 결정 (stage=screened). 공고 상세 "서류평가 후 면접 진행 결정"과 동일 집계.
        screenedDecision: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'screened' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
        // 서류 평가 조치 필요(실패·충전대기·미실행) — funnel route resumeActionNeeded 와 동일 판정.
        resumeActionNeeded: sql<number>`SUM(CASE WHEN ${candidates.stage} IN ('applied','screened') AND ${candidates.outcome} IS NULL AND (
          (SELECT s.status FROM screening_jobs s WHERE s.candidate_id = candidates.id ORDER BY s.id DESC LIMIT 1) IN ('failed','paused')
          OR ((SELECT s.status FROM screening_jobs s WHERE s.candidate_id = candidates.id ORDER BY s.id DESC LIMIT 1) IS NULL AND ${candidates.screeningReport} IS NULL)
        ) THEN 1 ELSE 0 END)`,
      })
      .from(jobPostings)
      .leftJoin(candidates, eq(candidates.jobId, jobPostings.id))
      .where(jobScopeFilter)
      .groupBy(jobPostings.id),
    // 역제시 알림 — 스코프 내 공고에서 status='counter_proposed' 인 스케쥴
    db
      .select({
        jobId: interviewSchedules.jobId,
        title: jobPostings.title,
        passwordHash: jobPostings.passwordHash,
        n: count(),
      })
      .from(interviewSchedules)
      .innerJoin(jobPostings, eq(jobPostings.id, interviewSchedules.jobId))
      .where(
        and(jobScopeFilter, eq(interviewSchedules.status, "counter_proposed"))
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
      .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
      .where(
        and(
          jobScopeFilter,
          eq(candidates.stage, "ai_pending"),
          sql`${candidates.outcome} IS NULL`,
          sql`EXISTS (SELECT 1 FROM interview_sessions s WHERE s.candidate_id = candidates.id AND s.status = 'expired')`,
          sql`NOT EXISTS (SELECT 1 FROM interview_sessions s WHERE s.candidate_id = candidates.id AND s.status IN ('pending','in_progress','completed'))`
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
      .innerJoin(jobPostings, eq(jobPostings.id, interviewSchedules.jobId))
      .innerJoin(candidates, eq(candidates.id, interviewSchedules.candidateId))
      .where(
        and(
          jobScopeFilter,
          eq(interviewSchedules.status, "selected"),
          sql`${candidates.outcome} IS NULL`,
          sql`datetime(json_extract(${interviewSchedules.selectedSlot}, '$.end')) <= datetime(${nowIso})`,
          sql`((${interviewSchedules.round} = 'round1' AND ${candidates.stage} = 'round1_waiting') OR (${interviewSchedules.round} = 'round2' AND ${candidates.stage} = 'round1_passed'))`,
          sql`NOT EXISTS (SELECT 1 FROM interview_schedules s2 WHERE s2.candidate_id = ${interviewSchedules.candidateId} AND s2.round = ${interviewSchedules.round} AND s2.id > ${interviewSchedules.id} AND s2.status IN ('pending','counter_proposed','selected'))`
        )
      )
      .groupBy(interviewSchedules.jobId, jobPostings.title),
    // -- 지원자 응답 대기 현황 (지원자 차례 — 공이 후보자에게 있는 상태) -------
    // candidate-state.ts 의 candidate-waiter 파생과 동일 판정을 SQL 로 재현:
    //   ai_pending + 최신 세션 pending/in_progress = AI 면접 응시 대기
    //   round1_scheduling + 최신 활성 1차 스케줄 = pending = 일정 응답 대기
    //   round1_passed + 최신 활성 2차 스케줄 = pending = 일정 응답 대기
    // ⚠️ 서브쿼리의 외부 참조는 리터럴 `candidates.id` — JOIN 없는 단일 FROM 쿼리에선
    //   Drizzle 이 `${candidates.id}` 를 접두어 없는 `"id"` 로 렌더해 서브쿼리 내부
    //   테이블의 id 로 오결합된다(항상 0). GOTCHAS §5. (JOIN 있는 위 쿼리들은 정규화돼 안전)
    db
      .select({
        aiWaiting: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'ai_pending' AND ${candidates.outcome} IS NULL AND (SELECT s.status FROM interview_sessions s WHERE s.candidate_id = candidates.id ORDER BY s.created_at DESC LIMIT 1) IN ('pending','in_progress') THEN 1 ELSE 0 END)`,
        r1Waiting: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_scheduling' AND ${candidates.outcome} IS NULL AND (SELECT s.status FROM interview_schedules s WHERE s.candidate_id = candidates.id AND s.round = 'round1' AND s.status IN ('pending','counter_proposed','selected') ORDER BY s.id DESC LIMIT 1) = 'pending' THEN 1 ELSE 0 END)`,
        r2Waiting: sql<number>`SUM(CASE WHEN ${candidates.stage} = 'round1_passed' AND ${candidates.outcome} IS NULL AND (SELECT s.status FROM interview_schedules s WHERE s.candidate_id = candidates.id AND s.round = 'round2' AND s.status IN ('pending','counter_proposed','selected') ORDER BY s.id DESC LIMIT 1) = 'pending' THEN 1 ELSE 0 END)`,
      })
      .from(candidates)
      .where(candScopeFilter)
      .then(([r]) => r),
    // -- 공고별 지원 추이 (게시일=0 기준 경과일별 신규, 최대 30일) -------------
    // 경과일 = floor(julianday(지원시각) - julianday(게시시각)). 24h 단위라 타임존 무관.
    // 누적은 JS 에서. 미게시(publishedAt NULL) 공고는 추이 대상 아님.
    db
      .select({
        jobId: candidates.jobId,
        elapsed: sql<number>`CAST(julianday(${candidates.createdAt}) - julianday(${jobPostings.publishedAt}) AS INTEGER)`,
        c: count(),
      })
      .from(candidates)
      .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
      .where(
        and(
          jobScopeFilter,
          sql`${jobPostings.publishedAt} IS NOT NULL`,
          sql`julianday(${candidates.createdAt}) - julianday(${jobPostings.publishedAt}) >= 0`,
          sql`julianday(${candidates.createdAt}) - julianday(${jobPostings.publishedAt}) < 31`
        )
      )
      .groupBy(
        candidates.jobId,
        sql`CAST(julianday(${candidates.createdAt}) - julianday(${jobPostings.publishedAt}) AS INTEGER)`
      ),
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

  // 잠금 일괄 판정 — 면접관 공고 집합은 위에서 1회 조회했으므로 공고당 DB 재조회 없이
  // 쿠키만으로 동기 판정한다 (기존엔 공고 × 알림 루프마다 2쿼리씩 발생).
  const unlocked = await getUnlockChecker(me, interviewerSet);

  // 공고 목록은 법인 전체. 내가 면접관인 공고를 맨 위로 끌어올리고, 그 안에서는
  // SQL orderBy(active 먼저·최신순)를 유지한다.
  const jobsWithActions = [...jobsRaw].sort((a, b) => {
    const ai = interviewerSet.has(a.id) ? 1 : 0;
    const bi = interviewerSet.has(b.id) ? 1 : 0;
    if (ai !== bi) return bi - ai;
    return 0;
  });

  // 잠긴 공고 체크 — 후보자 카운트 숨김
  const lockedJobIdsAtJobs = new Set<number>();
  for (const j of jobsWithActions) {
    if (j.passwordHash && !unlocked(j.id)) lockedJobIdsAtJobs.add(j.id);
  }

  // 알림 — 스코프 내 공고(멤버=내 면접 공고 / 법인담당자=법인 전체)에서 액션 대기 중인 항목.
  // 데이터 구조는 generic 하게 만들어, 알림 종류를 나중에 추가/조정 가능.
  type Notification = {
    id: string;
    icon: string;
    action: string; // 무엇을 해야 하는지 (예: "AI 면접 후 합·불 결정")
    jobTitle?: string; // 어떤 공고인지 — 공고 무관 알림(합류 요청)은 생략
    count: number;
    href: string;
    tone: "amber" | "blue" | "indigo" | "rose";
  };
  const notifications: Notification[] = [];
  for (const j of jobActionRows) {
    const locked = j.passwordHash != null && !unlocked(j.jobId);
    const jobTitle = locked ? "🔒 비공개" : j.title;
    // 파이프라인 순서 — 서류 평가 조치 → 서류평가 후 진행 결정 → (이하 AI/면접 단계)
    const resumeAction = Number(j.resumeActionNeeded);
    if (resumeAction > 0) {
      notifications.push({
        id: `resumeaction-${j.jobId}`,
        icon: "⚠️",
        action: "서류 평가 조치 (실패·미실행)",
        jobTitle,
        count: resumeAction,
        href: `/jobs/${j.jobId}?stage=resume_action`,
        tone: "amber",
      });
    }
    const screened = Number(j.screenedDecision);
    if (screened > 0) {
      notifications.push({
        id: `screened-${j.jobId}`,
        icon: "📄",
        action: "서류평가 후 면접 진행 결정",
        jobTitle,
        count: screened,
        href: `/jobs/${j.jobId}?stage=screened`,
        tone: "indigo",
      });
    }
    const decision = Number(j.pendingDecision);
    const round1Cand = Number(j.round1Candidates);
    if (decision > 0) {
      notifications.push({
        id: `decision-${j.jobId}`,
        icon: "🎯",
        action: "AI 면접 후 합·불 결정",
        jobTitle,
        count: decision,
        href: `/jobs/${j.jobId}?stage=ai_evaluated`,
        tone: "indigo",
      });
    }
    if (round1Cand > 0) {
      notifications.push({
        id: `round1cand-${j.jobId}`,
        icon: "📅",
        action: "1차 면접 일정 제시",
        jobTitle,
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
        action: "2차 면접 진행 결정",
        jobTitle,
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
        action: "최종 합격 결정",
        jobTitle,
        count: r2p,
        href: `/jobs/${j.jobId}?stage=round2_passed`,
        tone: "rose",
      });
    }
  }

  for (const r of counterRows) {
    const locked = r.passwordHash != null && !unlocked(r.jobId);
    const jobTitle = locked ? "🔒 비공개" : r.title;
    const n = Number(r.n);
    if (n > 0) {
      notifications.push({
        id: `counter-${r.jobId}`,
        icon: "↩️",
        action: "지원자 역제시 시간 확정",
        jobTitle,
        count: n,
        // pseudo 필터 — 같은 단계의 응답 대기자와 섞이지 않게 역제시 건만 표시
        href: `/jobs/${r.jobId}?stage=counter_proposed`,
        tone: "amber",
      });
    }
  }

  for (const r of expiredAiRows) {
    const locked = r.passwordHash != null && !unlocked(r.jobId);
    const jobTitle = locked ? "🔒 비공개" : r.title;
    const n = Number(r.n);
    if (n > 0) {
      notifications.push({
        id: `aiexp-${r.jobId}`,
        icon: "⏰",
        action: "AI 면접 링크 만료 · 재발송",
        jobTitle,
        count: n,
        href: `/jobs/${r.jobId}?stage=ai_link_expired`,
        tone: "amber",
      });
    }
  }

  for (const r of resultDueRows) {
    const locked = r.passwordHash != null && !unlocked(r.jobId);
    const jobTitle = locked ? "🔒 비공개" : r.title;
    const n = Number(r.n);
    if (n > 0) {
      notifications.push({
        id: `due-${r.jobId}`,
        icon: "📝",
        action: "면접 완료 · 결과 입력",
        jobTitle,
        count: n,
        href: `/jobs/${r.jobId}?stage=result_due`,
        tone: "indigo",
      });
    }
  }

  // 법인 합류 요청 승인 대기 — org_admin 의 할 일. KPI 에서 빼고 '오늘 할 일' 로 합류.
  if (me.role === "org_admin" && joinRequestCount > 0) {
    notifications.push({
      id: "join-requests",
      icon: "👥",
      action: "법인 합류 요청 승인",
      count: joinRequestCount,
      href: "/org/members",
      tone: "amber",
    });
  }

  // 우선순위: count 큰 순
  notifications.sort((a, b) => b.count - a.count);

  const totalCand = Number(candAgg?.total ?? 0);
  const decidedCount = Number(candAgg?.decided ?? 0);

  // -- KPI / 파이프라인 파생값 (전부 실집계) ----------------------------------
  const inProgressCand = totalCand - decidedCount;
  const hiredCount = Number(candAgg?.hired ?? 0);
  const newCandWeek = Number(candAgg?.newWeek ?? 0);
  // 채용 파이프라인 도넛 — 진행 중 단계 분포 + 합격. 색은 charts.tsx 팔레트와 동일 계열.
  const pipeline = [
    { label: "서류", value: Number(candAgg?.pipeResume ?? 0), color: "#94a3b8" },
    { label: "AI 면접", value: Number(candAgg?.pipeAi ?? 0), color: "#7c3aed" },
    { label: "1차 면접", value: Number(candAgg?.pipeR1 ?? 0), color: "#4f46e5" },
    { label: "2차 면접", value: Number(candAgg?.pipeR2 ?? 0), color: "#3b6ea5" },
    { label: "합격", value: hiredCount, color: "#2f8f6f" },
  ];
  const pipelineTotal = pipeline.reduce((s, p) => s + p.value, 0);

  // -- 지원자 응답 대기 현황 (공이 후보자에게 있는 상태) ------------------------
  const aiWaiting = Number(awaitingAgg?.aiWaiting ?? 0);
  const r1Waiting = Number(awaitingAgg?.r1Waiting ?? 0);
  const r2Waiting = Number(awaitingAgg?.r2Waiting ?? 0);
  const totalAwaiting = aiWaiting + r1Waiting + r2Waiting;

  // -- 공고별 지원 추이 시리즈 (게시일=0 기준 누적, 최대 30일) ------------------
  // member=내 면접 공고(보통 1개) / org_admin=법인 전체. 총량 큰 순 상위 N개만 라인.
  // 라인 길이는 공고마다 다름(게시 후 경과일+1) — X축은 0..최대길이, 짧은 공고는 자기 끝에서 멈춘다.
  const elapsedByJob = new Map<number, Map<number, number>>();
  for (const r of perJobElapsed) {
    let m = elapsedByJob.get(r.jobId);
    if (!m) {
      m = new Map();
      elapsedByJob.set(r.jobId, m);
    }
    m.set(Number(r.elapsed), Number(r.c));
  }
  const jobById = new Map(jobsWithActions.map((j) => [j.id, j]));
  const MS_DAY = 86_400_000;
  const trendSeriesAll = Array.from(elapsedByJob.keys()).map((jobId) => {
    const j = jobById.get(jobId);
    const em = elapsedByJob.get(jobId)!;
    // 게시 후 오늘까지 경과일(cap 30) — 라인이 미래 빈 구간까지 평평하게 늘어지지 않도록.
    const pub = j?.publishedAt ? new Date(j.publishedAt).getTime() : null;
    const elapsedToday =
      pub != null ? Math.min(30, Math.floor((Date.now() - pub) / MS_DAY)) : 0;
    let cum = 0;
    const data: number[] = [];
    for (let d = 0; d <= elapsedToday; d++) {
      cum += em.get(d) ?? 0;
      data.push(cum);
    }
    return { jobId, data, total: cum };
  });
  // 끝(현재 누적) 큰 순 상위 N. 라인이 너무 많으면 스파게티 → 팔레트 길이 안에서 제한.
  trendSeriesAll.sort((a, b) => b.total - a.total);
  const TREND_MAX_LINES = 6;
  const trendTop = trendSeriesAll.slice(0, TREND_MAX_LINES);
  const trendRest = trendSeriesAll.slice(TREND_MAX_LINES);
  const trendSeries = trendTop.map((s, i) => {
    const j = jobById.get(s.jobId);
    const locked = j?.passwordHash != null && !unlocked(s.jobId);
    return {
      label: locked ? "🔒 비공개" : (j?.title ?? `공고 #${s.jobId}`),
      color: CATEGORICAL[i % CATEGORICAL.length],
      data: s.data,
    };
  });
  const trendMaxLen = Math.max(0, ...trendSeries.map((s) => s.data.length));
  // x축: 게시 후 경과일(0,1,2,…). 마지막 라벨에만 "일" 단위를 붙여 축 의미를 분명히.
  const trendDayLabels = Array.from({ length: trendMaxLen }, (_, i) =>
    i === trendMaxLen - 1 && trendMaxLen > 1 ? `${i}일` : String(i)
  );
  const trendRestTotal = trendRest.reduce((s, r) => s + r.total, 0);
  const trendHasData = trendSeries.some(
    (s) => s.data.length > 0 && s.data[s.data.length - 1] > 0
  );

  const orgName = orgRow?.name ?? null;

  // 좌측 레일 접힘 상태(쿠키) — 이 페이지는 AppShellLayout 을 거치지 않고 셸을
  // 직접 렌더하므로 여기서도 동일하게 읽어 넘겨야 깜빡임이 없다.
  const railCollapsed =
    (await cookies()).get("iv_rail_collapsed")?.value === "1";

  return (
    <AppShell
      userName={me.name}
      role={me.role}
      isAdmin={me.isAdmin}
      isDev={process.env.NODE_ENV !== "production"}
      defaultCollapsed={railCollapsed}
    >
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {/* 환영 헤더 — 인사만. '새 공고' 1차 액션은 아래 공고 목록 섹션 헤더에 둔다(중복 제거). */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-ink">
          안녕하세요, {orgName ? `${orgName} ` : ""}{me.name} 님
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          {jobsWithActions.length === 0
            ? isOrgScope
              ? "Intervia 에 오신 걸 환영합니다. 첫 공고를 등록해 채용을 시작해 보세요."
              : "아직 면접관으로 지정된 공고가 없습니다. 좌측 ‘공고’ 메뉴에서 법인 전체 공고를 확인하세요."
            : "오늘의 채용 현황을 한눈에 확인하세요."}
        </p>
      </header>

      {/* 대시보드 본문 — KPI · 파이프라인 · 오늘 할 일 · 공고 목록 */}
      <>

      {/* 상단 KPI 카드 — 진행 공고 · 총 후보자 · AI 서류 평가 · 토큰 잔액 (전부 실집계).
         트렌드는 신뢰 가능한 것만(최근 7일 신규). 합류 요청은 '오늘 할 일' 로 이동. */}
      {/* 메인 2단 — 좌: KPI 4 + 파이프라인 / 우: 오늘 할 일(세로로 크게, 넘치면 내부 스크롤).
         오른쪽 패널을 KPI 행 높이까지 끌어올려, 처리 대기 항목이 많아도 한 화면에 더 많이 보이게 한다. */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6 lg:items-stretch">
        {/* 좌측 컬럼 — KPI 카드 + 큐 알림 + 파이프라인 */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* 상단 KPI 카드 — 진행 공고 · 총 후보자 · AI 서류 평가 · 토큰 잔액 (전부 실집계) */}
          <div className="grid grid-cols-3 gap-3 lg:items-stretch">
            {/* 공고별 지원 추이 — 최근 30일 누적 라인. member=내 면접 공고(보통 1개)
               / org_admin=법인 전체 상위 6개. '진행 공고·총 후보자' 숫자는 헤더로 흡수. */}
            <section className="col-span-2 bg-card border border-border-default rounded-2xl shadow-sm p-4 flex flex-col">
              <header className="mb-2 flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink">공고별 지원 추이</h2>
                  <p className="text-[11px] text-ink-soft mt-0.5">게시일부터 · 최대 30일 · 누적</p>
                </div>
                <div className="text-[11px] text-ink-soft text-right tabular-nums shrink-0">
                  총 {totalCand}명 · 진행 {inProgressCand}
                  {newCandWeek > 0 && (
                    <span className="text-success ml-1.5 font-medium">
                      ▲{newCandWeek} / 7일
                    </span>
                  )}
                </div>
              </header>
              {trendHasData ? (
                <MultiLineCumulative
                  series={trendSeries}
                  dayLabels={trendDayLabels}
                  height={200}
                  restCount={trendRest.length}
                  restTotal={trendRestTotal}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center min-h-[180px] text-center text-sm text-ink-soft px-4">
                  아직 표시할 지원 추이가 없습니다.
                </div>
              )}
            </section>
            <KpiCard
              label="토큰 잔액"
              value={tokenBalance != null ? tokenBalance.toLocaleString() : "-"}
              Icon={Coins}
              sub={
                tokenBalance != null && tokenBalance < 0
                  ? "마이너스 — 충전 필요"
                  : tokenBalance != null && tokenBalance > 0
                    ? `이력서 ${tokenEquivResumes.toLocaleString()}건 · 면접 ${tokenEquivInterviews.toLocaleString()}회 가능`
                    : undefined
              }
              href={me.role === "org_admin" ? "/org/tokens" : undefined}
              accent={tokenBalance != null && tokenBalance < 0 ? "rose" : "emerald"}
            >
              {me.role === "member" &&
                tokenBalance != null &&
                tokenBalance <= LOW_BALANCE_THRESHOLD && <TokenChargeRequestButton />}
            </KpiCard>
          </div>

          {/* AI 서류 평가 큐 알림 — 진행/대기 중일 때만 작게 표시 */}
          {queueCount > 0 && (
            <div className="flex items-center gap-2 text-xs bg-warning-soft border border-warning/30 rounded-lg px-4 py-2.5">
              <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
              <span className="text-ink">
                AI 서류 평가 큐{" "}
                <strong className="text-warning">{queueCount}건</strong> 진행
                중·대기 중
              </span>
            </div>
          )}

          {/* 채용 파이프라인 + 지원자 응답 대기 — 좌우 2분할. 둘 다 내가 면접관인 공고 기준 실집계. */}
          <section className="flex-1 bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
            <div className="grid sm:grid-cols-2">
              {/* 좌: 채용 파이프라인 (진행 중 단계 분포) — 도넛을 패널 영역 중앙에 크게 배치 */}
              <div className="p-5 flex flex-col">
                <header className="mb-4">
                  <h2 className="text-sm font-semibold text-ink">채용 파이프라인</h2>
                  <p className="text-xs text-ink-soft mt-0.5">진행 중 단계 분포</p>
                </header>
                <div className="flex-1 flex items-center justify-center min-h-[208px]">
                  {pipelineTotal > 0 ? (
                    <Donut
                      data={pipeline}
                      size={168}
                      thickness={26}
                      centerTop={String(pipelineTotal)}
                      centerSub="명"
                    />
                  ) : (
                    <p className="text-center text-sm text-ink-soft">
                      진행 중인 후보가 없습니다.
                    </p>
                  )}
                </div>
              </div>
              {/* 우: 지원자 응답 대기 (지원자 차례) */}
              <div className="p-5 border-t sm:border-t-0 sm:border-l border-border-default">
                <header className="mb-4">
                  <h2 className="text-sm font-semibold text-ink">지원자 응답 대기</h2>
                  <p className="text-xs text-ink-soft mt-0.5">
                    지원자 차례 · 회신을 기다리는 중
                  </p>
                </header>
                {totalAwaiting > 0 ? (
                  <div className="space-y-3">
                    <AwaitRow
                      label="AI 면접 응시"
                      desc="링크 발송 후 미응시"
                      value={aiWaiting}
                    />
                    <AwaitRow
                      label="1차 일정 회신"
                      desc="제시한 시간 응답 대기"
                      value={r1Waiting}
                    />
                    <AwaitRow
                      label="2차 일정 회신"
                      desc="제시한 시간 응답 대기"
                      value={r2Waiting}
                    />
                  </div>
                ) : (
                  <p className="py-10 text-center text-sm text-ink-soft">
                    회신 대기 중인 후보가 없습니다.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* 우측 컬럼 — 오늘 할 일. 좌측 전체 높이를 채우고, 항목이 많으면 내부 스크롤.
           lg 에서 absolute 로 셀을 채워, 알림이 많아도 행 높이를 키우지 않는다(좌측 기준 높이 유지). */}
        <div className="lg:col-span-1 lg:relative">
          <section className="bg-card border border-primary/20 rounded-2xl p-5 shadow-sm flex flex-col lg:absolute lg:inset-0">
            <header className="mb-3 shrink-0">
              <h2 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
                🔔 오늘 할 일
              </h2>
              <p className="text-xs text-ink-soft mt-0.5">
                {notifications.length > 0
                  ? `처리 대기 ${notifications.length}건 · 누르면 이동`
                  : "지금 바로 처리할 일 없음"}
              </p>
            </header>
            {notifications.length > 0 ? (
              <ul className="space-y-2 flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border transition-colors ${
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
                        <span className="text-base shrink-0">{n.icon}</span>
                        <span className="min-w-0 flex flex-col">
                          <span className="text-[13px] font-medium text-ink truncate leading-tight">
                            {n.action}
                          </span>
                          {n.jobTitle && (
                            <span className="text-[11px] text-ink-soft truncate leading-tight mt-0.5">
                              {n.jobTitle}
                            </span>
                          )}
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
              </ul>
            ) : (
              <div className="flex-1 flex items-center justify-center rounded-xl bg-surface-alt/60 border border-border-default px-4 py-8 text-center text-sm text-ink-soft">
                ✓ 처리할 일이 없습니다.
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 내 공고 — 스코프 내 공고(멤버=내 면접 공고 / 법인담당자=법인 전체). 행 클릭 시 공고
         상세로. 단계별 액션은 상세·'오늘 할 일'에서. 법인 전체 목록은 좌측 '공고' 메뉴에서. */}
      <section className="mb-8">
        <header className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">
            {isOrgScope ? "법인 공고" : "내 공고"}
          </h2>
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
              {isOrgScope
                ? "아직 등록된 공고가 없습니다."
                : "내가 면접관으로 지정된 공고가 없습니다."}
            </p>
            {/* 공고 등록은 입력 항목이 많아 PC에서만 지원 — 모바일은 안내 문구로 대체 */}
            <Link
              href={isOrgScope ? "/jobs/new" : "/jobs"}
              className="hidden sm:inline-block mt-3 text-xs text-primary hover:underline"
            >
              {isOrgScope ? "첫 공고 등록 →" : "법인 공고 전체 보기 →"}
            </Link>
            <p className="sm:hidden mt-3 text-xs text-ink-soft">
              {isOrgScope
                ? "공고 등록은 PC(데스크톱)에서 진행해 주세요."
                : "좌측 ‘공고’ 메뉴에서 법인 전체 공고를 확인하세요."}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
            {/* 열 헤더 (데스크톱) — 행과 동일한 flex gap-3 구조라 열이 정렬된다 */}
            <div className="hidden sm:flex items-center gap-3 px-4 py-2.5 border-b border-border-default text-[11px] font-medium text-ink-muted uppercase tracking-wider">
              <span className="flex-1">공고</span>
              <span className="w-11 text-center">지원자</span>
              <span className="w-11 text-center">서류</span>
              <span className="w-11 text-center">면접</span>
              <span className="w-11 text-center">합격</span>
              <span className="w-24 text-center">진행</span>
              <span className="w-12 text-center">마감</span>
              <span className="w-4" aria-hidden />
            </div>
            {jobsWithActions.map((j) => {
              const locked = lockedJobIdsAtJobs.has(j.id);
              const isClosed = j.status === "closed";
              const cnt = Number(j.candidateCount);
              const resume = Number(j.inResume);
              const interview = Number(j.inInterview);
              const hired = Number(j.hiredCount);
              const dLeft = j.closesAt
                ? Math.ceil(
                    (new Date(j.closesAt).getTime() - Date.now()) / 86_400_000
                  )
                : null;
              const dday = isClosed
                ? "종결"
                : dLeft == null
                  ? "—"
                  : dLeft <= 0
                    ? "만료"
                    : `D-${dLeft}`;
              const pct = (n: number) => (cnt > 0 ? (n / cnt) * 100 : 0);
              return (
                <JobRowLink
                  key={j.id}
                  jobId={j.id}
                  title={j.title}
                  locked={locked}
                  className="flex items-center gap-3 px-4 py-3 border-b border-border-default last:border-0 hover:bg-surface-alt/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {locked && (
                        <Lock className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                      )}
                      <span className="font-medium text-ink truncate">
                        {j.title}
                      </span>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                          isClosed
                            ? "bg-surface-alt text-ink-soft"
                            : "bg-success-soft text-success"
                        }`}
                      >
                        {!isClosed && (
                          <span className="w-1.5 h-1.5 rounded-full bg-success" />
                        )}
                        {isClosed ? "종결" : "진행 중"}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-muted mt-0.5 truncate">
                      {j.position} · {j.level} · {j.employmentType}
                      <span className="sm:hidden">
                        {" · "}지원 {locked ? "—" : cnt} · 서류{" "}
                        {locked ? "—" : resume} · 면접 {locked ? "—" : interview} ·
                        합격 {locked ? "—" : hired}
                      </span>
                    </div>
                  </div>
                  <div className="hidden sm:block w-11 text-center text-sm font-semibold text-ink tabular-nums">
                    {locked ? "—" : cnt}
                  </div>
                  <div className="hidden sm:block w-11 text-center text-sm text-ink-soft tabular-nums">
                    {locked ? "—" : resume}
                  </div>
                  <div className="hidden sm:block w-11 text-center text-sm text-ink-soft tabular-nums">
                    {locked ? "—" : interview}
                  </div>
                  <div className="hidden sm:block w-11 text-center text-sm font-semibold text-success tabular-nums">
                    {locked ? "—" : hired}
                  </div>
                  <div className="hidden sm:block w-24 text-center">
                    {locked || cnt === 0 ? (
                      <span className="text-[11px] text-ink-muted">—</span>
                    ) : (
                      <div
                        className="flex h-2 rounded-full overflow-hidden bg-surface-alt"
                        title={`서류 ${resume} · 면접 ${interview} · 합격 ${hired}`}
                      >
                        <div style={{ width: `${pct(resume)}%`, background: "#94a3b8" }} />
                        <div style={{ width: `${pct(interview)}%`, background: "#4f46e5" }} />
                        <div style={{ width: `${pct(hired)}%`, background: "#2f8f6f" }} />
                      </div>
                    )}
                  </div>
                  <div className="hidden sm:block w-12 text-center text-[11px] text-ink-soft">
                    {dday}
                  </div>
                  <ArrowRight className="w-4 h-4 text-ink-muted shrink-0" />
                </JobRowLink>
              );
            })}
          </div>
        )}
      </section>
        </>
    </main>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------

/** 지원자 응답 대기 한 줄 — 라벨/설명 + 우측 수치. 후보자 차례라 중립 톤(액션 강조 X). */
function AwaitRow({
  label,
  desc,
  value,
}: {
  label: string;
  desc: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-alt/50 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink truncate">{label}</div>
        <div className="text-[11px] text-ink-soft truncate">{desc}</div>
      </div>
      <span
        className={`shrink-0 text-lg font-bold tabular-nums ${
          value > 0 ? "text-ink" : "text-ink-muted"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  href,
  accent,
  trend,
  Icon,
  children,
}: {
  label: string;
  value: number | string;
  sub?: string;
  href?: string;
  accent: "blue" | "indigo" | "amber" | "emerald" | "rose" | "slate";
  /** 초록 상승 추이 한 줄 (예: "+5 최근 7일"). 실집계만 — 없으면 미표시. */
  trend?: string;
  /** 우상단 아이콘 (소프트 원형 배지). */
  Icon?: React.ComponentType<{ className?: string }>;
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
    <div className={`group bg-card border rounded-2xl px-4 py-3 shadow-sm h-full transition-all ${accentMap[accent]} ${href ? "hover:shadow-md hover:-translate-y-0.5 hover:border-primary/40" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-ink-soft font-medium">{label}</div>
        {Icon ? (
          <span className="w-7 h-7 rounded-lg bg-primary-soft text-primary-deep flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5" />
          </span>
        ) : href ? (
          <ArrowRight
            className="w-3.5 h-3.5 text-ink-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
            strokeWidth={2.5}
          />
        ) : null}
      </div>
      <div className="mt-1.5 text-xl font-bold text-ink tabular-nums">{value}</div>
      {trend && (
        <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-success">
          <TrendingUp className="w-3 h-3" strokeWidth={2.5} />
          {trend}
        </div>
      )}
      {sub && <div className="text-[11px] text-ink-soft mt-0.5">{sub}</div>}
      {children}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
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
          className="absolute -z-10 right-0 top-32 w-[400px] h-[400px] rounded-full bg-accent-soft/40 blur-3xl"
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
              <span className="text-reflect">AI 면접관에게 맡기세요.</span>
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
          <Stat value={67} unit="%" label="채용 사이클 단축" sub="한 달 → 열흘" />
          <Stat value={89} unit="%" label="후보자 응답률" sub="채팅 면접 완료 기준" />
          <Stat value={4.6} decimals={1} suffix="/5" label="인사담당자 만족도" sub="AI 평가 결과 설문 기준" />
          <Stat value={100} unit="%" label="일관된 평가 기준" sub="모든 후보자 동일 질문·루브릭" />
        </Container>
        <p className="text-center text-[11px] text-surface/40 pb-6 px-6">
          * 베타 사용자 내부 측정값 · 출시 후 실데이터로 갱신
        </p>
      </section>
      </div>

      <ProductTour />

      <WhyNotJobBoard />

      <section id="how" className="relative overflow-hidden scroll-mt-20">
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
          className="absolute -z-10 right-0 top-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-accent-soft/40 blur-3xl"
        />

        <Container width="xl" className="py-20 sm:py-24">
          <Reveal>
            <SectionHeading
              className="mb-14"
              eyebrow="How it works"
              eyebrowIcon={Workflow}
              title="채용 사이클의 80%를 자동화합니다"
              subtitle="실제 사용 순서를 7단계로 — 공고 등록부터 합·불 통보까지, 사람이 매번 할 필요 없는 일을 AI가 처리합니다."
            />
          </Reveal>

          {/* Flow — 7단계 캐러셀 (스크린샷 목업 + 말풍선 포인트) */}
          <Reveal>
            <HowItWorksCarousel />
          </Reveal>
        </Container>
      </section>

      <section
        id="features"
        className="bg-surface border-y border-border-default scroll-mt-20"
      >
        <Container width="lg" className="py-20 sm:py-24">
          <Reveal>
            <SectionHeading
              className="mb-10 sm:mb-12"
              eyebrow="전체 기능"
              eyebrowIcon={Sparkles}
              title="필요한 건 모두 있습니다."
              subtitle="공고 등록부터 합·불 통보까지, Intervia는 모두 가능합니다."
            />
          </Reveal>
          {/* 데스크톱: 9×6 벤토 테셀레이션(빈틈없는 완전팩) / 모바일: 2열 단순 흐름 */}
          <Reveal className="grid grid-cols-2 gap-3 lg:aspect-[3/2] lg:grid-cols-9 lg:grid-rows-6 lg:gap-3">
            {FEATURES.map((f) => (
              <FeatureTile key={f.title} {...f} />
            ))}
          </Reveal>
        </Container>
      </section>

      <section id="pricing" className="scroll-mt-20">
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
                <div className="mt-2 text-4xl sm:text-5xl font-bold tabular-nums text-accent">
                  {WELCOME_BONUS_TOKENS}{" "}
                  <span className="text-2xl font-medium text-surface opacity-80">토큰</span>
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

          {/* 충전 보너스 — 오픈베타 동안 ×배 부스트 */}
          <div className="mt-10 reveal">
            {CHARGE_BONUS_BOOSTED ? (
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent-soft border border-accent/40 text-sm font-bold text-accent-deep">
                  <Sparkles className="w-4 h-4" strokeWidth={2.5} aria-hidden />
                  보너스 토큰 {BETA_BONUS_MULTIPLIER}배 혜택!
                  <Sparkles className="w-4 h-4" strokeWidth={2.5} aria-hidden />
                </span>
                <p className="mt-2 text-[11px] text-ink-soft">
                  오픈베타 기간 한정 · {BETA.endsAtLabel}까지
                </p>
              </div>
            ) : (
              <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-soft text-center">
                많이 충전할수록 더 드립니다
              </h3>
            )}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {CHARGE_PACKAGES.filter((p) => p.bonusPct > 0).map((p) => (
                <BonusCell
                  key={p.krw}
                  krw={p.krw}
                  listPct={p.listBonusPct}
                  pct={p.bonusPct}
                  boosted={CHARGE_BONUS_BOOSTED}
                />
              ))}
            </div>
            <p className="mt-4 text-[11px] text-ink-soft text-center">
              진행 중인 평가·면접은 잔액이 부족해도 끝까지 완료됩니다(부족분은 다음 충전 시 자동 정산). 잔액이 0 이하가 되면 충전 전까지 신규 작업이 차단됩니다.
            </p>
          </div>
        </Container>
      </section>

      <section className="bg-surface">
        <Container width="xl" className="py-16 sm:py-24">
          <div className="relative overflow-hidden rounded-3xl bg-cta-gradient px-7 py-12 text-surface shadow-xl reveal sm:px-14 sm:py-16">
            {/* 장식용 일러스트(고정 에셋) — next/image 불필요. lazy: 페이지 하단 CTA 섹션이라
                모바일(hidden, display:none)은 아예 안 받고 데스크톱도 스크롤 근접 시에만 로드. */}
            <img
              src="/landing.png"
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute right-0 top-1/2 hidden w-[560px] max-w-[52%] -translate-y-1/2 select-none lg:block"
            />
            <div className="relative z-10 max-w-lg">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-accent/25 text-[11px] uppercase tracking-widest text-accent/80 mb-6">
                <span className="w-1 h-1 rounded-full bg-accent" />
                Get Started
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-surface">
                지금 바로 Intervia를 시작하세요
              </h2>
              <p className="mt-4 opacity-75 leading-relaxed">
                법인 계정 등록 후 몇 분 내에 첫 공고를 띄울 수 있습니다.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <Link
                  href="/signup"
                  className="h-12 px-6 rounded-lg bg-surface hover:bg-surface-alt text-ink font-semibold shadow-md transition-[color,background-color,box-shadow,transform] active:translate-y-px inline-flex items-center justify-center gap-1.5 border border-surface"
                >
                  무료로 시작하기
                  <span aria-hidden>→</span>
                </Link>
                <Link
                  href="/login"
                  className="h-12 px-6 rounded-lg bg-transparent hover:bg-white/10 text-surface font-semibold border border-white/30 transition-colors inline-flex items-center justify-center"
                >
                  이미 계정이 있어요
                </Link>
              </div>
            </div>
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
    <section id="compare" className="relative overflow-hidden bg-card border-y border-border-default scroll-mt-20">
      <div
        aria-hidden
        className="absolute -z-10 -left-40 top-1/3 w-[520px] h-[520px] rounded-full bg-primary-soft/50 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -z-10 right-0 top-10 w-[400px] h-[400px] rounded-full bg-accent-soft/40 blur-3xl"
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
          <div>
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
              <div className="resume-feed" style={{ height: 266 }}>
                <div className="resume-track">
                  {[...Array(6)].map((_, i) => (
                    <ResumeRow key={`r1-${i}`} />
                  ))}
                  {[...Array(6)].map((_, i) => (
                    <ResumeRow key={`r2-${i}`} />
                  ))}
                </div>
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
            <div className="relative rounded-2xl bg-card border-2 border-primary/25 ring-1 ring-primary/10 p-4 shadow-lg">
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
                      AI 평가 완료 · 6축 분석
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

              <ScreeningRadar />

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

              {/* 카드 우상단 모서리에 살짝 걸친 배지 — 핵심 포인트라 크게 */}
              <div className="absolute -top-[23px] right-[13px] z-20 rounded-xl bg-ink text-surface px-3.5 py-2 shadow-lg flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-surface" strokeWidth={2.5} />
                <span className="text-[13px] font-semibold">자동 평가 완료</span>
              </div>
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

function ResumeRow() {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-card border border-border-default px-3 py-2 mb-2">
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

// 이력서 서류 평가 6축 — 실제 제품(candidates/[id] BreakdownBlock)처럼 육각 레이더(좌) +
// 6축 점수 바(우)를 나란히. lib/screening.ts / screening-report.tsx SCREENING_AXES 와
// 동일 라벨·순서·가중치. (점수는 데모용 고정값)
function ScreeningRadar() {
  const axes = [
    { label: "기술 적합도", score: 92, weight: "20%" },
    { label: "경험 깊이", score: 86, weight: "20%" },
    { label: "직무 매칭도", score: 95, weight: "25%" },
    { label: "성과 임팩트", score: 80, weight: "15%" },
    { label: "재직 안정성", score: 76, weight: "10%" },
    { label: "성장·태도", score: 88, weight: "10%" },
  ];
  const S = 168;
  const c = S / 2;
  const R = 68;
  // 12시(-90°)부터 시계방향 60°씩 — screening-report 의 FitHexagon 과 동일 배치
  const pt = (i: number, radius: number): [number, number] => {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    return [c + radius * Math.cos(a), c + radius * Math.sin(a)];
  };
  const polyPoints = (radius: (i: number) => number) =>
    axes.map((_, i) => pt(i, radius(i)).join(",")).join(" ");
  const dataPoly = polyPoints((i) => (R * axes[i].score) / 100);
  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
      {/* 좌: 육각 레이더 — 6축 균형을 한눈에 (크게) */}
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="shrink-0 w-[164px] h-[164px]"
        role="img"
        aria-label="6축 적합도 레이더"
      >
        {[0.4, 0.7, 1].map((f, k) => (
          <polygon
            key={k}
            points={polyPoints(() => R * f)}
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
          />
        ))}
        {axes.map((_, i) => {
          const [x, y] = pt(i, R);
          return (
            <line
              key={i}
              x1={c}
              y1={c}
              x2={x}
              y2={y}
              stroke="var(--border)"
              strokeWidth="1"
            />
          );
        })}
        <polygon
          points={dataPoly}
          fill="var(--primary)"
          fillOpacity="0.16"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {axes.map((ax, i) => {
          const [x, y] = pt(i, (R * ax.score) / 100);
          return <circle key={i} cx={x} cy={y} r="3" fill="var(--primary)" />;
        })}
      </svg>
      {/* 우: 6축 점수 바 — 라벨·가중치·점수 */}
      <div className="w-full space-y-2 sm:w-auto sm:max-w-[260px] sm:flex-1">
        {axes.map((ax, i) => (
          <div key={ax.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-ink-soft">
                {ax.label}
                <span className="text-[9px] text-ink-muted ml-1">
                  {ax.weight}
                </span>
              </span>
              <span className="text-[11px] font-bold tabular-nums text-primary">
                {ax.score}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-full bg-surface-alt overflow-hidden">
              <div
                className="skill-flux h-full rounded-full bg-primary"
                style={
                  {
                    width: `${ax.score}%`,
                    "--skill-w": ax.score,
                    animationDelay: `${i * 0.3}s`,
                  } as React.CSSProperties
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type LucideIcon = React.ComponentType<{
  className?: string;
  strokeWidth?: number;
}>;

// 랜딩 "전체 기능" 벤토. 데스크톱(lg)은 12×5 격자에 col/row 명시 배치로 빈틈없이 채우고,
// 모바일은 위 그리드가 2열 단순 흐름으로 떨어진다. place 문자열은 Tailwind 가 스캔할 수 있게 리터럴로 둔다.
type FeatureTone = "forest" | "soft" | "beige" | "white";
type FeatureSize = "big" | "tall" | "wide" | "mini";

const TONE_CLASS: Record<FeatureTone, string> = {
  forest: "bg-primary border-primary",
  soft: "bg-primary-soft border-primary/15",
  beige: "bg-surface-alt border-border-default",
  white: "bg-card border-border-default",
};

const FEATURES: {
  Icon: LucideIcon;
  title: string;
  sub?: string;
  detail: string;
  badge?: string;
  tone: FeatureTone;
  size: FeatureSize;
  place: string;
}[] = [
  // 주요 — 2×2
  { Icon: ClipboardList, title: "공고 등록", sub: "URL 자동입력", detail: "채용사이트 URL만 붙여넣으면 제목·자격요건·인재상을 AI가 자동으로 채웁니다.", tone: "beige", size: "big", place: "lg:col-start-1 lg:col-span-2 lg:row-start-1 lg:row-span-2" },
  { Icon: MessageSquare, title: "AI 면접", sub: "인성 · 직무 · 심층채팅", detail: "인성검사 → 직무 객관식 → 꼬리물기 심층 채팅까지 토큰 기반 실시간으로 진행합니다.", tone: "forest", size: "big", place: "lg:col-start-4 lg:col-span-2 lg:row-start-1 lg:row-span-2" },
  { Icon: FileSearch, title: "이력서 평가", sub: "6축 적합도 · JD · 정성", detail: "직무 적합도를 6축으로 채점하고 JD 충족 여부·자기소개서까지 정성 검토합니다.", tone: "soft", size: "big", place: "lg:col-start-8 lg:col-span-2 lg:row-start-1 lg:row-span-2" },
  { Icon: Upload, title: "이력서 업로드", sub: "폴더 · ZIP · 지원링크", detail: "지원링크로 받거나 폴더·압축파일을 직접 업로드합니다 (최대 100MB, 개당 10MB).", tone: "white", size: "big", place: "lg:col-start-1 lg:col-span-2 lg:row-start-3 lg:row-span-2" },
  { Icon: ClipboardCheck, title: "AI 면접 평가", sub: "역량 수치화 + 컬처핏", detail: "기술·실무·커뮤니케이션·직무적합성을 수치화하고 컬처핏·Big Five 성향까지 분석합니다.", tone: "soft", size: "big", place: "lg:col-start-6 lg:col-span-2 lg:row-start-3 lg:row-span-2" },
  { Icon: Mic, title: "대면 면접 평가", sub: "녹음 · 화자분리", detail: "녹음 업로드·라이브 녹음으로 면접관/지원자 화자분리·전사 후 AI가 평가합니다.", badge: "beta", tone: "forest", size: "big", place: "lg:col-start-4 lg:col-span-2 lg:row-start-5 lg:row-span-2" },
  // 세로형 — 1×2
  { Icon: EyeOff, title: "개인정보 마스킹", detail: "이름·전화·주소를 자동 마스킹하고 이미지 이력서는 OCR로 읽어 처리합니다.", tone: "white", size: "tall", place: "lg:col-start-3 lg:row-start-1 lg:row-span-2" },
  { Icon: Coins, title: "토큰 과금", detail: "공고·이력서·면접 단위로 과금하고 평가 실패 시 토큰을 소모하지 않습니다.", tone: "beige", size: "tall", place: "lg:col-start-8 lg:row-start-4 lg:row-span-2" },
  { Icon: ShieldAlert, title: "부정행위 감지", detail: "붙여넣기·탭이탈을 집계하고 답변 문체로 대필 가능성을 보조 판단합니다.", tone: "soft", size: "tall", place: "lg:col-start-9 lg:row-start-4 lg:row-span-2" },
  // 가로형 — 2×1
  { Icon: CalendarClock, title: "면접 일정 · Zoom", detail: "슬롯을 제안하면 지원자가 확정·역제안하고, Zoom·캘린더가 자동 연동됩니다.", tone: "soft", size: "wide", place: "lg:col-start-6 lg:col-span-2 lg:row-start-1" },
  { Icon: ListChecks, title: "면접 문제 생성", detail: "이력서·평가 기반으로 1차 실무 / 2차 임원 컬처핏 질문지를 자동 생성합니다.", tone: "white", size: "wide", place: "lg:col-start-6 lg:col-span-2 lg:row-start-2" },
  { Icon: Building2, title: "법인 분리 · 권한", detail: "이메일 도메인으로 법인을 자동 분리하고, 관리자 승인제 + 3역할로 권한을 나눕니다.", tone: "beige", size: "wide", place: "lg:col-start-3 lg:col-span-2 lg:row-start-3" },
  { Icon: BarChart3, title: "결과 리포트", detail: "단계별 후보 분포와 평균 점수를 펀널로 보여주고 CSV로 내보냅니다.", tone: "white", size: "wide", place: "lg:col-start-8 lg:col-span-2 lg:row-start-3" },
  { Icon: Columns3, title: "후보자 비교", detail: "여러 후보의 점수·강점·우려를 한 화면에서 나란히 비교합니다.", tone: "beige", size: "wide", place: "lg:col-start-4 lg:col-span-2 lg:row-start-4" },
  { Icon: Bell, title: "지원자 알림", sub: "메일 · 카카오톡", detail: "면접 안내·일정 조율·합격 통보를 자사 메일과 카카오톡 알림톡으로 함께 보내 응답률을 높입니다.", tone: "forest", size: "wide", place: "lg:col-start-1 lg:col-span-2 lg:row-start-5" },
  { Icon: LayoutDashboard, title: "채용 대시보드", detail: "진행 중인 공고와 지금 내가 해야 할 일을 한눈에 모아 봅니다.", tone: "white", size: "wide", place: "lg:col-start-6 lg:col-span-2 lg:row-start-5" },
  // 보조 — 1×1
  { Icon: Lock, title: "공고 PIN", detail: "공고별 PIN으로 외부 지원 링크를 잠급니다.", tone: "white", size: "mini", place: "lg:col-start-5 lg:row-start-3" },
  { Icon: Share2, title: "공고 공유", detail: "같은 법인 멤버·이메일로 공고를 공유합니다.", tone: "beige", size: "mini", place: "lg:col-start-3 lg:row-start-4" },
  { Icon: Paperclip, title: "첨부 분리", detail: "포트폴리오·경력기술서를 자동으로 분리합니다.", tone: "white", size: "mini", place: "lg:col-start-3 lg:row-start-5" },
  { Icon: Fingerprint, title: "중복 차단", detail: "SHA-256 해시로 중복 이력서를 자동 차단합니다.", tone: "soft", size: "mini", place: "lg:col-start-1 lg:row-start-6" },
  { Icon: StickyNote, title: "면접관 메모", detail: "면접관별 스코어·메모를 남겨 함께 공유합니다.", tone: "beige", size: "mini", place: "lg:col-start-2 lg:row-start-6" },
  { Icon: Target, title: "인재상 · NCS", detail: "법인 선호 인재상·NCS 핵심역량을 설정합니다.", tone: "white", size: "mini", place: "lg:col-start-3 lg:row-start-6" },
  { Icon: Server, title: "메일 서버", detail: "법인 자체 SMTP를 연동해 발송합니다 (SPF/DKIM).", tone: "beige", size: "mini", place: "lg:col-start-6 lg:row-start-6" },
  { Icon: MapPin, title: "국내 AI", detail: "모든 AI 추론을 서울 리전에서 — 국외이전 없음.", tone: "soft", size: "mini", place: "lg:col-start-7 lg:row-start-6" },
  { Icon: ScrollText, title: "감사 · 이의제기", detail: "데이터 접근을 로그로 추적하고 이의제기를 받습니다.", tone: "white", size: "mini", place: "lg:col-start-8 lg:row-start-6" },
  { Icon: KeyRound, title: "계정 보안", detail: "MFA(2단계 인증)와 세션 관리를 지원합니다.", tone: "beige", size: "mini", place: "lg:col-start-9 lg:row-start-6" },
];

function FeatureTile({
  Icon,
  title,
  sub,
  detail,
  badge,
  tone,
  size,
  place,
}: {
  Icon: LucideIcon;
  title: string;
  sub?: string;
  detail: string;
  badge?: string;
  tone: FeatureTone;
  size: FeatureSize;
  place: string;
}) {
  const forest = tone === "forest";
  const mini = size === "mini";
  const iconColor = forest ? "text-surface/85" : "text-primary";
  const titleColor = forest ? "text-surface" : "text-ink";
  const Title = (
    <div
      className={cn(
        "font-semibold leading-tight",
        size === "big" ? "text-sm" : mini ? "text-[12px]" : "text-[13px]",
        titleColor,
      )}
    >
      {title}
      {badge && (
        <span className="ml-1 inline-block rounded-full bg-surface/25 px-1.5 py-px align-middle text-[9px] font-semibold text-surface">
          {badge}
        </span>
      )}
    </div>
  );
  return (
    <div
      className={cn(
        "group relative flex min-h-[80px] flex-col rounded-2xl border p-3 transition-all duration-200 hover:z-20 hover:-translate-y-0.5 hover:shadow-lg lg:min-h-0",
        !forest && "hover:border-border-strong",
        mini ? "items-center justify-center gap-1.5 text-center" : "justify-between gap-2",
        TONE_CLASS[tone],
        place,
      )}
    >
      <Icon className={cn(size === "big" ? "h-6 w-6" : mini ? "h-4 w-4" : "h-5 w-5", iconColor)} strokeWidth={2} />
      <div className={mini ? "" : "min-w-0"}>
        {Title}
        {sub && (
          <p className={cn("mt-0.5 text-[13px] leading-tight", forest ? "text-surface/75" : "text-ink-soft")}>
            {sub}
          </p>
        )}
      </div>
      {/* hover 시 셀 위로 펼쳐지는 상세 설명 (모바일·터치는 hover 없음 → 기본 미노출) */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 hidden min-h-full flex-col gap-1.5 rounded-2xl border p-3 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 lg:flex",
          mini && "items-center text-center",
          TONE_CLASS[tone],
        )}
      >
        <Icon className={cn(mini ? "h-4 w-4" : "h-5 w-5", iconColor)} strokeWidth={2} />
        {Title}
        <p className={cn("text-[13px] leading-snug", forest ? "text-surface/85" : "text-ink-soft")}>
          {detail}
        </p>
      </div>
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
      <div className="text-3xl sm:text-4xl font-bold tabular-nums tracking-tight text-accent">
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
  krw,
  listPct,
  pct,
  boosted,
}: {
  krw: number;
  /** 정가 보너스 % (베타 부스트 시 취소선으로 비교 표시). */
  listPct: number;
  /** 실제 적용 보너스 % (베타 반영). */
  pct: number;
  boosted: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 text-center ${
        boosted
          ? "bg-accent-soft/40 border-accent/30"
          : "bg-card border-border-default"
      }`}
    >
      <div className="text-[11px] text-ink-soft tabular-nums font-semibold">
        {(krw / 10000).toLocaleString()}만원+{boosted ? " 충전 시" : ""}
      </div>
      {boosted ? (
        <div className="mt-1 flex items-center justify-center gap-1 tabular-nums">
          <span className="text-sm font-semibold text-ink-soft/60 line-through">
            +{listPct}%
          </span>
          <span className="text-ink-soft/50" aria-hidden>
            →
          </span>
          <span className="text-xl font-bold text-accent-deep">+{pct}%</span>
        </div>
      ) : (
        <div className="mt-1 text-xl font-bold text-primary tabular-nums">
          +{pct}%
        </div>
      )}
      <div className="text-[10px] text-ink-muted mt-0.5">보너스 토큰</div>
    </div>
  );
}

// Step 컴포넌트는 FlowStep 으로 대체됨

import { db } from "@/lib/db";
import { jobPostings, candidates, jobInterviewers } from "@/lib/schema";
import { desc, eq, count, sql, and, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { jobOrgFilter } from "@/lib/tenant";
import JobsList from "../jobs-list";
import MyInterviewerJobsList from "../jobs-list-mine";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function JobsListPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const me = await getCurrentUser();
  const { mine } = await searchParams;
  // mine=1 → 로그인 계정이 면접관으로 지정된 공고만.
  const mineOnly = mine === "1";

  const orgWhere = me ? jobOrgFilter(me) : eq(jobPostings.id, -1);

  // '내가 면접관인 공고' — 진행 막대 + 단계별 '내 할 일'을 보여주는 전용 뷰.
  if (mineOnly && me) {
    const myJobs = await db
      .select({ jobId: jobInterviewers.jobId })
      .from(jobInterviewers)
      .where(eq(jobInterviewers.userId, me.id));
    const ids = myJobs.map((r) => r.jobId);
    const where = and(
      orgWhere,
      inArray(jobPostings.id, ids.length > 0 ? ids : [-1])
    );

    const jobs = await db
      .select({
        id: jobPostings.id,
        title: jobPostings.title,
        position: jobPostings.position,
        level: jobPostings.level,
        employmentType: jobPostings.employmentType,
        interviewDurationMinutes: jobPostings.interviewDurationMinutes,
        createdAt: jobPostings.createdAt,
        passwordHash: jobPostings.passwordHash,
        isDraft: jobPostings.isDraft,
        status: jobPostings.status,
        closesAt: jobPostings.closesAt,
        candidateCount: count(candidates.id),
        // 진행 막대 — 서류/면접 단계 진행 중 + 합격 (대시보드 공고목록과 동일 집계).
        inResume: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('applied','screened') THEN 1 ELSE 0 END), 0)`,
        inInterview: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('ai_pending','ai_evaluated','round1_candidate','round1_scheduling','round1_waiting','round1_passed','round2_passed') THEN 1 ELSE 0 END), 0)`,
        hiredCount: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.outcome} = 'hired' THEN 1 ELSE 0 END), 0)`,
        // '내 할 일' — 인사담당자(면접관) 액션 대기 단계만 (대시보드 알림과 동일 판정).
        screenedDecision: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.stage} = 'screened' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END), 0)`,
        pendingDecision: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.stage} = 'ai_evaluated' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END), 0)`,
        round1Candidates: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.stage} = 'round1_candidate' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END), 0)`,
        round1Passed: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.stage} = 'round1_passed' AND ${candidates.outcome} IS NULL AND NOT EXISTS (SELECT 1 FROM interview_schedules s WHERE s.candidate_id = candidates.id AND s.round = 'round2' AND s.status IN ('pending','counter_proposed','selected')) THEN 1 ELSE 0 END), 0)`,
        round2Passed: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.stage} = 'round2_passed' AND ${candidates.outcome} IS NULL THEN 1 ELSE 0 END), 0)`,
      })
      .from(jobPostings)
      .leftJoin(candidates, eq(candidates.jobId, jobPostings.id))
      .where(and(where))
      .groupBy(jobPostings.id)
      // 진행 중(active) 공고 먼저, 그 안에서 최신순.
      .orderBy(
        sql`CASE WHEN ${jobPostings.status} = 'active' THEN 0 ELSE 1 END`,
        desc(jobPostings.createdAt)
      );

    const serialized = jobs.map(({ passwordHash, ...j }) => ({
      ...j,
      hasPassword: passwordHash != null,
      candidateCount: Number(j.candidateCount),
      inResume: Number(j.inResume),
      inInterview: Number(j.inInterview),
      hiredCount: Number(j.hiredCount),
      screenedDecision: Number(j.screenedDecision),
      pendingDecision: Number(j.pendingDecision),
      round1Candidates: Number(j.round1Candidates),
      round1Passed: Number(j.round1Passed),
      round2Passed: Number(j.round2Passed),
    }));

    return (
      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-8">
          <Link href="/" className="text-xs text-ink-muted hover:text-ink">
            ← 대시보드
          </Link>
          <h1 className="text-2xl font-bold text-ink mt-1">
            내가 면접관인 공고
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            내가 면접관으로 지정된 공고 {serialized.length}건
          </p>
        </div>

        <MyInterviewerJobsList jobs={serialized} />
      </main>
    );
  }

  // 공고 관리 (전체) — 기존 뷰 유지.
  const jobs = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      position: jobPostings.position,
      level: jobPostings.level,
      employmentType: jobPostings.employmentType,
      interviewDurationMinutes: jobPostings.interviewDurationMinutes,
      createdAt: jobPostings.createdAt,
      passwordHash: jobPostings.passwordHash,
      isDraft: jobPostings.isDraft,
      candidateCount: count(candidates.id),
      // 서류평가 완료 = screening_score 가 기록된 후보 수
      screenedCount: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.screeningScore} IS NOT NULL THEN 1 ELSE 0 END), 0)`,
      // 면접 완료 = stage 가 round1_passed 이상까지 진행된 후보 수 (AI면접 평가 마친 후 1차 면접 후보 이상)
      interviewedCount: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.stage} IN ('round1_candidate','round1_scheduling','round1_waiting','round1_passed','round2_passed') THEN 1 ELSE 0 END), 0)`,
    })
    .from(jobPostings)
    .leftJoin(candidates, eq(candidates.jobId, jobPostings.id))
    .where(and(orgWhere))
    .groupBy(jobPostings.id)
    .orderBy(desc(jobPostings.createdAt));

  const serialized = jobs.map(({ passwordHash, ...j }) => ({
    ...j,
    hasPassword: passwordHash != null,
    candidateCount: Number(j.candidateCount),
    screenedCount: Number(j.screenedCount),
    interviewedCount: Number(j.interviewedCount),
  }));

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-end justify-between mb-8">
        <div>
          <Link href="/" className="text-xs text-ink-muted hover:text-ink">
            ← 대시보드
          </Link>
          <h1 className="text-2xl font-bold text-ink mt-1">공고 관리</h1>
          <p className="text-sm text-ink-muted mt-1">
            등록된 채용 공고 {serialized.length}건
          </p>
        </div>
      </div>

      <JobsList jobs={serialized} isAdmin={me?.isAdmin ?? false} />
    </main>
  );
}

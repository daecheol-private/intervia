import { db } from "@/lib/db";
import { jobPostings, candidates, jobInterviewers } from "@/lib/schema";
import { desc, eq, count, sql, and, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { jobOrgFilter } from "@/lib/tenant";
import JobsList from "../jobs-list";
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
  let where = orgWhere;
  if (mineOnly && me) {
    const myJobs = await db
      .select({ jobId: jobInterviewers.jobId })
      .from(jobInterviewers)
      .where(eq(jobInterviewers.userId, me.id));
    const ids = myJobs.map((r) => r.jobId);
    // 면접관인 공고가 없으면 빈 결과가 되도록 불가능 조건.
    where = and(orgWhere, inArray(jobPostings.id, ids.length > 0 ? ids : [-1]))!;
  }

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
    .where(and(where))
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
          <Link href="/" className="text-xs text-slate-500 hover:text-slate-900">
            ← 대시보드
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            {mineOnly ? "내가 면접관인 공고" : "공고 관리"}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {mineOnly
              ? `내가 면접관으로 지정된 공고 ${serialized.length}건`
              : `등록된 채용 공고 ${serialized.length}건`}
          </p>
        </div>
      </div>

      <JobsList jobs={serialized} isAdmin={me?.isAdmin ?? false} />
    </main>
  );
}

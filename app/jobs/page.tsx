import { db } from "@/lib/db";
import { jobPostings, candidates, jobInterviewers } from "@/lib/schema";
import { desc, eq, count, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { jobOrgFilter } from "@/lib/tenant";
import { getUnlockChecker } from "@/lib/job-lock";
import JobsAllList from "../jobs-list-all";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * '공고' 메뉴 — 법인 전체 공고. 공고 전용 화면이라 대시보드 공고 표 이상으로 보여준다.
 *  - 카드 크기·형태는 면접관 여부와 무관하게 동일. 면접관 공고만 상단에 모아 정렬.
 *  - 잠긴 공고(PIN)는 카드는 그대로, 지원 현황 수치만 블라인드(클릭 시 PIN 팝업).
 *    면접관·법인담당자·관리자·언락 쿠키 보유자는 잠금 우회 → 그대로 공개.
 */
export default async function JobsListPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const orgWhere = jobOrgFilter(me); // system_admin 은 undefined(전체)

  // 내가 면접관으로 지정된 공고 id — 상단 정렬 + 잠금 우회 기준.
  const myRows = await db
    .select({ jobId: jobInterviewers.jobId })
    .from(jobInterviewers)
    .where(eq(jobInterviewers.userId, me.id));
  const mineSet = new Set(myRows.map((r) => r.jobId));

  // 전체 공고 + 지원 현황 집계 — 칼럼은 대시보드 공고 표와 동일(지원자/서류/면접/합격).
  const rows = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      position: jobPostings.position,
      level: jobPostings.level,
      employmentType: jobPostings.employmentType,
      interviewDurationMinutes: jobPostings.interviewDurationMinutes,
      createdAt: jobPostings.createdAt,
      status: jobPostings.status,
      isDraft: jobPostings.isDraft,
      closesAt: jobPostings.closesAt,
      passwordHash: jobPostings.passwordHash,
      candidateCount: count(candidates.id),
      inResume: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('applied','screened') THEN 1 ELSE 0 END), 0)`,
      inInterview: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.outcome} IS NULL AND ${candidates.stage} IN ('ai_pending','ai_evaluated','round1_candidate','round1_scheduling','round1_waiting','round1_passed','round2_passed') THEN 1 ELSE 0 END), 0)`,
      hiredCount: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.outcome} = 'hired' THEN 1 ELSE 0 END), 0)`,
    })
    .from(jobPostings)
    .leftJoin(candidates, eq(candidates.jobId, jobPostings.id))
    .where(orgWhere)
    .groupBy(jobPostings.id)
    .orderBy(desc(jobPostings.createdAt));

  // 잠금 판정 — 면접관 집합/법인담당자/관리자/언락 쿠키를 한 번에 본다.
  const unlocked = await getUnlockChecker(me, mineSet);

  const serialized = rows.map(({ passwordHash, ...j }) => {
    const mine = mineSet.has(j.id);
    // 블라인드 = PIN 있고 + 내가 우회 권한 없음. 블라인드 공고는 수치를 클라이언트로 미전송.
    const blinded = passwordHash != null && !unlocked(j.id);
    const base = {
      id: j.id,
      title: j.title,
      position: j.position,
      level: j.level,
      employmentType: j.employmentType,
      interviewDurationMinutes: j.interviewDurationMinutes,
      createdAt: j.createdAt,
      status: j.status ?? undefined,
      isDraft: j.isDraft ?? undefined,
      closesAt: j.closesAt ?? undefined,
      hasPassword: passwordHash != null,
      mine,
      blinded,
    };
    if (blinded) return base;
    return {
      ...base,
      candidateCount: Number(j.candidateCount),
      inResume: Number(j.inResume),
      inInterview: Number(j.inInterview),
      hiredCount: Number(j.hiredCount),
    };
  });

  // 내가 면접관인 공고 먼저, 그 안/밖 모두 최신순(rows 이미 createdAt desc).
  serialized.sort((a, b) => {
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-end justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-ink">공고</h1>
          </div>
          <p className="text-sm text-ink-soft mt-1">
            법인 전체 공고 {serialized.length}건 · 내가 면접관인 공고를 먼저 표시
          </p>
        </div>
        <Link
          href="/jobs/new"
          className="hidden sm:inline-flex items-center text-sm font-medium px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface transition-colors shrink-0"
        >
          + 새 공고
        </Link>
      </div>

      <JobsAllList jobs={serialized} />
    </main>
  );
}

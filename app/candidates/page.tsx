import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { candidates, jobPostings, jobInterviewers } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { candidateOrgFilter } from "@/lib/tenant";
import { getUnlockChecker } from "@/lib/job-lock";
import { AppShell } from "@/app/components/AppShell";
import { CandidateTable, type CandidateRow } from "./candidate-table";

export const dynamic = "force-dynamic";

/**
 * 후보자 통합 목록 — 공고를 가로질러 모든 후보자를 한 화면에서 검색·필터·정렬.
 * 데이터 범위(역할별 차등): member = 자기가 면접관인 공고만 / org_admin = 법인 전체.
 * (system_admin 은 /admin/candidates 의 cross-org 권리요청 화면으로 분리)
 */
export default async function CandidatesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role === "system_admin") redirect("/admin/candidates");

  // 면접관 배정 공고 — member 스코프 제한 + (역할 무관) PIN 우회 판정에 함께 쓴다.
  const ir = await db
    .select({ jobId: jobInterviewers.jobId })
    .from(jobInterviewers)
    .where(eq(jobInterviewers.userId, me.id));
  const myJobIds = ir.map((r) => r.jobId);
  const interviewerSet = new Set(myJobIds);
  // 데이터 범위(역할별 차등): org_admin = 법인 전체 / member = 면접관 배정 공고만.
  const scopeFilter =
    me.role === "org_admin"
      ? candidateOrgFilter(me)
      : and(
          candidateOrgFilter(me),
          inArray(candidates.jobId, myJobIds.length ? myJobIds : [-1])
        );

  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      email: candidates.email,
      phone: candidates.phone,
      photoFilePath: candidates.photoFilePath,
      careerYears: candidates.careerYears,
      age: candidates.age,
      educationLevel: candidates.educationLevel,
      educationSchool: candidates.educationSchool,
      educationMajor: candidates.educationMajor,
      screeningScore: candidates.screeningScore,
      screeningReport: candidates.screeningReport,
      stage: candidates.stage,
      outcome: candidates.outcome,
      createdAt: candidates.createdAt,
      jobId: candidates.jobId,
      jobTitle: jobPostings.title,
      jobPasswordHash: jobPostings.passwordHash,
    })
    .from(candidates)
    .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .where(scopeFilter)
    .orderBy(desc(candidates.createdAt));

  // 잠긴 공고(PIN) 후보는 민감정보를 서버에서 비우고 마스킹해 내려보낸다(클라 미전송).
  const unlocked = await getUnlockChecker(me, interviewerSet);
  const tableRows: CandidateRow[] = rows.map((r) => {
    const locked = r.jobPasswordHash != null && !unlocked(r.jobId);
    if (locked) {
      return {
        id: r.id,
        name: "🔒 비공개",
        email: null,
        phone: null,
        photoFilePath: null,
        careerYears: null,
        age: null,
        educationLevel: null,
        educationSchool: null,
        educationMajor: null,
        screeningScore: null,
        recommendation: null,
        stage: r.stage,
        outcome: r.outcome,
        createdAt: r.createdAt,
        jobId: r.jobId,
        jobTitle: "🔒 비공개 공고",
        locked: true,
      };
    }
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      photoFilePath: r.photoFilePath,
      careerYears: r.careerYears,
      age: r.age,
      educationLevel: r.educationLevel,
      educationSchool: r.educationSchool,
      educationMajor: r.educationMajor,
      screeningScore: r.screeningScore,
      recommendation: r.screeningReport?.recommendation ?? null,
      stage: r.stage,
      outcome: r.outcome,
      createdAt: r.createdAt,
      jobId: r.jobId,
      jobTitle: r.jobTitle,
      locked: false,
    };
  });

  // 공고 필터 드롭다운 — 잠금 해제된 공고만(잠긴 건 내용이 가려져 의미 없음).
  const jobMap = new Map<number, string>();
  for (const r of tableRows) if (!r.locked) jobMap.set(r.jobId, r.jobTitle);
  const jobs = [...jobMap.entries()]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title, "ko"));

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
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-ink">후보자</h1>
          <p className="text-sm text-ink-soft mt-1">
            {me.role === "org_admin"
              ? "법인의 모든 공고 후보자를 한 곳에서 확인하세요."
              : "내가 면접관으로 참여하는 공고의 후보자를 한 곳에서 확인하세요."}
          </p>
        </header>
        <CandidateTable rows={tableRows} jobs={jobs} />
      </main>
    </AppShell>
  );
}

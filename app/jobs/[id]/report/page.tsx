import { db } from "@/lib/db";
import {
  jobPostings,
  candidates,
  interviewSessions,
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
import { PrintButton } from "./PrintButton";

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

  return (
    <main className="max-w-4xl mx-auto w-full px-6 py-8 print:px-0 print:py-0 print:max-w-none">
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
            </span>
          </span>
        ))}
      </div>
    </>
  );
}

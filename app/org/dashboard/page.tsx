"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { STAGE_META } from "@/lib/stage-meta";
import { Donut, VBars, HBars, TimeArea, C } from "@/components/charts";

type JobStat = {
  id: number;
  title: string;
  status: string;
  closesAt: string | null;
  total: number;
  inProgress: number;
  hired: number;
  rejected: number;
  withdrawn: number;
  avgScore: number | null;
  avgDecisionDays: number | null;
};

type Pending = {
  who: string;
  label: string;
  count: number;
  stages: { stage: string; count: number }[];
};

type Dashboard = {
  daysBack: number;
  kpi: {
    total: number;
    inProgress: number;
    hired: number;
    rejected: number;
    withdrawn: number;
    hireRate: number | null;
    activeJobs: number;
    recentCount: number;
    avgDecisionDays: number | null;
    avgScreeningScore: number | null;
  };
  funnel: { label: string; count: number }[];
  pipeline: Record<string, number>;
  pending: Pending[];
  outcomes: Record<string, number>;
  jobs: JobStat[];
  timeseries: { label: string; value: number }[];
  bucketDays: number;
  scoreBuckets: { label: string; value: number }[];
  scoreScored: number;
  recommendations: Record<string, number>;
};

const WAITER_TONE: Record<string, string> = {
  hr: "bg-primary-soft border-primary/30 text-primary-deep",
  candidate: "bg-surface-alt border-border-default text-ink-soft",
  interviewer: "bg-surface-alt border-border-default text-ink-soft",
  system: "bg-surface-alt border-border-default text-ink-soft",
  none: "bg-surface-alt border-border-default text-ink-muted",
};

const REC_COLOR: Record<string, string> = {
  강력추천: C.primary,
  추천: C.good,
  보류: C.warn,
  비추천: C.muted,
};

export default function OrgDashboardPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    fetch(`/api/org/funnel?days=${days}`)
      .then(async (r) => {
        if (!r.ok) {
          setErr(
            r.status === 403
              ? "이 페이지는 법인 관리자만 볼 수 있습니다."
              : await r.text()
          );
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch(() => setErr("불러오기에 실패했습니다."));
  }, [days]);

  const funnelBase = data?.funnel[0]?.count || 1;
  const maxJobTotal = data
    ? Math.max(1, ...data.jobs.map((j) => j.total))
    : 1;
  const outcomeTotal = data
    ? (data.outcomes.hired ?? 0) +
      (data.outcomes.rejected ?? 0) +
      (data.outcomes.withdrawn ?? 0) +
      data.kpi.inProgress
    : 0;
  const recTotal = data
    ? Object.values(data.recommendations).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <main className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">채용 현황 대시보드</h1>
          <p className="text-sm text-ink-soft mt-1">
            우리 법인의 전체 공고·후보자 현황을 한눈에 봅니다.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="border border-border-strong rounded-lg px-3 py-2 text-sm bg-card"
        >
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
          <option value={90}>최근 90일</option>
          <option value={365}>최근 1년</option>
        </select>
      </div>

      {err && (
        <div className="bg-danger-soft border border-danger/30 text-danger rounded-2xl p-5 text-sm">
          {err}
        </div>
      )}

      {!err && !data && (
        <div className="text-sm text-ink-muted py-16 text-center">
          불러오는 중...
        </div>
      )}

      {data && (
        <div className="space-y-5">
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Stat label="전체 후보자" value={`${data.kpi.total}`} />
            <Stat label="진행 중" value={`${data.kpi.inProgress}`} tone="primary" />
            <Stat label="최종 합격" value={`${data.kpi.hired}`} tone="success" />
            <Stat
              label="합격률"
              value={
                data.kpi.hireRate != null
                  ? `${Math.round(data.kpi.hireRate * 100)}%`
                  : "-"
              }
              sub="결정 대비"
            />
            <Stat
              label="평균 처리기간"
              value={
                data.kpi.avgDecisionDays != null
                  ? `${data.kpi.avgDecisionDays}일`
                  : "-"
              }
            />
            <Stat label="활성 공고" value={`${data.kpi.activeJobs}`} />
          </div>

          {/* 전사 퍼널 + 신규 지원 추이 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="bg-card border border-border-default rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink mb-4">
                전사 채용 퍼널
              </h2>
              <div className="space-y-1.5">
                {data.funnel.map((f, i) => {
                  const w = (f.count / funnelBase) * 100;
                  const conv =
                    i === 0
                      ? null
                      : data.funnel[i - 1].count > 0
                        ? Math.round(
                            (f.count / data.funnel[i - 1].count) * 100
                          )
                        : 0;
                  return (
                    <div
                      key={f.label}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="w-20 shrink-0 text-ink-soft">
                        {f.label}
                      </span>
                      <div className="flex-1 bg-surface-alt rounded h-5 relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded"
                          style={{
                            width: `${w}%`,
                            background: C.primary,
                            opacity: 0.3 + 0.7 * (1 - i / data.funnel.length),
                          }}
                        />
                        <span className="absolute inset-0 flex items-center px-2 text-[10px] text-ink font-semibold tabular-nums">
                          {f.count}
                          <span className="text-ink-muted font-normal ml-1">
                            ({Math.round((f.count / funnelBase) * 100)}%)
                          </span>
                        </span>
                      </div>
                      <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-ink-muted">
                        {conv != null ? `↳${conv}%` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="bg-card border border-border-default rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink mb-4">
                신규 지원 추이{" "}
                <span className="text-xs font-normal text-ink-muted">
                  ({data.bucketDays === 1 ? "일별" : `${data.bucketDays}일 단위`})
                </span>
              </h2>
              {data.kpi.recentCount > 0 ? (
                <TimeArea points={data.timeseries} unit="명" />
              ) : (
                <p className="text-sm text-ink-muted py-8 text-center">
                  최근 {data.daysBack}일 신규 지원이 없습니다.
                </p>
              )}
            </section>
          </div>

          {/* 액션 필요 — 단계별 대기 */}
          <section className="bg-card border border-border-default rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-ink mb-1">
              지금 처리할 일
            </h2>
            <p className="text-xs text-ink-muted mb-4">
              진행 중 후보를 “누가 공을 쥐고 있나” 기준으로 묶었습니다. HR 처리
              대기가 곧 오늘의 액션 아이템입니다.
            </p>
            {data.pending.length === 0 ? (
              <p className="text-sm text-ink-muted py-4 text-center">
                진행 중인 후보자가 없습니다.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {data.pending.map((p) => (
                  <div
                    key={p.who}
                    className={`border rounded-xl p-3 ${
                      WAITER_TONE[p.who] ?? WAITER_TONE.none
                    }`}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-medium">{p.label}</span>
                      <span className="text-xl font-bold tabular-nums">
                        {p.count}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-0.5">
                      {p.stages.slice(0, 4).map((s) => {
                        const meta = STAGE_META[s.stage as keyof typeof STAGE_META];
                        const label = meta
                          ? meta.sub
                            ? `${meta.main}·${meta.sub}`
                            : meta.main
                          : s.stage;
                        return (
                          <li
                            key={s.stage}
                            className="flex justify-between text-[10px] opacity-80"
                          >
                            <span className="truncate">{label}</span>
                            <span className="tabular-nums ml-1">{s.count}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 공고별 현황 비교 */}
          <section className="bg-card border border-border-default rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-ink mb-4">
              공고별 현황 비교
            </h2>
            {data.jobs.length === 0 ? (
              <p className="text-sm text-ink-muted py-4 text-center">
                공고가 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-ink-muted border-b border-border-default">
                    <tr>
                      <th className="text-left font-medium py-2 pr-2">공고</th>
                      <th className="text-left font-medium py-2 px-2 w-40">
                        지원 분포
                      </th>
                      <th className="text-right font-medium py-2 px-2">지원</th>
                      <th className="text-right font-medium py-2 px-2">진행</th>
                      <th className="text-right font-medium py-2 px-2">합격</th>
                      <th className="text-right font-medium py-2 px-2">
                        평균점수
                      </th>
                      <th className="text-right font-medium py-2 pl-2">
                        평균처리
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {data.jobs.map((j) => (
                      <tr key={j.id} className="hover:bg-surface-alt">
                        <td className="py-2 pr-2 max-w-[180px]">
                          <Link
                            href={`/jobs/${j.id}/report`}
                            className="text-ink hover:text-primary font-medium line-clamp-1"
                            title={j.title}
                          >
                            {j.title}
                          </Link>
                          <span
                            className={`text-[10px] ${
                              j.status === "active"
                                ? "text-primary"
                                : "text-ink-muted"
                            }`}
                          >
                            {j.status === "active" ? "진행 중" : "종결"}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex h-4 rounded overflow-hidden bg-surface-alt">
                            <Seg n={j.hired} total={j.total} color={C.primary} />
                            <Seg
                              n={j.inProgress}
                              total={j.total}
                              color={C.blue}
                            />
                            <Seg
                              n={j.rejected}
                              total={j.total}
                              color={C.muted}
                            />
                            <Seg
                              n={j.withdrawn}
                              total={j.total}
                              color={C.mutedSoft}
                            />
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium text-ink">
                          {j.total}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-ink-soft">
                          {j.inProgress}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-primary-deep">
                          {j.hired}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">
                          {j.avgScore ?? "-"}
                        </td>
                        <td className="py-2 pl-2 text-right tabular-nums text-ink-soft">
                          {j.avgDecisionDays != null
                            ? `${j.avgDecisionDays}일`
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] text-ink-muted">
                  <Legend color={C.primary} label="합격" />
                  <Legend color={C.blue} label="진행 중" />
                  <Legend color={C.muted} label="불합격" />
                  <Legend color={C.mutedSoft} label="지원 취소" />
                </div>
              </div>
            )}
          </section>

          {/* 분포: 결정 / 점수 / 추천등급 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <section className="bg-card border border-border-default rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink mb-4">결정 분포</h2>
              {outcomeTotal > 0 ? (
                <Donut
                  centerTop={`${data.kpi.total}`}
                  centerSub="전체"
                  data={[
                    { label: "최종 합격", value: data.outcomes.hired ?? 0, color: C.primary },
                    { label: "진행 중", value: data.kpi.inProgress, color: C.blue },
                    { label: "불합격", value: data.outcomes.rejected ?? 0, color: C.muted },
                    { label: "지원 취소", value: data.outcomes.withdrawn ?? 0, color: C.mutedSoft },
                  ]}
                />
              ) : (
                <p className="text-sm text-ink-muted py-8 text-center">
                  데이터 없음
                </p>
              )}
            </section>

            <section className="bg-card border border-border-default rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink mb-4">
                서류 점수 분포
              </h2>
              {data.scoreScored > 0 ? (
                <>
                  <VBars bars={data.scoreBuckets} color={C.blue} height={130} />
                  <p className="text-[10px] text-ink-muted mt-2 text-right">
                    {data.scoreScored}명 평가 · 평균{" "}
                    {data.kpi.avgScreeningScore ?? "-"}점
                  </p>
                </>
              ) : (
                <p className="text-sm text-ink-muted py-8 text-center">
                  평가된 후보가 없습니다.
                </p>
              )}
            </section>

            <section className="bg-card border border-border-default rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-ink mb-4">
                서류 추천등급
              </h2>
              {recTotal > 0 ? (
                <HBars
                  rows={["강력추천", "추천", "보류", "비추천"]
                    .filter((g) => (data.recommendations[g] ?? 0) > 0)
                    .map((g) => ({
                      label: g,
                      value: data.recommendations[g] ?? 0,
                      max: recTotal,
                      display: `${data.recommendations[g] ?? 0}명`,
                      color: REC_COLOR[g],
                    }))}
                />
              ) : (
                <p className="text-sm text-ink-muted py-8 text-center">
                  데이터 없음
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "primary" | "success" | "danger" | "muted";
}) {
  const toneCls: Record<string, string> = {
    default: "bg-card border-border-default text-ink",
    primary: "bg-primary-soft border-primary/30 text-primary-deep",
    success: "bg-success-soft border-success/30 text-success",
    danger: "bg-danger-soft border-danger/30 text-danger",
    muted: "bg-surface-alt border-border-default text-ink-muted",
  };
  return (
    <div className={`border rounded-2xl p-4 shadow-sm ${toneCls[tone]}`}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
      {sub && <div className="text-[10px] mt-0.5 opacity-60">{sub}</div>}
    </div>
  );
}

function Seg({
  n,
  total,
  color,
}: {
  n: number;
  total: number;
  color: string;
}) {
  if (n <= 0 || total <= 0) return null;
  return (
    <div
      style={{ width: `${(n / total) * 100}%`, background: color }}
      title={`${n}`}
    />
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="w-2.5 h-2.5 rounded-sm"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

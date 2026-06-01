"use client";

import { useEffect, useState } from "react";
import { STAGE_META } from "@/lib/stage-meta";

type Funnel = {
  daysBack: number;
  total: number;
  recentCount: number;
  activeJobs: number;
  pipeline: Record<string, number>;
  outcomes: Record<string, number>;
  avgScreeningScore: number | null;
};

// 파이프라인 표시 순서 (진행 중 단계만 — 종결 결과는 별도 섹션).
const PIPELINE_ORDER = [
  "applied",
  "screened",
  "ai_pending",
  "ai_evaluated",
  "round1_candidate",
  "round1_scheduling",
  "round1_waiting",
  "round1_passed",
  "round2_passed",
] as const;

export default function OrgDashboardPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Funnel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    fetch(`/api/org/funnel?days=${days}`)
      .then(async (r) => {
        if (!r.ok) {
          setErr(r.status === 403 ? "이 페이지는 법인 관리자만 볼 수 있습니다." : await r.text());
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch(() => setErr("불러오기에 실패했습니다."));
  }, [days]);

  const inPipeline = data
    ? Object.values(data.pipeline).reduce((a, b) => a + b, 0)
    : 0;
  const maxStage = data
    ? Math.max(1, ...PIPELINE_ORDER.map((s) => data.pipeline[s] ?? 0))
    : 1;

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">채용 현황 대시보드</h1>
          <p className="text-sm text-ink-soft mt-1">
            우리 법인의 전체 채용 파이프라인 현황입니다.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
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
        <div className="text-sm text-ink-muted py-16 text-center">불러오는 중...</div>
      )}

      {data && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="전체 후보자" value={data.total} />
            <Stat label="진행 중" value={inPipeline} tone="primary" />
            <Stat label="최종 합격" value={data.outcomes.hired ?? 0} tone="success" />
            <Stat label="불합격" value={data.outcomes.rejected ?? 0} tone="muted" />
            <Stat label={`최근 ${data.daysBack}일 신규`} value={data.recentCount} />
          </div>

          {/* 파이프라인 */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mt-5">
            <h2 className="text-sm font-semibold text-ink mb-4">진행 단계 현황</h2>
            {inPipeline === 0 ? (
              <p className="text-sm text-ink-muted py-4 text-center">
                진행 중인 후보자가 없습니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {PIPELINE_ORDER.map((s) => {
                  const n = data.pipeline[s] ?? 0;
                  const meta = STAGE_META[s];
                  const label = meta.sub ? `${meta.main} · ${meta.sub}` : meta.main;
                  const pct = Math.round((n / maxStage) * 100);
                  return (
                    <li key={s} className="flex items-center gap-3 text-sm">
                      <span className="w-32 shrink-0 text-ink-soft text-xs truncate">
                        {label}
                      </span>
                      <div className="flex-1 bg-slate-100 rounded h-5 overflow-hidden">
                        <div
                          className="h-full bg-primary/70 rounded transition-all"
                          style={{ width: `${n === 0 ? 0 : Math.max(pct, 4)}%` }}
                        />
                      </div>
                      <span className="w-8 text-right tabular-nums font-medium text-ink">
                        {n}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {data.avgScreeningScore != null && (
              <p className="text-xs text-ink-muted mt-4">
                진행 중 후보 평균 서류 점수:{" "}
                <span className="font-semibold text-ink">{data.avgScreeningScore}</span>/100
              </p>
            )}
          </section>

          {/* 결정 현황 */}
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mt-5">
            <h2 className="text-sm font-semibold text-ink mb-4">결정 현황</h2>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="✓ 최종 합격" value={data.outcomes.hired ?? 0} tone="success" />
              <Stat label="✗ 불합격" value={data.outcomes.rejected ?? 0} tone="danger" />
              <Stat label="지원 취소" value={data.outcomes.withdrawn ?? 0} tone="muted" />
            </div>
            <p className="text-xs text-ink-muted mt-4">
              활성 공고 {data.activeJobs}개
            </p>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "primary" | "success" | "danger" | "muted";
}) {
  const toneCls: Record<string, string> = {
    default: "bg-white border-slate-200 text-ink",
    primary: "bg-primary-soft border-primary/30 text-primary-deep",
    success: "bg-emerald-50 border-emerald-200 text-emerald-700",
    danger: "bg-danger-soft border-danger/30 text-danger",
    muted: "bg-slate-50 border-slate-200 text-slate-500",
  };
  return (
    <div className={`border rounded-2xl p-4 shadow-sm ${toneCls[tone]}`}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
    </div>
  );
}

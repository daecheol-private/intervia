"use client";

import { useEffect, useState } from "react";

type Funnel = {
  stages: Record<string, number>;
  /** 결정되지 않은(outcome IS NULL) 후보만 stage 별 카운트. "오늘 결정할 일" 계산용. */
  pendingByStage: Record<string, number>;
  /** stage 만으로 셀 수 없는 HR 액션 — 스케줄 row 기반 (역제시 확정, 2차 진행 미결정). */
  hrActions?: { counterProposed: number; round1PassedUndecided: number };
  total: number;
  avgScreeningScore: number | null;
  countWithScreeningScore: number;
  decisionBreakdown: Array<{
    outcome: "hired" | "rejected" | "withdrawn" | null;
    fromStage: string | null;
    n: number;
  }>;
  kpi: {
    avgDecisionDays: number | null;
    decidedCount: number;
    aiResponseRate: number | null;
    r1ResponseRate: number | null;
    withdrawnRate: number;
  };
};

export function FunnelPanel({
  jobId,
  refreshKey,
  activeStage,
  onStageSelect,
}: {
  jobId: string;
  refreshKey: number;
  activeStage?: string;
  onStageSelect?: (stage: string) => void;
}) {
  const [data, setData] = useState<Funnel | null>(null);

  useEffect(() => {
    void fetch(`/api/jobs/${jobId}/funnel`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d));
  }, [jobId, refreshKey]);

  if (!data || data.total === 0) return null;

  // 전형 단계 — 1줄 표시. 그룹별 색 묶음:
  //   G1 스크리닝(지원·서류) / G2 AI면접(대기·평가) / G3 1차(후보·스케쥴·대기·합격) / G4 2차 / G5 최종
  // 그룹별 색상 토큰 — 후보자 카드 좌측 색띠와 동일.
  // active: 값이 있는 셀(테두리 진하고 배경 살짝), empty: 값 0인 셀(테두리만 옅게).
  type PipelineCell = {
    stage: string;
    label: string;
    group: 1 | 2 | 3 | 4 | 5;
    active: string;
    empty: string;
  };
  const pipelineCells: PipelineCell[] = [
    {
      stage: "applied",
      label: "지원",
      group: 1,
      active: "border-slate-400 bg-slate-50 text-slate-700",
      empty: "border-slate-200 text-slate-300",
    },
    {
      stage: "screened",
      label: "서류평가",
      group: 1,
      active: "border-slate-400 bg-slate-50 text-slate-700",
      empty: "border-slate-200 text-slate-300",
    },
    {
      stage: "ai_pending",
      label: "AI면접·대기",
      group: 2,
      active: "border-info bg-info-soft text-info",
      empty: "border-info/30 text-info/40",
    },
    {
      stage: "ai_evaluated",
      label: "AI면접·평가",
      group: 2,
      active: "border-info bg-info-soft text-info",
      empty: "border-info/30 text-info/40",
    },
    {
      stage: "round1_candidate",
      label: "1차·후보",
      group: 3,
      active: "border-accent bg-accent-soft text-accent-deep",
      empty: "border-accent/30 text-accent/40",
    },
    {
      stage: "round1_scheduling",
      label: "1차·스케쥴",
      group: 3,
      active: "border-accent bg-accent-soft text-accent-deep",
      empty: "border-accent/30 text-accent/40",
    },
    {
      stage: "round1_waiting",
      label: "1차·대기",
      group: 3,
      active: "border-accent bg-accent-soft text-accent-deep",
      empty: "border-accent/30 text-accent/40",
    },
    {
      stage: "round1_passed",
      label: "1차 합격",
      group: 3,
      active: "border-accent bg-accent-soft text-accent-deep",
      empty: "border-accent/30 text-accent/40",
    },
    {
      stage: "round2_passed",
      label: "2차 합격",
      group: 4,
      active: "border-primary bg-primary-soft text-primary-deep",
      empty: "border-primary/30 text-primary/40",
    },
    {
      stage: "hired",
      label: "최종 합격",
      group: 5,
      active: "border-primary bg-primary text-surface",
      empty: "border-primary/40 text-primary/50",
    },
  ];

  // 결정 단계 — 불합격/지원취소. 최종 합격은 파이프라인에 포함되어 제외.
  const stageLabelMap: Record<string, string> = {
    applied: "지원",
    screened: "서류평가",
    ai_pending: "AI면접·대기",
    ai_evaluated: "AI면접·평가",
    round1_candidate: "1차·후보",
    round1_scheduling: "1차·스케쥴",
    round1_waiting: "1차·대기",
    round1_passed: "1차 합격",
    round2_passed: "2차 합격",
  };
  const rejectedBreakdown = (data.decisionBreakdown ?? []).filter(
    (r) => r.outcome === "rejected"
  );
  const withdrawnBreakdown = (data.decisionBreakdown ?? []).filter(
    (r) => r.outcome === "withdrawn"
  );
  const rejectedTotal = rejectedBreakdown.reduce((s, r) => s + r.n, 0);
  const withdrawnTotal = withdrawnBreakdown.reduce((s, r) => s + r.n, 0);

  // -- "오늘 결정할 일" — HR 액션이 필요한 단계 집계 -------------------------
  // pendingByStage(outcome IS NULL 만) 사용 — 이미 종결된 후보는 카운트에서 제외.
  // 스케줄 기반 항목(역제시 확정, 2차 진행 결정)은 hrActions 사용 — stage 만으로 못 센다.
  const pending = data.pendingByStage ?? {};
  const actionItems: { stage: string; label: string; count: number; tone: string }[] = [
    {
      stage: "screened",
      label: "서류평가 후 면접 진행 결정",
      count: pending["screened"] ?? 0,
      tone: "bg-primary-soft text-primary-deep border-primary/30 hover:bg-primary-soft/70",
    },
    {
      stage: "ai_evaluated",
      label: "AI 면접 후 합·불 결정",
      count: pending["ai_evaluated"] ?? 0,
      tone: "bg-accent-soft text-accent-deep border-accent/40 hover:bg-accent-soft/70",
    },
    {
      stage: "round1_candidate",
      label: "1차 면접 일정 제시",
      count: pending["round1_candidate"] ?? 0,
      tone: "bg-primary-soft text-primary-deep border-primary/30 hover:bg-primary-soft/70",
    },
    {
      stage: "counter_proposed",
      label: "지원자 역제시 시간 확정",
      count: data.hrActions?.counterProposed ?? 0,
      tone: "bg-warning-soft text-warning border-warning/30 hover:bg-warning-soft/70",
    },
    {
      stage: "round1_passed",
      label: "2차 면접 진행 결정",
      count: data.hrActions?.round1PassedUndecided ?? pending["round1_passed"] ?? 0,
      tone: "bg-accent-soft text-accent-deep border-accent/40 hover:bg-accent-soft/70",
    },
    {
      stage: "round2_passed",
      label: "최종합격 결정",
      count: pending["round2_passed"] ?? 0,
      tone: "bg-warning-soft text-warning border-warning/30 hover:bg-warning-soft/70",
    },
  ].filter((x) => x.count > 0);
  const actionTotal = actionItems.reduce((s, x) => s + x.count, 0);

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      {/* 🔔 오늘 결정할 일 — 인사담당이 처리해야 할 단계 */}
      {actionTotal > 0 && (
        <div className="mb-4 rounded-xl border border-primary/25 bg-primary-soft/40 p-3">
          <div className="text-[11px] font-semibold text-primary-deep uppercase tracking-wider mb-2 flex items-center gap-1.5">
            🔔 오늘 결정할 일
            <span className="text-ink-soft font-medium normal-case tracking-normal">
              총 {actionTotal}건 — 클릭하면 해당 단계 후보자만 표시됩니다
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {actionItems.map((a) => (
              <a
                key={a.stage}
                href={`?stage=${a.stage}`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${a.tone}`}
              >
                <span>{a.label}</span>
                <span className="font-bold tabular-nums">{a.count}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-900">전형 단계 현황</h3>
        <div className="text-xs text-slate-500">
          총 <strong className="text-slate-900">{data.total}</strong>명
          {data.avgScreeningScore != null && (
            <>
              {" · "}AI 서류 평균{" "}
              <strong className="text-slate-900">
                {data.avgScreeningScore}
              </strong>
              점 ({data.countWithScreeningScore}명)
            </>
          )}
        </div>
      </div>

      {/* 파이프라인 — 데스크톱은 1줄 꽉 채움(flex-1), 모바일은 가로 스크롤(셀 최소폭 유지). */}
      <div className="flex items-stretch gap-0.5 pb-2 overflow-x-auto sm:overflow-visible -mx-1 px-1">
        {pipelineCells.map((cell, i) => {
          const n = data.stages[cell.stage] ?? 0;
          const next = pipelineCells[i + 1];
          const isGroupBoundary = next && next.group !== cell.group;
          return (
            <div
              key={cell.stage}
              className="flex items-center gap-0.5 shrink-0 sm:shrink sm:flex-1 min-w-[62px] sm:min-w-0"
            >
              <button
                type="button"
                onClick={() =>
                  onStageSelect?.(
                    activeStage === cell.stage ? "all" : cell.stage
                  )
                }
                title={
                  activeStage === cell.stage
                    ? `${cell.label} 필터 해제`
                    : `${cell.label} 단계만 보기`
                }
                className={`rounded-md text-center flex-1 min-w-0 cursor-pointer transition hover:shadow-sm hover:brightness-95 ${
                  n > 0 ? cell.active : cell.empty
                } ${
                  activeStage === cell.stage
                    ? "border-4 px-0.5 py-1"
                    : "border-2 px-1 py-1.5"
                }`}
              >
                <div className="text-[10px] tracking-wider opacity-80 truncate">
                  {cell.label}
                </div>
                <div className="text-base font-bold mt-0.5 tabular-nums">
                  {n}
                </div>
              </button>
              {i < pipelineCells.length - 1 && (
                <span
                  className={`text-[10px] shrink-0 ${
                    isGroupBoundary
                      ? "text-slate-400 px-0.5"
                      : "text-slate-300"
                  }`}
                >
                  {isGroupBoundary ? "▶" : "▸"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 결정 현황 — 불합격/지원취소만, 컴팩트하게 단계별 breakdown */}
      {(rejectedTotal > 0 || withdrawnTotal > 0) && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
          {rejectedTotal > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-danger font-medium">
                ✗ 불합격 {rejectedTotal}건
              </span>
              <span className="text-slate-400">
                {rejectedBreakdown.map((r, idx) => (
                  <span key={idx}>
                    {idx > 0 && ", "}
                    {r.fromStage
                      ? (stageLabelMap[r.fromStage] ?? r.fromStage)
                      : "단계 미상"}{" "}
                    {r.n}
                  </span>
                ))}
              </span>
            </div>
          )}
          {withdrawnTotal > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-600 font-medium">
                ↩ 지원취소 {withdrawnTotal}건
              </span>
              <span className="text-slate-400">
                {withdrawnBreakdown.map((r, idx) => (
                  <span key={idx}>
                    {idx > 0 && ", "}
                    {r.fromStage
                      ? (stageLabelMap[r.fromStage] ?? r.fromStage)
                      : "단계 미상"}{" "}
                    {r.n}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

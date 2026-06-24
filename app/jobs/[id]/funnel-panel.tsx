"use client";

import { useEffect, useState } from "react";
import {
  Brain,
  FileText,
  Trophy,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

type Funnel = {
  stages: Record<string, number>;
  /** 결정되지 않은(outcome IS NULL) 후보만 stage 별 카운트. "오늘 결정할 일" 계산용. */
  pendingByStage: Record<string, number>;
  /** stage 만으로 셀 수 없는 HR 액션 — 스케줄/세션/큐 row 기반 (lib/candidate-state.ts 와 동일 판정). */
  hrActions?: {
    counterProposed: number;
    round1PassedUndecided: number;
    resumeActionNeeded?: number;
    aiLinkExpired?: number;
    resultDue?: number;
  };
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

  // 전형 단계 — 버킷 5개 (서류 → AI 면접 → 1차 → 2차 → 최종 합격).
  // 색: 화이트(#FFFFFF) → 브랜드 primary(#1C3478) 를 RGB 선형보간한 5단계를 solid 채움.
  //   #FFFFFF → #C6CCDD → #8E9ABC → #55679A → #1C3478(=primary). 흰색에서 시작해
  //   깊어질수록 파랑·네이비로 — 밝고 산뜻하게 진행 순서를 색으로 읽는다.
  //   밝은 1~2칸은 진한 글씨, 3~5칸은 흰 글씨. 서류칸(흰 배경)은 옅은 테두리로 구분.
  //   후보자 카드 좌측 색띠(stageGroupBorder)는 같은 ramp(서류는 띠 가시성 위해 옅은 회색).
  // active: 값이 있는 셀(solid), empty: 값 0인 셀(dimCell 로 옅게).
  const s = (k: string) => Number(data.stages[k] ?? 0);
  type PipelineCell = {
    stage: string; // 클릭 시 목록 필터 키 (bucket_* pseudo 또는 hired)
    label: string;
    /** 상세보기 탭과 동일한 아이콘 — currentColor 상속으로 단계 색을 그대로 입는다 */
    Icon: LucideIcon;
    n: number;
    /** 서브상태 요약 — "라벨 n" 중 n>0 만 표시 */
    subs: Array<{ label: string; n: number }>;
    /** n>0 카드 스타일 (테두리·배경·텍스트) */
    fill: string;
    /** 필터 선택 시 강조 ring */
    ring: string;
    /** 최종 합격 — solid 강조 셀 */
    solid?: boolean;
  };
  const pipelineCells: PipelineCell[] = [
    {
      stage: "bucket_resume",
      label: "서류평가",
      Icon: FileText,
      n: s("applied") + s("screened"),
      subs: [
        { label: "평가전", n: s("applied") },
        { label: "평가완료", n: s("screened") },
      ],
      fill: "border-[#D7DBE3] bg-white text-[#1f2937]",
      ring: "ring-[#1C3478]/45",
    },
    {
      stage: "bucket_ai",
      label: "AI 면접",
      Icon: Brain,
      n: s("ai_pending") + s("ai_evaluated"),
      subs: [
        { label: "응시대기", n: s("ai_pending") },
        { label: "면접완료", n: s("ai_evaluated") },
      ],
      fill: "border-[#C6CCDD] bg-[#C6CCDD] text-[#1f2937]",
      ring: "ring-[#1C3478]/45",
    },
    {
      stage: "bucket_round1",
      label: "1차 면접",
      Icon: User,
      n: s("round1_candidate") + s("round1_scheduling") + s("round1_waiting"),
      subs: [
        { label: "후보", n: s("round1_candidate") },
        { label: "일정조율", n: s("round1_scheduling") },
        { label: "면접확정", n: s("round1_waiting") },
      ],
      fill: "border-[#8E9ABC] bg-[#8E9ABC] text-white",
      ring: "ring-[#1C3478]/45",
    },
    {
      stage: "bucket_round2",
      label: "2차 면접",
      Icon: Users,
      n: s("round1_passed") + s("round2_passed"),
      subs: [
        { label: "진행·일정", n: s("round1_passed") },
        { label: "최종결정", n: s("round2_passed") },
      ],
      fill: "border-[#55679A] bg-[#55679A] text-white",
      ring: "ring-[#1C3478]/45",
    },
    {
      stage: "hired",
      label: "최종 합격",
      Icon: Trophy,
      n: s("hired"),
      subs: [],
      fill: "border-primary bg-primary text-white shadow-[var(--shadow-sm)]",
      ring: "ring-primary/50",
      solid: true,
    },
  ];
  // 값 0인 셀은 색을 빼고 옅게 — 단계별 색조가 빈 칸까지 번지지 않도록 통일.
  const dimCell = "border-border-default bg-surface-alt/30 text-ink-muted/60";

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
      stage: "resume_action",
      label: "서류 평가 조치 (실패·미실행)",
      count: data.hrActions?.resumeActionNeeded ?? 0,
      tone: "bg-warning-soft text-warning border-warning/30 hover:bg-warning-soft/70",
    },
    {
      stage: "screened",
      label: "서류평가 후 면접 진행 결정",
      count: pending["screened"] ?? 0,
      tone: "bg-primary-soft text-primary-deep border-primary/30 hover:bg-primary-soft/70",
    },
    {
      stage: "ai_link_expired",
      label: "AI 면접 링크 만료 · 재발송/결정",
      count: data.hrActions?.aiLinkExpired ?? 0,
      tone: "bg-warning-soft text-warning border-warning/30 hover:bg-warning-soft/70",
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
      stage: "result_due",
      label: "면접 완료 · 결과 입력",
      count: data.hrActions?.resultDue ?? 0,
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
    <div className="mt-4 bg-card border border-border-default rounded-2xl p-5 shadow-sm">
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
        <h3 className="text-sm font-semibold text-ink">전형 단계 현황</h3>
        <div className="text-xs text-ink-muted">
          총 <strong className="text-ink">{data.total}</strong>명
          {data.avgScreeningScore != null && (
            <>
              {" · "}AI 서류 평균{" "}
              <strong className="text-ink">
                {data.avgScreeningScore}
              </strong>
              점 ({data.countWithScreeningScore}명)
            </>
          )}
        </div>
      </div>

      {/* 파이프라인 — 버킷 5박스. 데스크톱은 1줄 꽉 채움(flex-1), 모바일은 가로 스크롤. */}
      <div className="flex items-stretch gap-1 pb-1 overflow-x-auto sm:overflow-visible -mx-1 px-1">
        {pipelineCells.map((cell, i) => {
          const subsLine = cell.subs
            .filter((x) => x.n > 0)
            .map((x) => `${x.label} ${x.n}`)
            .join(" · ");
          const selected = activeStage === cell.stage;
          const filled = cell.n > 0;
          return (
            <div
              key={cell.stage}
              className="flex items-center gap-1 shrink-0 sm:shrink sm:flex-1 min-w-[104px] sm:min-w-0"
            >
              <button
                type="button"
                onClick={() =>
                  onStageSelect?.(selected ? "all" : cell.stage)
                }
                title={
                  selected
                    ? `${cell.label} 필터 해제`
                    : `${cell.label} 단계만 보기`
                }
                className={`group relative flex flex-1 min-w-0 flex-col rounded-xl border px-3 py-2.5 text-left cursor-pointer transition-all duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-md)] ${
                  filled ? cell.fill : dimCell
                } ${
                  selected
                    ? `ring-2 ring-offset-1 ring-offset-card shadow-[var(--shadow-sm)] ${cell.ring}`
                    : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <cell.Icon
                    className={`h-3.5 w-3.5 shrink-0 ${filled ? "opacity-90" : "opacity-50"}`}
                  />
                  <span className="text-[11px] font-medium opacity-90 truncate">
                    {cell.label}
                  </span>
                </div>
                <div className="mt-1.5 text-2xl font-bold leading-none tabular-nums">
                  {cell.n}
                </div>
                <div className="mt-1 text-[10px] opacity-70 truncate h-3.5 leading-[14px]">
                  {cell.solid && filled ? "합격" : subsLine}
                </div>
              </button>
              {i < pipelineCells.length - 1 && (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-4 w-4 shrink-0 text-border-strong"
                  aria-hidden
                >
                  <path
                    d="M9 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          );
        })}
      </div>

      {/* 결정 현황 — 불합격/지원취소만, 컴팩트하게 단계별 breakdown */}
      {(rejectedTotal > 0 || withdrawnTotal > 0) && (
        <div className="mt-3 pt-3 border-t border-border-default flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
          {rejectedTotal > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-danger font-medium">
                ✗ 불합격 {rejectedTotal}건
              </span>
              <span className="text-ink-muted">
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
              <span className="text-ink-soft font-medium">
                ↩ 지원취소 {withdrawnTotal}건
              </span>
              <span className="text-ink-muted">
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

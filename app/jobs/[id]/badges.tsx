"use client";

import {
  STAGE_META as STAGE_META_SHARED,
  STAGE_RANK as STAGE_RANK_SHARED,
  STAGE_WAITER,
} from "@/lib/stage-meta";
import type { Candidate } from "./types";

// 요약 텍스트의 **굵게** 마크다운만 렌더 (그 외는 평문 유지)
export function HL({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\*\*([^*]+)\*\*$/.exec(p);
        if (m)
          return (
            <strong key={i} className="font-semibold text-slate-900">
              {m[1]}
            </strong>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
      {children}
    </span>
  );
}

/**
 * 후보자 카드의 stage 그룹 색 — 깔때기(FunnelPanel) 그룹과 동일.
 * G1 서류(slate) / G2 AI면접(info) / G3 1차(accent) / G4 2차(primary)
 * G5 최종합격(primary deep) / 종결(danger·rose)
 *
 * 좌측 4px border 로 표시 → 어떤 단계 그룹인지 한눈에. 즐겨찾기 amber 외곽과 직교.
 */
/**
 * 종결된 후보(불합격·지원취소) 는 흐리게 표시 — 즐겨찾기·1차후보 섹션에서도 동일.
 * 합격은 그대로(강조 유지).
 */
export function dimIfClosed(outcome: Candidate["outcome"]): string {
  if (outcome === "rejected" || outcome === "withdrawn")
    return "opacity-55 grayscale-[20%]";
  return "";
}

export function stageGroupBorder(
  stage: Candidate["stage"],
  outcome: Candidate["outcome"]
): string {
  if (outcome === "rejected" || outcome === "withdrawn")
    return "border-l-4 border-l-danger/60";
  if (stage === "hired" || outcome === "hired")
    return "border-l-4 border-l-primary";
  if (stage === "round2_passed") return "border-l-4 border-l-primary";
  if (
    stage === "round1_candidate" ||
    stage === "round1_scheduling" ||
    stage === "round1_waiting" ||
    stage === "round1_passed"
  )
    return "border-l-4 border-l-accent";
  if (stage === "ai_pending" || stage === "ai_evaluated")
    return "border-l-4 border-l-info";
  // applied · screened
  return "border-l-4 border-l-slate-400";
}

const STAGE_META = STAGE_META_SHARED as Record<
  Candidate["stage"],
  { rank: number; main: string; sub: string | null; color: string }
>;
export const STAGE_RANK = STAGE_RANK_SHARED as Record<Candidate["stage"], number>;

export function StageBadge({ stage }: { stage: Candidate["stage"] }) {
  const m = STAGE_META[stage];
  return (
    <span
      className={`inline-flex items-baseline gap-1 text-[11px] px-2 py-0.5 rounded-md font-medium border ${m.color}`}
    >
      <span>{m.main}</span>
      {m.sub && <span className="opacity-70 text-[10px]">· {m.sub}</span>}
    </span>
  );
}

const OUTCOME_META: Record<
  NonNullable<Candidate["outcome"]>,
  { label: string; color: string }
> = {
  hired:     { label: "최종합격", color: "bg-primary text-surface border-primary" },
  rejected:  { label: "불합격",   color: "bg-danger-soft text-danger border-danger/30" },
  withdrawn: { label: "지원취소", color: "bg-surface-alt text-ink-soft border-border-default" },
};

export function OutcomeBadge({ outcome }: { outcome: NonNullable<Candidate["outcome"]> }) {
  const m = OUTCOME_META[outcome];
  return (
    <span
      className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-md font-semibold border ${m.color}`}
    >
      {m.label}
    </span>
  );
}

// 대기 주체별 컬러: 시스템(중립) / 인사(주의=warning) / 지원자(정보=info) / 면접관(애프리콧=accent)
const WAITER_META: Record<
  "system" | "hr" | "candidate" | "interviewer" | "none",
  { icon: string; color: string }
> = {
  system:      { icon: "⚙️", color: "bg-surface-alt text-ink-soft border-border-default" },
  hr:          { icon: "👤", color: "bg-warning-soft text-warning border-warning/30" },
  candidate:   { icon: "📧", color: "bg-info-soft text-info border-info/30" },
  interviewer: { icon: "🎤", color: "bg-accent-soft text-accent-deep border-accent/40" },
  none:        { icon: "—",  color: "bg-surface-alt text-ink-muted border-border-default" },
};

/** 역제시 상태 — 공이 지원자가 아니라 HR(시간 확정·재제시)에게 있다. */
export function hasCounterProposal(
  c: Pick<Candidate, "stage" | "round1ScheduleStatus" | "round2ScheduleStatus">
): boolean {
  return (
    (c.stage === "round1_scheduling" &&
      c.round1ScheduleStatus === "counter_proposed") ||
    (c.stage === "round1_passed" && c.round2ScheduleStatus === "counter_proposed")
  );
}

/**
 * 실제 대기 주체 — stage 만으로는 부족한 두 경우를 스케줄 상태로 보정:
 *  - 역제시(counter_proposed): 지원자 응답 대기가 아니라 HR 확정 대기
 *  - 2차 면접: stage 변화 없이(round1_passed 유지) round2 스케줄 row 로만 진행
 */
export function effectiveWaiter(
  c: Pick<Candidate, "stage" | "round1ScheduleStatus" | "round2ScheduleStatus">
): { who: keyof typeof WAITER_META; label: string } {
  if (hasCounterProposal(c))
    return { who: "hr", label: "역제시 시간 확정 대기" };
  if (c.stage === "round1_passed" && c.round2ScheduleStatus) {
    return c.round2ScheduleStatus === "selected"
      ? { who: "interviewer", label: "2차 면접 진행 대기" }
      : { who: "candidate", label: "지원자 일정 응답 대기" };
  }
  return STAGE_WAITER[c.stage];
}

export function WaitBadge({
  c,
}: {
  c: Pick<Candidate, "stage" | "round1ScheduleStatus" | "round2ScheduleStatus">;
}) {
  const w = effectiveWaiter(c);
  if (w.who === "none") return null;
  const m = WAITER_META[w.who];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border ${m.color}`}
      title={w.label}
    >
      <span>{m.icon}</span>
      <span>{w.label}</span>
    </span>
  );
}

export function RecBadge({ rec }: { rec: string }) {
  // 강력추천 / 비추천 만 노출. 중간 단계(추천·보류)는 점수로 판단.
  const colorMap: Record<string, string> = {
    강력추천: "bg-primary text-surface",
    비추천: "bg-danger-soft text-danger",
  };
  if (!(rec in colorMap)) return null;
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${colorMap[rec]}`}
    >
      {rec}
    </span>
  );
}

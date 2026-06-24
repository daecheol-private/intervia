"use client";

import {
  STAGE_META as STAGE_META_SHARED,
  STAGE_RANK as STAGE_RANK_SHARED,
} from "@/lib/stage-meta";
import {
  deriveCandidateState,
  hasCounterProposal as hasCounterProposalDerived,
  type CandidateStateInput,
} from "@/lib/candidate-state";
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
            <strong key={i} className="font-semibold text-ink">
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
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-surface-alt text-ink-soft">
      {children}
    </span>
  );
}

/**
 * 후보자 카드의 stage 그룹 색 — 깔때기(FunnelPanel) 그룹과 동일.
 * 진행 그라데이션: 화이트(#FFFFFF) → 브랜드 primary(#1C3478) RGB 선형보간 5단계.
 *   G1 서류(흰 띠는 안 보이니 옅은 회색 #DCE0E8) → G2 AI면접 #C6CCDD → G3 1차 #8E9ABC →
 *   G4 2차 #55679A → G5 최종합격 primary(#1C3478) / 종결(danger).
 *   흰색에서 단계가 깊어질수록 브랜드 네이비로. FunnelPanel 셀과 동일 ramp(거기선 solid 채움).
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
  if (stage === "round2_passed") return "border-l-4 border-l-[#55679A]";
  if (
    stage === "round1_candidate" ||
    stage === "round1_scheduling" ||
    stage === "round1_waiting" ||
    stage === "round1_passed"
  )
    return "border-l-4 border-l-[#8E9ABC]";
  if (stage === "ai_pending" || stage === "ai_evaluated")
    return "border-l-4 border-l-[#C6CCDD]";
  // applied · screened
  return "border-l-4 border-l-[#DCE0E8]";
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
export function hasCounterProposal(c: CandidateStateInput): boolean {
  return hasCounterProposalDerived(c);
}

/** 실제 대기 주체 + 서브상태 라벨 — lib/candidate-state.ts 단일 진실원천에 위임. */
export function effectiveWaiter(
  c: CandidateStateInput
): { who: keyof typeof WAITER_META; label: string } {
  const s = deriveCandidateState(c);
  return { who: s.waiter, label: s.label };
}

export function WaitBadge({ c }: { c: CandidateStateInput }) {
  const s = deriveCandidateState(c);
  if (s.waiter === "none") return null;
  const m = WAITER_META[s.waiter];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border ${m.color}`}
      title={s.label}
    >
      <span>{m.icon}</span>
      <span>{s.label}</span>
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

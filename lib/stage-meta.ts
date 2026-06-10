/**
 * Stage UI 메타 — 클라이언트 컴포넌트에서 import 가능한 순수 데이터.
 * candidate-stage.ts 는 db/storage 의존이 있어 client 에서 import 불가.
 * 이 파일은 server/client 모두 안전.
 */

export type Stage =
  | "applied"
  | "screened"
  | "ai_pending"
  | "ai_evaluated"
  | "round1_candidate"
  | "round1_scheduling"
  | "round1_waiting"
  | "round1_passed"
  | "round2_passed"
  | "hired"
  | "rejected"
  | "withdrawn";

export const STAGE_META: Record<
  Stage,
  { rank: number; main: string; sub: string | null; color: string }
> = {
  applied:           { rank: 10, main: "지원",        sub: null,         color: "bg-slate-100 text-slate-700 border-slate-200" },
  screened:          { rank: 20, main: "서류평가",    sub: null,         color: "bg-blue-100 text-blue-700 border-blue-200" },
  ai_pending:        { rank: 30, main: "AI면접",      sub: "대기",       color: "bg-sky-50 text-sky-700 border-sky-200" },
  ai_evaluated:      { rank: 40, main: "AI면접",      sub: "평가",       color: "bg-sky-100 text-sky-700 border-sky-200" },
  round1_candidate:  { rank: 50, main: "1차 면접",    sub: "후보",       color: "bg-violet-50 text-violet-700 border-violet-200" },
  round1_scheduling: { rank: 55, main: "1차 면접",    sub: "스케쥴 지정", color: "bg-violet-50 text-violet-700 border-violet-200" },
  round1_waiting:    { rank: 60, main: "1차 면접",    sub: "대기",       color: "bg-violet-100 text-violet-700 border-violet-200" },
  round1_passed:     { rank: 70, main: "1차 합격",    sub: null,         color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  round2_passed:     { rank: 80, main: "2차 합격",    sub: null,         color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  hired:             { rank: 100, main: "최종 합격",  sub: null,         color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  rejected:          { rank: 5,   main: "불합격",     sub: null,         color: "bg-red-100 text-red-700 border-red-200" },
  withdrawn:         { rank: 5,   main: "지원취소",   sub: null,         color: "bg-slate-100 text-slate-500 border-slate-200" },
};

export const STAGE_RANK: Record<Stage, number> = Object.fromEntries(
  Object.entries(STAGE_META).map(([k, v]) => [k, v.rank])
) as Record<Stage, number>;

export const STAGE_LABELS: Record<Stage, string> = {
  applied: "지원",
  screened: "서류평가",
  ai_pending: "AI면접 · 대기",
  ai_evaluated: "AI면접 · 평가",
  round1_candidate: "1차 면접 · 후보",
  round1_scheduling: "1차 면접 · 스케쥴 지정",
  round1_waiting: "1차 면접 · 대기",
  round1_passed: "1차 합격",
  round2_passed: "2차 합격",
  hired: "최종 합격",
  rejected: "불합격",
  withdrawn: "지원취소",
};

/**
 * 사용자 노출용 4버킷 그룹 — 12개 세부 stage 를 묶어 첫 사용자의 인지 부담을 낮춘다.
 * 내부 stage enum 은 그대로 유지하고, 필터/표시 UI 에서만 그룹으로 묶어 보여준다.
 */
export type StageGroup = "document" | "ai_interview" | "onsite" | "decision";

export const STAGE_GROUP_LABELS: Record<StageGroup, string> = {
  document: "서류 전형",
  ai_interview: "AI 면접",
  onsite: "대면 면접",
  decision: "결정",
};

export const STAGE_GROUP_OF: Record<Stage, StageGroup> = {
  applied: "document",
  screened: "document",
  ai_pending: "ai_interview",
  ai_evaluated: "ai_interview",
  round1_candidate: "onsite",
  round1_scheduling: "onsite",
  round1_waiting: "onsite",
  round1_passed: "onsite",
  round2_passed: "onsite",
  hired: "decision",
  rejected: "decision",
  withdrawn: "decision",
};

/**
 * 그룹 순서 + 각 그룹의 파이프라인 stage 목록 (select optgroup 등 UI 용).
 * 종결 결과(rejected/withdrawn)는 별도 '결과' 필터에서 다루므로 여기 decision 은
 * 파이프라인상의 '최종 합격(hired)' 만 포함한다.
 */
export const STAGE_GROUPS: { group: StageGroup; stages: Stage[] }[] = [
  { group: "document", stages: ["applied", "screened"] },
  { group: "ai_interview", stages: ["ai_pending", "ai_evaluated"] },
  {
    group: "onsite",
    stages: [
      "round1_candidate",
      "round1_scheduling",
      "round1_waiting",
      "round1_passed",
      "round2_passed",
    ],
  },
  { group: "decision", stages: ["hired"] },
];

export type StageWaiter = "system" | "hr" | "candidate" | "interviewer" | "none";

export const STAGE_WAITER: Record<Stage, { who: StageWaiter; label: string }> = {
  applied:           { who: "system",      label: "AI 평가 진행 중" },
  screened:          { who: "hr",          label: "면접 진행 결정 대기" },
  ai_pending:        { who: "candidate",   label: "지원자 응답 대기" },
  ai_evaluated:      { who: "hr",          label: "면접 결과 검토 대기" },
  round1_candidate:  { who: "hr",          label: "일정 발송 대기" },
  round1_scheduling: { who: "candidate",   label: "지원자 일정 응답 대기" },
  round1_waiting:    { who: "interviewer", label: "면접 진행 대기" },
  round1_passed:     { who: "hr",          label: "2차 진행 결정 대기" },
  round2_passed:     { who: "hr",          label: "최종 결정 대기" },
  hired:             { who: "none",        label: "종결" },
  rejected:          { who: "none",        label: "종결" },
  withdrawn:         { who: "none",        label: "종결" },
};

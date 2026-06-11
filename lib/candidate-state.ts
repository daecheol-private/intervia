/**
 * 후보자 파생 상태 단일 진실원천 — (버킷, 서브상태, 대기주체) 계산.
 *
 * 저장 모델은 stage(파이프라인 위치) + outcome(종결 결과)뿐이고,
 * "지금 누가 무엇을 해야 하는가"는 큐/세션/스케줄 테이블에서 파생된다.
 * 이 모듈이 그 파생 규칙의 유일한 구현 — 목록/뱃지/대시보드가 전부 여기를 쓴다.
 * (컬럼으로 저장하면 전환 지점마다 갱신 누락 → 드리프트 버그. 파생으로 유지)
 *
 * client-safe: db/storage 의존 없음.
 *
 * 버킷 5개:
 *   resume(서류) → ai(AI 면접) → round1(1차 면접) → round2(2차 면접) / closed(종결)
 *
 * 서브상태 전수 (대기주체):
 *   resume : 분석중·평가대기·재시도대기·평가중(system) / 충전대기·평가실패·평가미실행(hr) / 평가완료(hr)
 *   ai     : 응시대기·응시중(candidate) / 링크만료·발송확인(hr) / 면접완료(hr)
 *   round1 : 일정제시필요(hr) / 응답대기(candidate) / 역제안(hr) / 면접확정(interviewer) / 결과입력필요(hr)
 *   round2 : 진행결정(hr) / 응답대기(candidate) / 역제안(hr) / 면접확정(interviewer) / 결과입력필요(hr) / 최종결정(hr)
 *   closed : 최종합격 / 불합격 / 지원취소 (none)
 */
import type { Stage } from "./stage-meta";

export type Bucket = "resume" | "ai" | "round1" | "round2" | "closed";

export type Waiter = "system" | "hr" | "candidate" | "interviewer" | "none";

export type StateKey =
  // resume
  | "resume_analyzing"
  | "resume_queued"
  | "resume_retry"
  | "resume_evaluating"
  | "resume_paused"
  | "resume_failed"
  | "resume_not_started"
  | "resume_evaluated"
  // ai
  | "ai_requested"
  | "ai_in_progress"
  | "ai_link_expired"
  | "ai_unsent"
  | "ai_done"
  // round1
  | "r1_propose"
  | "r1_waiting_reply"
  | "r1_counter"
  | "r1_scheduled"
  | "r1_result_due"
  // round2
  | "r2_decide"
  | "r2_waiting_reply"
  | "r2_counter"
  | "r2_scheduled"
  | "r2_result_due"
  | "r2_final"
  // closed
  | "closed_hired"
  | "closed_rejected"
  | "closed_withdrawn";

/** 목록 그룹 헤더 키 — 여러 서브상태를 같은 액션 단위로 묶는다. */
export type GroupKey =
  | "system"
  | "hr_resume_action"
  | "hr_screened"
  | "hr_ai_expired"
  | "hr_ai_eval"
  | "hr_counter"
  | "hr_result_due"
  | "hr_r1_propose"
  | "hr_round1"
  | "hr_round2"
  | "r1_interview"
  | "r2_interview"
  | "external"
  | "closed_hired"
  | "closed_neg";

export type CandidateState = {
  bucket: Bucket;
  key: StateKey;
  /** 서브상태 라벨 — 행동 지향 문구 (검색·뱃지·그룹에 공용) */
  label: string;
  waiter: Waiter;
  group: GroupKey;
};

export type ScheduleStatus = "pending" | "counter_proposed" | "selected" | null;

/** 파생에 필요한 최소 입력 — 목록 API 응답(Candidate)의 부분집합. */
export type CandidateStateInput = {
  stage: Stage;
  outcome: "hired" | "rejected" | "withdrawn" | null;
  screeningReport?: unknown;
  parsed?: boolean;
  queueStatus?: "queued" | "processing" | null;
  queueAttempts?: number;
  lastJobStatus?: "queued" | "processing" | "done" | "failed" | "paused" | null;
  latestInterviewStatus?:
    | "pending"
    | "in_progress"
    | "completed"
    | "expired"
    | null;
  round1ScheduleStatus?: ScheduleStatus;
  round2ScheduleStatus?: ScheduleStatus;
  /** 확정 슬롯 종료 시각(ISO) — 경과 시 "면접 완료·결과 입력 필요" 판정용 */
  round1SelectedEnd?: string | null;
  round2SelectedEnd?: string | null;
};

export const BUCKET_LABELS: Record<Bucket, string> = {
  resume: "서류",
  ai: "AI 면접",
  round1: "1차 면접",
  round2: "2차 면접",
  closed: "종결",
};

/** stage → 버킷 (outcome 무관한 파이프라인 위치 기준). */
export const STAGE_BUCKET: Record<Stage, Bucket> = {
  applied: "resume",
  screened: "resume",
  ai_pending: "ai",
  ai_evaluated: "ai",
  round1_candidate: "round1",
  round1_scheduling: "round1",
  round1_waiting: "round1",
  round1_passed: "round2",
  round2_passed: "round2",
  hired: "closed",
  rejected: "closed",
  withdrawn: "closed",
};

const STATE_META: Record<
  StateKey,
  { label: string; waiter: Waiter; group: GroupKey }
> = {
  resume_analyzing:   { label: "분석 중", waiter: "system", group: "system" },
  resume_queued:      { label: "평가 대기", waiter: "system", group: "system" },
  resume_retry:       { label: "재시도 대기", waiter: "system", group: "system" },
  resume_evaluating:  { label: "AI 평가 중", waiter: "system", group: "system" },
  resume_paused:      { label: "충전 대기 — 토큰 충전 필요", waiter: "hr", group: "hr_resume_action" },
  resume_failed:      { label: "평가 실패 — 재평가 필요", waiter: "hr", group: "hr_resume_action" },
  resume_not_started: { label: "평가 미실행 — AI 검토 요청 필요", waiter: "hr", group: "hr_resume_action" },
  resume_evaluated:   { label: "평가 완료 — AI 면접 발송 결정", waiter: "hr", group: "hr_screened" },

  ai_requested:    { label: "AI 면접 응시 대기", waiter: "candidate", group: "external" },
  ai_in_progress:  { label: "AI 면접 응시 중", waiter: "candidate", group: "external" },
  ai_link_expired: { label: "링크 만료 — 재발송 또는 결정 필요", waiter: "hr", group: "hr_ai_expired" },
  ai_unsent:       { label: "링크 발송 확인 필요", waiter: "hr", group: "hr_ai_expired" },
  ai_done:         { label: "AI 면접 완료 — 결과 검토", waiter: "hr", group: "hr_ai_eval" },

  r1_propose:       { label: "1차 일정 제시 필요", waiter: "hr", group: "hr_r1_propose" },
  r1_waiting_reply: { label: "지원자 일정 응답 대기", waiter: "candidate", group: "external" },
  r1_counter:       { label: "역제안 — 시간 확정 필요", waiter: "hr", group: "hr_counter" },
  r1_scheduled:     { label: "1차 면접 확정 — 진행 대기", waiter: "interviewer", group: "r1_interview" },
  r1_result_due:    { label: "1차 면접 완료 — 결과 입력 필요", waiter: "hr", group: "hr_result_due" },

  r2_decide:        { label: "1차 합격 — 2차 진행 결정", waiter: "hr", group: "hr_round1" },
  r2_waiting_reply: { label: "지원자 일정 응답 대기", waiter: "candidate", group: "external" },
  r2_counter:       { label: "역제안 — 시간 확정 필요", waiter: "hr", group: "hr_counter" },
  r2_scheduled:     { label: "2차 면접 확정 — 진행 대기", waiter: "interviewer", group: "r2_interview" },
  r2_result_due:    { label: "2차 면접 완료 — 결과 입력 필요", waiter: "hr", group: "hr_result_due" },
  r2_final:         { label: "2차 합격 — 최종 결정", waiter: "hr", group: "hr_round2" },

  closed_hired:     { label: "최종합격", waiter: "none", group: "closed_hired" },
  closed_rejected:  { label: "불합격", waiter: "none", group: "closed_neg" },
  closed_withdrawn: { label: "지원취소", waiter: "none", group: "closed_neg" },
};

function make(bucket: Bucket, key: StateKey): CandidateState {
  return { bucket, key, ...STATE_META[key] };
}

export function deriveCandidateState(
  c: CandidateStateInput,
  nowMs: number = Date.now()
): CandidateState {
  // 1) 종결 — outcome 우선. (stage 가 legacy 종결값인 행도 흡수)
  const outcome =
    c.outcome ??
    (c.stage === "hired" || c.stage === "rejected" || c.stage === "withdrawn"
      ? c.stage
      : null);
  if (outcome === "hired") return make("closed", "closed_hired");
  if (outcome === "rejected") return make("closed", "closed_rejected");
  if (outcome === "withdrawn") return make("closed", "closed_withdrawn");

  // 2) 재평가 포함 — 활성 큐가 있으면 버킷과 무관하게 서류 처리 중으로 본다
  //    (단, 서류 버킷일 때만. 후속 단계 재평가는 점수 뱃지가 따로 표시)
  const bucket = STAGE_BUCKET[c.stage];

  if (bucket === "resume") {
    const queueActive = c.queueStatus === "queued" || c.queueStatus === "processing";
    if (queueActive && !c.parsed) return make("resume", "resume_analyzing");
    if (c.queueStatus === "processing") return make("resume", "resume_evaluating");
    if (c.queueStatus === "queued")
      return make(
        "resume",
        (c.queueAttempts ?? 0) >= 1 ? "resume_retry" : "resume_queued"
      );
    if (c.lastJobStatus === "paused") return make("resume", "resume_paused");
    if (c.lastJobStatus === "failed") return make("resume", "resume_failed");
    if (c.screeningReport != null) return make("resume", "resume_evaluated");
    return make("resume", "resume_not_started");
  }

  if (bucket === "ai") {
    if (c.stage === "ai_evaluated") return make("ai", "ai_done");
    switch (c.latestInterviewStatus) {
      case "pending":
        return make("ai", "ai_requested");
      case "in_progress":
        return make("ai", "ai_in_progress");
      case "expired":
        // 응시 중 만료는 자동 불합격 대상이 아님 — HR 이 재발송/결정해야 하는 상태
        return make("ai", "ai_link_expired");
      case "completed":
        // complete 라우트가 stage 전환에 실패한 방어 케이스
        return make("ai", "ai_done");
      default:
        // 세션 없음 — 발송 실패 등으로 메일이 안 나갔을 가능성
        return make("ai", "ai_unsent");
    }
  }

  if (bucket === "round1") {
    if (c.stage === "round1_candidate") return make("round1", "r1_propose");
    if (c.stage === "round1_scheduling") {
      if (c.round1ScheduleStatus === "counter_proposed")
        return make("round1", "r1_counter");
      if (c.round1ScheduleStatus === "pending")
        return make("round1", "r1_waiting_reply");
      // active 스케줄 없음 — 만료/취소 후 재제시 필요
      return make("round1", "r1_propose");
    }
    // round1_waiting — 확정 시각 경과 여부로 진행 대기 vs 결과 입력 구분
    if (
      c.round1ScheduleStatus === "selected" &&
      c.round1SelectedEnd &&
      new Date(c.round1SelectedEnd).getTime() <= nowMs
    )
      return make("round1", "r1_result_due");
    return make("round1", "r1_scheduled");
  }

  // round2 — stage 변화 없이(round1_passed 유지) round2 스케줄 row 로만 진행
  if (c.stage === "round2_passed") return make("round2", "r2_final");
  switch (c.round2ScheduleStatus) {
    case "counter_proposed":
      return make("round2", "r2_counter");
    case "pending":
      return make("round2", "r2_waiting_reply");
    case "selected":
      if (
        c.round2SelectedEnd &&
        new Date(c.round2SelectedEnd).getTime() <= nowMs
      )
        return make("round2", "r2_result_due");
      return make("round2", "r2_scheduled");
    default:
      return make("round2", "r2_decide");
  }
}

/** 역제안 상태 — 공이 지원자가 아니라 HR(시간 확정·재제시)에게 있다. */
export function hasCounterProposal(c: CandidateStateInput): boolean {
  const k = deriveCandidateState(c).key;
  return k === "r1_counter" || k === "r2_counter";
}

// ---------------------------------------------------------------------------
// 목록 그룹 표시 메타 — 파이프라인 순서 + 액션 단위 묶음
// ---------------------------------------------------------------------------

export const GROUP_ORDER: GroupKey[] = [
  "system",
  "hr_resume_action",
  "hr_screened",
  "hr_ai_expired",
  "hr_ai_eval",
  "hr_counter",
  "hr_result_due",
  "hr_r1_propose",
  "hr_round1",
  "hr_round2",
  "r1_interview",
  "r2_interview",
  "external",
  "closed_hired",
  "closed_neg",
];

export const GROUP_META: Record<GroupKey, { label: string; tone: string }> = {
  system:           { label: "⚙️ AI 평가 진행 중", tone: "text-slate-500" },
  hr_resume_action: { label: "⚠️ 서류 평가 조치 필요", tone: "text-warning" },
  hr_screened:      { label: "🔔 서류 평가 완료 · AI 면접 발송 결정", tone: "text-primary-deep" },
  hr_ai_expired:    { label: "⚠️ AI 면접 링크 만료 · 재발송/결정", tone: "text-warning" },
  hr_ai_eval:       { label: "🔔 AI 면접 완료 · 결과 검토", tone: "text-primary-deep" },
  hr_counter:       { label: "↩️ 지원자 시간 역제안 · 확정 필요", tone: "text-primary-deep" },
  hr_result_due:    { label: "📝 면접 완료 · 결과 입력", tone: "text-primary-deep" },
  hr_r1_propose:    { label: "⭐ 1차 면접 후보 · 일정 제시", tone: "text-accent-deep" },
  hr_round1:        { label: "🔔 1차 합격 · 2차 진행 결정", tone: "text-primary-deep" },
  hr_round2:        { label: "🔔 2차 합격 · 최종 결정", tone: "text-primary-deep" },
  r1_interview:     { label: "🎤 1차 면접 진행 대기", tone: "text-accent-deep" },
  r2_interview:     { label: "🎤 2차 면접 진행 대기", tone: "text-accent-deep" },
  external:         { label: "⏳ 지원자 응답 대기", tone: "text-slate-600" },
  closed_hired:     { label: "✓ 종결 · 합격", tone: "text-emerald-700" },
  closed_neg:       { label: "✗ 종결", tone: "text-slate-400" },
};

export function isHrGroup(g: GroupKey): boolean {
  return g.startsWith("hr_");
}

// ---------------------------------------------------------------------------
// 대기주체 필터 — "내 할일" 1차 필터용
// ---------------------------------------------------------------------------

export type WaiterFilter = "all" | "hr" | "candidate" | "interviewer" | "system" | "closed";

export const WAITER_FILTER_META: Record<
  Exclude<WaiterFilter, "all">,
  { label: string; icon: string }
> = {
  hr:          { label: "내 할일", icon: "🔔" },
  candidate:   { label: "지원자 대기", icon: "⏳" },
  interviewer: { label: "면접 예정", icon: "🎤" },
  system:      { label: "처리 중", icon: "⚙️" },
  closed:      { label: "종결", icon: "✓" },
};

export function matchesWaiterFilter(
  state: CandidateState,
  filter: WaiterFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "closed") return state.bucket === "closed";
  return state.waiter === filter;
}

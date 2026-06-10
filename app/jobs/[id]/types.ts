export type Job = {
  id: number;
  title: string;
  position: string;
  level: string;
  employmentType: string;
  tone: string;
  interviewDurationMinutes: number;
  createdAt: string;
  status?: "active" | "closed";
  publishedAt?: string;
  closesAt?: string;
  closedAt?: string | null;
  extensionCount?: number;
  evaluationFocus?: string;
  companyName?: string | null;
};

export type Candidate = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  age: number | null;
  careerYears: number | null;
  careerSummary: string | null;
  educationLevel: string | null;
  educationSchool: string | null;
  educationMajor: string | null;
  resumeFilePath: string;
  screeningScore: number | null;
  screeningReport: {
    score: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    concerns: string[];
    matched_keywords: string[];
  } | null;
  stage:
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
  outcome: "hired" | "rejected" | "withdrawn" | null;
  outcomeReason: string | null;
  decisionEmailCount: number;
  createdAt: string;
  latestInterviewStatus: "pending" | "in_progress" | "completed" | "expired" | null;
  latestInterviewScore: number | null;
  latestInterviewRecommendation: string | null;
  queueStatus: "queued" | "processing" | null;
  queuePosition: number | null;
  queueAttempts: number;
  lastError: string | null;
  lastJobStatus: "queued" | "processing" | "done" | "failed" | "paused" | null;
  // 파싱(텍스트 추출+마스킹) 완료 여부 — false = '분석 중', true = 평가 단계.
  parsed: boolean;
  favorited: boolean;
  // 최신 활성 1차 면접 스케줄 상태 — round1_scheduling 에서 응답 대기 vs 역제시 구분.
  round1ScheduleStatus: "pending" | "counter_proposed" | "selected" | null;
  // 최신 활성 2차 면접 스케줄 상태 — 2차는 stage 변화 없이 스케줄 row 로만 진행.
  round2ScheduleStatus: "pending" | "counter_proposed" | "selected" | null;
};

/** 1차 면접 확정 일정 항목 (GET /api/jobs/[id]/round1-schedule). */
export type Round1ScheduleItem = {
  candidateId: number;
  name: string;
  selectedSlot: { start: string; end: string };
  modeOnline: boolean;
  address: string | null;
  addressDetail: string | null;
  onlineMeetingUrl: string | null;
};

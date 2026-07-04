export type Confidence = "high" | "medium" | "low";

export type Candidate = {
  id: number;
  jobId: number;
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
  // 이력서에서 추출한 증명사진 경로(있을 때만). 표시 전용 — /api/uploads/candidate/[id]/photo 로 서빙.
  photoFilePath?: string | null;
  resumeMaskedText: string | null;
  screeningScore: number | null;
  screeningReport: {
    score: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    concerns: string[];
    matched_keywords: string[];
    breakdown?: {
      tech_fit?: { score: number; reason: string; confidence?: Confidence };
      experience_depth?: { score: number; reason: string; confidence?: Confidence };
      role_match?: { score: number; reason: string; confidence?: Confidence };
      achievement?: { score: number; reason: string; confidence?: Confidence };
      stability?: { score: number; reason: string; confidence?: Confidence };
      growth_attitude?: { score: number; reason: string; confidence?: Confidence };
    };
    requirement_gate?: {
      applies?: boolean;
      verdict?: "pass" | "fail" | "unknown";
      severity?: "hard" | "soft";
      missing?: string[];
      reason?: string;
    };
    requirement_coverage?: Array<{
      requirement: string;
      status: "direct" | "indirect" | "none";
      evidence?: string;
    }>;
    level_match?: {
      fit: "under" | "over" | "fit";
      years: number;
      penalty: number;
      reason: string;
    };
    interview_focus?: string[];
    qualitative_review?: Array<{
      item: string;
      finding: string;
      evidence?: string;
      needs_interview?: boolean;
    }>;
  } | null;
  stage: string;
  outcome: "hired" | "rejected" | "withdrawn" | null;
  outcomeReason: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  interviewEmailCount?: number;
  lastInterviewEmailSentAt?: string | null;
  decisionEmailCount?: number;
  favorited?: boolean;
};

export type Job = {
  id: number;
  title: string;
  position: string;
  status?: "active" | "closed";
  closesAt?: string | null;
};

export type InterviewEvaluation = {
  overall_score: number;
  recommendation: string;
  summary: string;
  scores: Record<string, { score: number; comment: string }>;
  strengths: string[];
  concerns: string[];
  followup_questions: string[];
  llm_assist_note?: string;
  ai_authorship?: {
    likelihood: "낮음" | "보통" | "높음";
    score: number;
    signals: string[];
    note: string;
  };
  culture_fit?: {
    items: Array<{
      topic: string;
      self_report: string;
      verification: "일치" | "불일치" | "미검증";
      evidence: string;
    }>;
    fit_note: string;
  };
};

export type PersonalityProfileView = {
  traits: Record<string, { score: number; answered: number }>;
  flags: {
    straightLining: boolean;
    inconsistent: boolean;
    rushed: boolean;
  };
};

export type Session = {
  id: number;
  accessToken: string;
  // 지원자가 면접 시작 화면에서 선택한 진행 언어 — 후보자 대면 메일(결정 통보)의 기본 언어에 반영.
  language?: "ko" | "en";
  status: "pending" | "in_progress" | "completed" | "expired";
  messages: { role: string; content: string }[];
  evaluation: InterviewEvaluation | null;
  personalityProfile?: PersonalityProfileView | null;
  // 객관식 사전 문항 결과 — mcqScore = 맞힌 수, 총 문항 = mcqResponses.length. 참고용(미반영).
  // mcqResponses = 응시 스냅샷(문항·정답·선택). 도입 초기 세션은 {chosen}만 있을 수 있어 옵셔널.
  mcqScore?: number | null;
  mcqResponses?: Array<{
    id?: string;
    question?: string;
    options?: string[];
    answer?: number;
    chosen: number;
    questionId?: string;
  }> | null;
  expiresAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type Schedule = {
  id: number;
  round: "round1" | "round2";
  accessToken: string;
  proposedSlots: Array<{ start: string; end: string }>;
  modeOnline: boolean;
  address: string | null;
  addressDetail: string | null;
  selectedSlot: { start: string; end: string } | null;
  counterSlots: Array<{ start: string; end: string }> | null;
  candidateNote: string | null;
  status:
    | "pending"
    | "selected"
    | "counter_proposed"
    | "withdrawn"
    | "cancelled";
  onlineMeetingUrl: string | null;
  onlineMeetingNote: string | null;
  meetingLinkSentAt: string | null;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
};

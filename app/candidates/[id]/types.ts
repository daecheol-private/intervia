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
};

export type Session = {
  id: number;
  accessToken: string;
  status: "pending" | "in_progress" | "completed" | "expired";
  messages: { role: string; content: string }[];
  evaluation: InterviewEvaluation | null;
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

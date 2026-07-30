export type Confidence = "high" | "medium" | "low";

export type Candidate = {
  id: number;
  jobId: number;
  // 유입 경로 — 'manual'(담당자 업로드) / 'apply_link'(지원 링크 자가 업로드).
  source: string;
  // apply_link 유입 시 referrer 호스트 (예: www.saramin.co.kr). 감지 실패 시 null.
  applyReferrerHost?: string | null;
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
    // 이력 타임라인 — 점수 무관, 화면 표시용 (기관 이름 없이 "한 일" 중심).
    timeline?: Array<{
      kind: "career" | "education" | "activity" | "training";
      start?: string | null;
      end?: string | null;
      ongoing?: boolean;
      title: string;
      highlights?: string[];
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

/** 대화록 1턴. inputSignals 는 지원자 턴에만 실리고, 신호 수집 이전 세션엔 아예 없다
 *  (그래서 전부 옵셔널) — schema.ts InterviewMessage 의 화면용 부분집합. */
export type TranscriptMessage = {
  role: string;
  content: string;
  inputSignals?: {
    pasteCount?: number;
    pastedChars?: number;
    typedChars?: number;
  } | null;
};

export type Session = {
  id: number;
  accessToken: string;
  // 지원자가 면접 시작 화면에서 선택한 진행 언어 — 후보자 대면 메일(결정 통보)의 기본 언어에 반영.
  language?: "ko" | "en";
  status: "pending" | "in_progress" | "completed" | "expired";
  messages: TranscriptMessage[];
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
  /** 서버가 계산한 면접 링크 정본 URL — 법인 서브도메인 반영({sub}.intervia.kr, 기능 OFF 면 apex). */
  interviewUrl?: string;
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
  /** 면접관 외에 확정·변경·취소 안내를 함께 받는 사람 (일정 제시 시 지정). */
  shareRecipients: Array<{
    email: string;
    name?: string;
    userId?: number;
    /** 확정 안내 메일에 평가 리포트 공유 링크가 함께 나가는 수신자. */
    report?: boolean;
  }> | null;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
};

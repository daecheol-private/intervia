import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const organizations = sqliteTable("organizations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  bizRegistrationNo: text("biz_registration_no"),
  emailDomain: text("email_domain"),
  // 오프라인 면접 시 후보자에게 안내될 회사 주소 (1차 면접 스케쥴 제시에서 사용)
  officeAddress: text("office_address"),
  officeAddressDetail: text("office_address_detail"),
  // 스캔 PDF(텍스트 레이어 없음) 이력서를 Gemini 멀티모달 OCR 로 처리할지.
  // 기본 OFF — OCR 은 마스킹 전 *원본* 이력서를 AI 수탁자(Vertex)에 전송하므로
  // (정상 PDF 의 "마스킹 후 전송" 원칙과 달라짐) 처리방침·동의를 정비한 법인만 켠다.
  // OFF 면 스캔 PDF 는 기존대로 평가 실패 → 재업로드 안내.
  allowScanOcr: integer("allow_scan_ocr", { mode: "boolean" })
    .notNull()
    .default(false),
  // JD 와 별개로 법인 전반의 선호 인재상·정성 평가 기준을 저장 (CultureFitProfile JSON).
  // AI 이력서 평가·면접 질문 생성에 자동 반영. null = 미설정.
  cultureFitProfile: text("culture_fit_profile"),
  // 시스템 관리자가 법인을 정지한 시각. null = 정상.
  // 정지 시 멤버 로그인 차단 + 신규 합류 차단. (진행 중 면접 세션은 그대로 종료까지)
  suspendedAt: text("suspended_at"),
  suspendedReason: text("suspended_reason"),
  // 법인 검증 상태 — 사칭 방지 게이트.
  //   dart_matched  : DART 등록 사업자번호 일치 → 자동 검증됨
  //   verified      : 운영자가 수동으로 확인 완료
  //   pending_review: DART 미매칭 (비상장사·신생법인) — 운영자 검토 대기
  //   rejected      : 운영자가 사칭으로 판단해 거절
  verificationStatus: text("verification_status", {
    enum: ["dart_matched", "verified", "pending_review", "rejected"],
  })
    .notNull()
    .default("pending_review"),
  verifiedAt: text("verified_at"),
  verifiedByUserId: integer("verified_by_user_id"),
  verificationNote: text("verification_note"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 같은 도메인에 여러 법인 허용 (SaaS 메일 공유 케이스 대응).
  // 사칭 방지는 사업자번호·DART·운영자 검증 게이트로 처리.
  domainIdx: index("idx_org_email_domain").on(t.emailDomain),
}));

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "set null" }),
  role: text("role", { enum: ["system_admin", "org_admin", "member"] })
    .notNull()
    .default("member"),
  status: text("status", { enum: ["active", "pending", "disabled"] })
    .notNull()
    .default("active"),
  emailVerifiedAt: text("email_verified_at"),
  // 강제 비밀번호 변경 플래그. 부트스트랩 관리자(초기 비번 "changeme") 처럼 임시
  // 비밀번호로 생성된 계정은 true → 로그인 후 변경 전까지 전역 오버레이로 차단.
  // 비밀번호 변경 성공 시 false 로 클리어.
  mustChangePassword: integer("must_change_password", { mode: "boolean" })
    .notNull()
    .default(false),
  // 가입자 약관·처리방침 동의 (PIPA 분쟁 시 입증).
  // IP/UA 도 함께 보존 — "동의 안 받았다"는 주장에 대한 기술적 입증.
  termsAcceptedAt: text("terms_accepted_at"),
  termsVersion: text("terms_version"),
  termsAcceptedIp: text("terms_accepted_ip"),
  termsAcceptedUa: text("terms_accepted_ua"),
  privacyAcceptedAt: text("privacy_accepted_at"),
  privacyVersion: text("privacy_version"),
  privacyAcceptedIp: text("privacy_accepted_ip"),
  privacyAcceptedUa: text("privacy_accepted_ua"),
  // 2FA (TOTP) — AES-256-GCM 으로 암호화된 base32 시크릿. enabled_at null 이면 미활성.
  totpSecret: text("totp_secret"),
  totpEnabledAt: text("totp_enabled_at"),
  // TOTP replay 방어 — 마지막으로 검증 성공한 timestep(counter). 이하(또는 같은) counter
  // 코드는 재사용 거부 (RFC 6238 권고). null 이면 아직 검증 이력 없음.
  lastTotpCounter: integer("last_totp_counter"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 법인 멤버 목록 / 법인별 사용자 집계. (email 은 별도 unique.)
  orgIdx: index("idx_users_org").on(t.orgId),
}));

export const passwordResets = sqliteTable("password_resets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  requestedIp: text("requested_ip"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const emailVerifications = sqliteTable("email_verifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ip: text("ip"),
  userAgent: text("user_agent"),
  lastSeenAt: text("last_seen_at"),
  expiresAt: text("expires_at").notNull(),
  // 민감 액션(권한 변경 / 토큰 충전 / cross-org candidate 조회·삭제) 직전
  // step-up 인증 통과 시각. TTL 10분. 만료되면 재인증 요구.
  stepUpVerifiedAt: text("step_up_verified_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 사용자별 세션 목록 (내 세션 / admin 강제 로그아웃).
  userIdx: index("idx_sessions_user").on(t.userId),
}));

export const orgJoinRequests = sqliteTable("org_join_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "approved", "rejected"] })
    .notNull()
    .default("pending"),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  decidedAt: text("decided_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // org_admin 합류 요청 목록 (대기중 필터).
  orgStatusIdx: index("idx_org_join_requests_org").on(t.orgId, t.status),
}));

export const jobPostings = sqliteTable("job_postings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  position: text("position").notNull(),
  level: text("level").notNull(),
  employmentType: text("employment_type").notNull(),
  responsibilities: text("responsibilities").notNull(),
  requirements: text("requirements").notNull(),
  // JD 요건 체크리스트 — 공고 저장 시 LLM 이 주요업무+자격요건을 4~8개 항목으로 1회 분해해 저장.
  // JSON 문자열 배열(string[]) 형태. 이력서 평가 시 이 고정 목록으로 requirement_coverage 를 판정해
  // **같은 공고는 후보자가 달라도 항상 동일한 JD 항목**이 나오도록 보장한다. 빈 "" = 미생성(구버전 공고).
  requirementChecklist: text("requirement_checklist").notNull().default(""),
  // 선호 인재상 — 평가·면접 시 추가 컨텍스트. 빈 문자열 허용.
  idealProfile: text("ideal_profile").notNull().default(""),
  // AI 평가 중점 사항 — **HR 내부용. 후보자에게 비공개**.
  // 채용 담당자가 AI 평가 가중치를 직접 코멘트 ("보안 경력 최우선" 등).
  // 서류평가/면접 진행/면접 평가 프롬프트에 별도 가이드 블록으로 주입됨.
  // 차별 금지 항목(성별·나이·출신지·종교 등) 입력은 정책상 금지.
  evaluationFocus: text("evaluation_focus").notNull().default(""),
  tone: text("tone", { enum: ["친절한", "중립적인", "엄격한"] })
    .notNull()
    .default("중립적인"),
  interviewDurationMinutes: integer("interview_duration_minutes")
    .notNull()
    .default(20),
  passwordHash: text("password_hash"),
  // 최초 공고 생성자 — 자동으로 면접관에 포함
  createdByUserId: integer("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  // 인사담당자가 "지원자로부터 AI 평가·국외이전·처리위탁 동의를 받았음" 을 attest 한 시각.
  // null = 미확인 (이력서 업로드 차단). PIPA 책임 전가 메커니즘.
  applicantConsentConfirmedAt: text("applicant_consent_confirmed_at"),
  applicantConsentConfirmedByUserId: integer(
    "applicant_consent_confirmed_by_user_id"
  ).references(() => users.id, { onDelete: "set null" }),
  // 공고 라이프사이클 — 기본 2개월. 종결 후 +7일 = PDF 폐기 / +14일 = PII 폐기.
  status: text("status", { enum: ["active", "closed"] })
    .notNull()
    .default("active"),
  publishedAt: text("published_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  closesAt: text("closes_at").notNull(),
  closedAt: text("closed_at"),
  extensionCount: integer("extension_count").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 대시보드 — 법인별 공고 목록.
  orgIdx: index("idx_job_postings_org").on(t.orgId),
}));

/**
 * 사용자별 공고 즐겨찾기. 개인 별표 — 같은 법인이라도 멤버마다 별표 상태 다름.
 *
 * @deprecated 공고 즐겨찾기 기능 제거됨(2026-05). 공고 목록은 "내가 면접관인 공고" 우선 정렬로 대체.
 *   데이터 보존을 위해 테이블은 유지하되 더 이상 읽거나 쓰지 않는다.
 */
export const userJobFavorites = sqliteTable(
  "user_job_favorites",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobPostings.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    pk: uniqueIndex("idx_user_job_favorites_pk").on(t.userId, t.jobId),
  })
);

/** 후보자 즐겨찾기 — 사용자별. 검토 우선 후보를 상단 고정용. */
export const userCandidateFavorites = sqliteTable(
  "user_candidate_favorites",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    pk: uniqueIndex("idx_user_candidate_favorites_pk").on(t.userId, t.candidateId),
  })
);

/**
 * 법인 합류 초대 — 공고 공유를 통해 발급. 토큰 1회용, 7일 만료.
 *
 * 발신: 그 법인 멤버가 공고 상세에서 이메일 다수 입력 → 각 이메일별 row 생성.
 * 수신: /invite/[token] 클릭 → 미가입자는 자동 가입+법인 합류, 가입자는 같은 이메일 로그인 후 합류.
 *       이미 다른 법인 소속이면 거절.
 */
export const orgInvites = sqliteTable("org_invites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  // 어느 공고를 공유하면서 발급된 초대인지 (수락 후 그 공고로 안내)
  jobId: integer("job_id").references(() => jobPostings.id, {
    onDelete: "set null",
  }),
  invitedByUserId: integer("invited_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  usedByUserId: integer("used_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const candidates = sqliteTable("candidates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").references(() => organizations.id, { onDelete: "cascade" }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobPostings.id, { onDelete: "cascade" }),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  resumeHash: text("resume_hash"),
  // 파싱된 이력서 본문(정규화) SHA-256. resume_hash(파일 바이트)와 달리 "내용 동일"을 잡는다.
  // 바이트가 달라도(재저장·재export) 텍스트가 같으면 같은 값 → 워커가 같은 공고 내 중복 자동 삭제.
  resumeContentHash: text("resume_content_hash"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  age: integer("age"),
  careerYears: integer("career_years"),
  careerSummary: text("career_summary"),
  // 최종학력 — 업로드 시 원문에서 결정적 추출 (lib/education-extract.ts). 화면 표시 전용.
  // level: 고졸 / 전문학사 / 학사 / 석사 / 박사 (+ 졸업상태 suffix 가능). school: 최종 학교명.
  educationLevel: text("education_level"),
  educationSchool: text("education_school"),
  educationMajor: text("education_major"),
  resumeFilePath: text("resume_file_path").notNull(),
  resumeText: text("resume_text").notNull(),
  resumeMaskedText: text("resume_masked_text"),
  screeningScore: integer("screening_score"),
  screeningReport: text("screening_report", { mode: "json" }).$type<{
    score: number;
    recommendation: "강력추천" | "추천" | "보류" | "비추천";
    summary: string;
    strengths: string[];
    concerns: string[];
    matched_keywords: string[];
    breakdown?: {
      tech_fit?: { score: number; reason: string };
      experience_depth?: { score: number; reason: string };
      role_match?: { score: number; reason: string };
      growth_attitude?: { score: number; reason: string };
    };
    interview_focus?: string[];
  } | null>(),
  // 채용 단계 — `status` 는 평가 상태, `stage` 는 채용 절차 위치.
  // 12-stage 모델 (메인 단계 9 + AI면접 서브 2 + 1차 면접 서브 3).
  // 마이그레이션: interview_pending→ai_pending, interview_done→ai_evaluated,
  //   interview_1→round1_passed, interview_2→round2_passed, offer/hold→hired/rejected 로 정리.
  stage: text("stage", {
    enum: [
      "applied",
      "screened",
      "ai_pending",
      "ai_evaluated",
      "round1_candidate",
      "round1_scheduling",
      "round1_waiting",
      "round1_passed",
      "round2_passed",
      "hired",
      "rejected",
      "withdrawn",
    ],
  })
    .notNull()
    .default("applied"),
  // 종결 결과 — stage 와 분리. null = 진행 중. hired/rejected/withdrawn 셋 중 하나.
  // stage 는 "어디까지 진행됐는가", outcome 은 "최종 결과는 무엇인가" 를 의미.
  // 예: stage='round1_passed' + outcome='hired' → 1차 합격까지 갔다가 최종 합격.
  outcome: text("outcome", { enum: ["hired", "rejected", "withdrawn"] }),
  // 종결 사유 코드 (자동/수동). lib/candidate-stage.ts 의 OUTCOME_REASONS 참고.
  outcomeReason: text("outcome_reason"),
  // 최종 결정 시각 — 보유기간 트리거
  decidedAt: text("decided_at"),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  decisionNote: text("decision_note"),
  // 불합격/지원취소 결정 직전 단계 — "1차 합격에서 불합격" 같은 통계용 (legacy: outcome 도입 후 stage 자체가 그 정보를 가짐)
  decisionFromStage: text("decision_from_stage"),
  // 이메일 발송 한도 — 후보자당 면접링크 10회 / 결정 통보 10회
  interviewEmailCount: integer("interview_email_count").notNull().default(0),
  decisionEmailCount: integer("decision_email_count").notNull().default(0),
  // 가장 최근 면접 링크 메일 발송 시각 (경과일 배지 표시용)
  lastInterviewEmailSentAt: text("last_interview_email_sent_at"),
  // 종결 +14일 PII 폐기 시각 (anonymized 마커)
  piiPurgedAt: text("pii_purged_at"),
  // 채용기업이 업로드 시점에 "지원자가 AI 평가 적용에 동의했음" 을 확인한 시각.
  // PIPA §15·§26·§28의8·§37의2 책임 전가 + 분쟁 시 입증.
  // 업로드/평가/면접링크 발급 라우트가 이 값 NOT NULL 검증.
  applicantConsentConfirmedAt: text("applicant_consent_confirmed_at"),
  applicantConsentConfirmedByUserId: integer(
    "applicant_consent_confirmed_by_user_id"
  ).references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 공고 상세 후보자 목록 / 법인별 집계 — 가장 빈번한 조회.
  orgIdx: index("idx_candidates_org").on(t.orgId),
  jobIdx: index("idx_candidates_job").on(t.jobId),
  // 워커의 내용 해시 중복 탐지 (같은 공고 내 동일 내용).
  jobContentHashIdx: index("idx_candidates_job_content_hash").on(
    t.jobId,
    t.resumeContentHash
  ),
  // H4 — 같은 공고에 바이트 동일 이력서(resume_hash) 중복 업로드를 DB 레벨에서 차단.
  //      업로드 dedup 이 (job_id, resume_hash) SELECT-then-INSERT 라 서로 다른 두 요청이
  //      동시에 업로드하면 둘 다 통과하던 race 를 부분 유니크 인덱스로 막는다.
  jobResumeHashUq: uniqueIndex("candidates_job_resume_hash_uq")
    .on(t.jobId, t.resumeHash)
    .where(sql`${t.resumeHash} is not null`),
}));

/**
 * 후보자별 첨부 파일 — 이력서 외에 경력기술서·포트폴리오·자기소개서 등.
 *
 * `kind=resume` 은 메인 이력서 (1개, candidate.resumeMaskedText 로 평가).
 * 그 외 텍스트 추출 가능한 첨부(career_history·cover_letter·일부 other)는 마스킹 후
 * 서류평가 프롬프트에 함께 포함된다(screening.ts). 이미지 등 추출 불가 파일만 사람 참고용.
 * career_history(경력기술서)·resume 가 1순위 상세검토, portfolio 는 낮은 비중.
 *
 * 합·불 결정 시 메인 이력서와 함께 즉시 폐기.
 */
export const candidateAttachments = sqliteTable("candidate_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  candidateId: integer("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  // SQLite text enum 은 타입 레벨만 — CHECK 제약 없어 값 추가에 마이그레이션 불필요.
  kind: text("kind", {
    enum: ["resume", "career_history", "portfolio", "cover_letter", "other"],
  })
    .notNull()
    .default("other"),
  filePath: text("file_path").notNull(),
  originalName: text("original_name").notNull(),
  mime: text("mime"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  // 첨부 내용 마스킹 텍스트. LLM 평가에 사용. 파싱 실패/이미지 등은 NULL.
  maskedText: text("masked_text"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 후보자 상세 — 후보자별 첨부 목록.
  candidateIdx: index("idx_candidate_attachments_candidate").on(t.candidateId),
}));

/**
 * 범용 API rate limit 기록. scope 별 sliding window 카운팅.
 *
 * 사용: lib/rate-limit.ts 의 rateLimit() 헬퍼.
 * 정리: 일일 cron 으로 24h 경과 row 삭제.
 */
export const apiRateLog = sqliteTable("api_rate_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(), // 'login' / 'signup' / 'llm' / 'send_email' / ...
  identifier: text("identifier").notNull(), // ip or `user:${userId}`
  attemptedAt: text("attempted_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 매 민감 요청마다 COUNT(*) sliding-window 조회 — 가장 빈번한 스캔.
  windowIdx: index("idx_api_rate_log_window").on(
    t.scope,
    t.identifier,
    t.attemptedAt
  ),
}));

/**
 * 로그인 시도 기록 — Rate limit / 무차별 대입 방어.
 *
 * 정책:
 *   - 동일 email 에 대해 15분 내 5회 실패 → 그 email 15분 잠금
 *   - 동일 IP 에 대해 15분 내 20회 실패 → 그 IP 15분 잠금
 *   - 성공 시 그 email/ip 의 이전 실패 기록 리셋
 *   - 30일 경과 행 cron 으로 정리
 */
export const authAttempts = sqliteTable("auth_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // 잠금 단위 식별자 — 이메일 또는 IP. 둘 다 별도 row 로 기록.
  identifier: text("identifier").notNull(),
  kind: text("kind", { enum: ["email", "ip"] }).notNull(),
  success: integer("success", { mode: "boolean" }).notNull(),
  // 디버깅용 부가정보
  userAgent: text("user_agent"),
  attemptedAt: text("attempted_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 로그인마다 email/ip 별 최근 실패 횟수 조회 (무차별 대입 방어).
  identIdx: index("idx_auth_attempts_ident").on(t.identifier, t.attemptedAt),
}));

export const screeningJobs = sqliteTable("screening_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  candidateId: integer("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  // paused = 소속 법인 잔액 0 이하로 일시정지 (활성 큐에서 분리 — 타 법인 영향 차단).
  //          충전되면 워커가 reconcile 단계에서 queued 로 자동 복원.
  status: text("status", {
    enum: ["queued", "processing", "done", "failed", "paused"],
  })
    .notNull()
    .default("queued"),
  attempts: integer("attempts").notNull().default(0),
  // 다음 시도 가능 시각 (백오프 후). 이 시각 이전엔 worker 가 claim 하지 않음.
  notBefore: text("not_before"),
  // 워커가 점유한 시각. null 이면 미점유. 5분 이상 묵으면 stuck 으로 간주.
  lockedAt: text("locked_at"),
  lockedBy: text("locked_by"),
  lastError: text("last_error"),
  enqueuedByUserId: integer("enqueued_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 워커 claim 핫패스 — status='queued' AND not_before<=now 스캔 (매분 cron + self-chain).
  statusIdx: index("idx_screening_jobs_status").on(t.status, t.notBefore),
  // enqueue 중복 체크 / 후보자 활성 job 조회.
  candidateIdx: index("idx_screening_jobs_candidate").on(t.candidateId),
  // H5 — 후보자당 활성(queued/processing/paused) job 은 1개만 허용. 같은 후보를 동시에
  //      enqueue 하면 check-then-insert race 로 활성 job 2개가 생겨 이중 평가·이중 과금
  //      (chargeScreeningSuccess refId=job.id 라 멱등 안 걸림)되던 문제를 DB 레벨에서 차단.
  activeCandidateUq: uniqueIndex("screening_jobs_active_candidate_uq")
    .on(t.candidateId)
    .where(sql`${t.status} in ('queued','processing','paused')`),
}));

/**
 * 서류평가 결과 캐시 — 동일 입력(같은 공고 평가기준 + 같은 이력서 내용)은 같은 점수를 재사용.
 *
 * 왜: Gemini 는 temperature 0 이어도 thinking 으로 완전 결정적이지 않다. 같은 이력서를
 *     재평가/중복 업로드하면 점수가 흔들렸다. prompt_hash(공고ID + 평가 프롬프트 전체의
 *     SHA-256)로 캐싱해, 입력이 동일하면 LLM 호출 없이 캐시 결과를 그대로 쓴다.
 *     공고 평가기준이 바뀌면 프롬프트가 달라져 cache miss → 자동으로 새로 평가.
 *
 * report 는 recomputeScore 까지 반영된 *최종* ScreeningResult.
 */
export const screeningCache = sqliteTable("screening_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  promptHash: text("prompt_hash").notNull().unique(),
  score: integer("score").notNull(),
  report: text("report", { mode: "json" }).notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export type InterviewMessage = {
  role: "user" | "model";
  content: string;
  /** 사용자 턴에만 — LLM 보조 탐지용 입력 신호 (붙여넣기/타이핑/체류시간/이탈/복사) */
  inputSignals?: {
    pasteCount: number;
    pastedChars: number;
    typedChars: number;
    msFromFirstInput: number | null;
    msSinceLastPaste: number | null;
    /** 이 턴 동안 탭 전환·창 포커스 이탈(다른 앱/창으로 이동) 횟수 */
    blurCount?: number;
    /** 이 턴 동안 면접관 질문 텍스트 복사/잘라내기 시도 횟수 (차단됨) */
    copyAttempts?: number;
  };
};

export type InterviewEvaluation = {
  overall_score: number;
  recommendation: "강력추천" | "추천" | "보류" | "비추천";
  summary: string;
  scores: Record<string, { score: number; comment: string }>;
  strengths: string[];
  concerns: string[];
  followup_questions: string[];
  /** LLM 보조 의심 신호에 대한 평가자 노트 — 단정 금지·중립 톤. */
  llm_assist_note?: string;
  /**
   * 답변 텍스트 자체의 외부 LLM(ChatGPT/Claude 등) 생성 가능성 분석 (C).
   * 행동 신호(붙여넣기/탭전환)와 독립적으로 문체만 보고 추정. 단정 금지·중립 톤.
   */
  ai_authorship?: {
    likelihood: "낮음" | "보통" | "높음";
    /** 0~100, AI 생성 가능성 점수 */
    score: number;
    /** 판단 근거 2~4개 */
    signals: string[];
    note: string;
  };
};

/**
 * 사람 면접관 스코어카드 + 메모. 한 후보자에 여러 면접관이 각자 row 작성.
 *
 * scores 4영역 (AI 평가와 동일): skill/experience/collaboration/fit.
 * 작성자 본인만 수정·삭제. 같은 법인 모두 조회 가능.
 */
export const interviewerNotes = sqliteTable("interviewer_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  candidateId: integer("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  authorUserId: integer("author_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  interviewSessionId: integer("interview_session_id"),
  // 어느 차수 면접에 대한 평가인지 — 1차/2차 스코어카드를 화면에서 분리 표시.
  // null = 차수 미지정(레거시 메모). 작성 시 후보자 stage 에서 자동 추론 + 사용자 선택 가능.
  round: text("round", { enum: ["round1", "round2"] }),
  scores: text("scores", { mode: "json" }).$type<{
    skill?: number;
    experience?: number;
    collaboration?: number;
    fit?: number;
  } | null>(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * 공고별 면접관. 한 공고에 여러 면접관 지정.
 *
 * 자동 추가 시점:
 *  1. 공고 생성자 — 생성 시 자동 추가
 *  2. 초대 링크로 합류한 사용자 — invite.jobId 있으면 그 공고에 자동 추가
 *  3. PIN 알고 잠금 해제한 사용자 — UI "면접관 지정" 버튼으로 본인 직접 추가
 *
 * 면접관 배정은 공고 단위로만 관리. (후보자별 배정 기능은 2026-06 제거)
 */
export const jobInterviewers = sqliteTable(
  "job_interviewers",
  {
    jobId: integer("job_id")
      .notNull()
      .references(() => jobPostings.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedByUserId: integer("assigned_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: text("assigned_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    pk: uniqueIndex("idx_job_interviewers_pk").on(t.jobId, t.userId),
  })
);

/**
 * 감사 로그 — 민감 액션을 추적. 시스템관리자가 법인 데이터에 접근한 이력 포함 (A-8).
 *
 * action: 'login.success' / 'candidate.view' / 'candidate.delete' /
 *         'candidate.download_resume' / 'screen.trigger' / 'screen.bulk_trigger' /
 *         'interview.create' / 'interview.send_email' / 'user.role_change' /
 *         'user.status_change' / 'org.smtp_update' / 'appeal.submit' /
 *         'appeal.status_change' / 'candidate.self_view' / 'candidate.self_delete' 등
 */
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: integer("actor_user_id"), // null = 비로그인 액터 (후보자 등)
  actorRole: text("actor_role"), // system_admin / org_admin / member / candidate / system
  orgId: integer("org_id"), // 대상 법인 (필터링용)
  action: text("action").notNull(),
  resourceType: text("resource_type"), // candidate / user / org / interview_session / appeal 등
  resourceId: integer("resource_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 법인별 감사 조회 (admin) + 시간범위.
  orgIdx: index("idx_audit_logs_org").on(t.orgId, t.createdAt),
  // 후보자 폐기 시 PII redact 대상 행 조회 (redactCandidateAuditPii).
  resourceIdx: index("idx_audit_logs_resource").on(
    t.resourceType,
    t.resourceId
  ),
}));

/**
 * 자동화 의사결정에 대한 이의제기 기록 (PIPA §37의2).
 *
 * 후보자가 면접 토큰으로 접근 + 본인 이메일 확인 후 사유 제출.
 * 토큰 만료여도 이의제기는 가능 (감사·법적 권리).
 * DPO 에게 알림 메일 발송.
 */
export const appealLogs = sqliteTable("appeal_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  candidateId: integer("candidate_id").notNull(),
  interviewSessionId: integer("interview_session_id").notNull(),
  // 본인 확인 입력값. candidates.email 과 매칭 확인 후 저장.
  email: text("email").notNull(),
  reason: text("reason").notNull(),
  status: text("status", {
    enum: ["pending", "reviewed", "resolved", "rejected"],
  })
    .notNull()
    .default("pending"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewedAt: text("reviewed_at"),
  response: text("response"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * 후보자 동의 기록 (PIPA §15, §22, §26, §37의2).
 * 면접 세션 단위로 매번 기록 — 투명성·증거력 확보.
 *
 * consents: 어떤 항목 동의했는지 boolean 맵. 필수 항목 모두 true 여야 면접 진행.
 * 정책 변경 시 consent_version 을 올려서 신규 동의 요구.
 */
export const consentLogs = sqliteTable("consent_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  interviewSessionId: integer("interview_session_id").notNull(),
  candidateId: integer("candidate_id").notNull(),
  consentVersion: text("consent_version").notNull(),
  // JSON: { collection_use: true, cross_border: true, ai_decision: true, processors: true, ... }
  // (키는 CONSENT_VERSION 별로 다를 수 있음 — 고지 항목도 '확인됨' 기록용으로 true 저장)
  consents: text("consents", { mode: "json" })
    .$type<Record<string, boolean>>()
    .notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 채팅 매 턴 hasValidConsent() 가 세션 기준 조회 — 인덱스 없으면 누적 풀스캔.
  sessionIdx: index("idx_consent_logs_session").on(t.interviewSessionId),
}));

export const interviewSessions = sqliteTable("interview_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  candidateId: integer("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  // AI 면접을 결정하고 링크를 발급한 운영자 — 면접 토큰 차감 시 "누가" 추적용.
  createdByUserId: integer("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  accessToken: text("access_token").notNull().unique(),
  status: text("status", {
    enum: ["pending", "in_progress", "completed", "expired"],
  })
    .notNull()
    .default("pending"),
  messages: text("messages", { mode: "json" })
    .$type<InterviewMessage[]>()
    .notNull()
    .default(sql`'[]'`),
  evaluation: text("evaluation", { mode: "json" }).$type<InterviewEvaluation | null>(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 후보자 상세에서 세션 조회. (accessToken 은 별도 unique 인덱스.)
  candidateIdx: index("idx_interview_sessions_candidate").on(t.candidateId),
  // 만료 cron 의 WHERE status=? AND expires_at < ? — 테이블 누적 시 풀스캔 방지.
  statusExpiresIdx: index("idx_interview_sessions_status_expires").on(
    t.status,
    t.expiresAt
  ),
}));

/**
 * 1차 면접 스케쥴. 면접관이 가능한 시간 슬롯을 제시하고, 후보자가 메일 링크로 선택.
 *
 * 라이프사이클:
 *  - status='pending'           : 면접관 제시 → 후보자 응답 대기
 *  - status='selected'          : 후보자가 시간 선택 완료 → 1차 면접 확정
 *  - status='counter_proposed'  : 후보자가 다른 시간 역제시 → 면접관 재제시 필요
 *  - status='withdrawn'         : 후보자가 지원취소 (메일 링크에서 "지원 취소" 클릭)
 *  - status='cancelled'         : 면접관이 재제시 시 이전 row 상태 (감사용 보존)
 *
 * 같은 후보자에 여러 번 제시되면 새 row 추가 + 이전 row 'cancelled' 마킹.
 */
export const interviewSchedules = sqliteTable("interview_schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  candidateId: integer("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobPostings.id, { onDelete: "cascade" }),
  orgId: integer("org_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  round: text("round", { enum: ["round1", "round2"] })
    .notNull()
    .default("round1"),
  accessToken: text("access_token").notNull().unique(),
  // 면접관 제시 슬롯: [{ start: ISO, end: ISO }, ...]
  proposedSlots: text("proposed_slots", { mode: "json" })
    .$type<Array<{ start: string; end: string }>>()
    .notNull(),
  modeOnline: integer("mode_online", { mode: "boolean" })
    .notNull()
    .default(true),
  address: text("address"),
  addressDetail: text("address_detail"),
  // 온라인 면접 미팅 링크 (Zoom·Meet·Teams 등 수동 붙여넣기). modeOnline=true 일 때만 사용.
  // 확정(status='selected') 후에 HR 이 별도로 등록 → 후보자에게 메일 + ICS 발송.
  onlineMeetingUrl: text("online_meeting_url"),
  onlineMeetingNote: text("online_meeting_note"),
  meetingLinkSentAt: text("meeting_link_sent_at"),
  meetingLinkSentByUserId: integer("meeting_link_sent_by_user_id").references(
    () => users.id,
    { onDelete: "set null" }
  ),
  // 면접관 리마인더 메일 발송 시각 — 확정 면접 24시간 전 cron 이 1회 발송 후 기록(중복 방지).
  interviewerReminderSentAt: text("interviewer_reminder_sent_at"),
  // 지원자가 선택한 슬롯
  selectedSlot: text("selected_slot", { mode: "json" })
    .$type<{ start: string; end: string } | null>(),
  // 지원자가 역제시한 슬롯 후보
  counterSlots: text("counter_slots", { mode: "json" })
    .$type<Array<{ start: string; end: string }> | null>(),
  // 지원자 코멘트 (역제시·취소 사유 등)
  candidateNote: text("candidate_note"),
  status: text("status", {
    enum: ["pending", "selected", "counter_proposed", "withdrawn", "cancelled"],
  })
    .notNull()
    .default("pending"),
  proposedByUserId: integer("proposed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  expiresAt: text("expires_at").notNull(),
  respondedAt: text("responded_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 후보자 상세 / 공고 스케쥴 조회.
  candidateIdx: index("idx_interview_schedules_candidate").on(t.candidateId),
  jobIdx: index("idx_interview_schedules_job").on(t.jobId),
  // 만료 cron · 리마인더 cron 의 status 기준 스캔 — 테이블 누적 시 풀스캔 방지.
  statusExpiresIdx: index("idx_interview_schedules_status_expires").on(
    t.status,
    t.expiresAt
  ),
}));

/**
 * LLM 이 생성하는 면접 질문지 구조.
 *
 * "다양한 형태" — 섹션별로 검증 목적이 다른 질문 묶음:
 *   기술/직무 역량 · 경험·성과 심층 · 서류/AI면접에서 드러난 우려 검증 ·
 *   인성·컬처핏 · 상황/케이스 등. 섹션 제목·개수는 후보자에 맞춰 LLM 이 결정.
 */
export type InterviewQuestionSheet = {
  /** 이 후보자를 1차 면접에서 어떻게 검증할지 — 면접관용 한 문단 전략. */
  strategy: string;
  sections: Array<{
    title: string;
    /** 이 섹션으로 무엇을 확인하는지 (평가 포인트). */
    focus: string;
    questions: Array<{
      question: string;
      /** 질문 의도 — 무엇을 보려는 질문인지. */
      intent: string;
      /** 1~2개 꼬리질문 (선택). */
      followups?: string[];
      /** 근거: 이력서/서류평가/AI면접 중 어디서 도출됐는지 짧게. */
      basis?: string;
    }>;
  }>;
  /** 반드시 확인해야 할 우려 신호 (선택). */
  red_flags?: string[];
};

/**
 * 면접 문제(질문지) 한 벌 — 후보자당 1건.
 *
 * 1차 면접 일정이 확정(interview_schedules.status='selected', round='round1')된 후
 * 면접관 중 누구나 "면접 문제 생성"을 누르면 LLM 이 이력서·서류평가·AI면접 평가를
 * 종합해 다양한 형태의 질문지를 만들어 여기에 저장한다. 이후 면접관이 팝업으로 열람.
 *
 * 후보자당 1건(candidate_id UNIQUE) — 재생성 시 같은 row 를 덮어쓴다(이력 미보관).
 */
export const interviewQuestionSheets = sqliteTable("interview_question_sheets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  candidateId: integer("candidate_id")
    .notNull()
    .unique()
    .references(() => candidates.id, { onDelete: "cascade" }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobPostings.id, { onDelete: "cascade" }),
  orgId: integer("org_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  // 생성 시점에 어떤 입력이 반영됐는지 — UI 안내용.
  // (서류평가 있었나 / AI면접 평가 있었나)
  basedOnScreening: integer("based_on_screening", { mode: "boolean" })
    .notNull()
    .default(false),
  basedOnInterview: integer("based_on_interview", { mode: "boolean" })
    .notNull()
    .default(false),
  questions: text("questions", { mode: "json" })
    .$type<InterviewQuestionSheet>()
    .notNull(),
  generatedByUserId: integer("generated_by_user_id").references(
    () => users.id,
    { onDelete: "set null" }
  ),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const orgSmtpConfigs = sqliteTable("org_smtp_configs", {
  orgId: integer("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  host: text("host").notNull(),
  port: integer("port").notNull().default(465),
  secure: integer("secure", { mode: "boolean" }).notNull().default(true),
  authUser: text("auth_user").notNull(),
  authPass: text("auth_pass").notNull(),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  lastCheckedAt: text("last_checked_at"),
  lastCheckStatus: text("last_check_status", { enum: ["ok", "fail"] }),
  lastCheckError: text("last_check_error"),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * 법인별 Zoom 연동 설정 — 온라인 면접 확정 시 줌 회의 자동 생성에 사용.
 *
 * 연동 방식: Zoom "Server-to-Server OAuth" 앱 (법인이 직접 생성).
 *   법인 담당자가 줌 마켓플레이스에서 발급한 Account ID / Client ID / Client Secret 3개를 등록.
 *   clientSecret 은 lib/crypto.ts(AES-256-GCM)로 암호화 저장 (orgSmtpConfigs.authPass 와 동일 패턴).
 *
 * 사용처: 1차 면접 일정이 온라인으로 확정되면 lib/zoom.ts 가 이 자격증명으로
 *   토큰 발급 → 회의 생성 → join_url 을 interviewSchedules.onlineMeetingUrl 에 저장 + 메일 발송.
 *
 * 설정 가이드: docs/ZOOM_SETUP_GUIDE.md (인앱: /org/zoom/guide).
 */
export const orgZoomConfigs = sqliteTable("org_zoom_configs", {
  orgId: integer("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  clientId: text("client_id").notNull(),
  // 암호화 저장 (enc:v1: prefix). 조회 시 마스킹.
  clientSecret: text("client_secret").notNull(),
  lastCheckedAt: text("last_checked_at"),
  lastCheckStatus: text("last_check_status", { enum: ["ok", "fail"] }),
  lastCheckError: text("last_check_error"),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const tokenWallets = sqliteTable("token_wallets", {
  orgId: integer("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const tokenLedger = sqliteTable("token_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  reason: text("reason", {
    enum: [
      "charge",
      "job_post",
      "resume_upload",
      "interview",
      "interview_question_gen",
      "job_extend",
      "refund",
      "admin_adjust",
    ],
  }).notNull(),
  refType: text("ref_type"),
  refId: integer("ref_id"),
  balanceAfter: integer("balance_after").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  memo: text("memo"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 멱등 차감/환불/보너스/결제는 (orgId, reason, refType, refId) 가 유일해야 한다.
  // 동시 중복 요청의 이중 차감/이중 적립을 DB 레벨에서 차단 (race backstop).
  // 반복 허용 항목(admin_adjust=refType null, 수동환불=manual_refund)은 부분 인덱스로 제외.
  idemUq: uniqueIndex("token_ledger_idem_uq")
    .on(t.orgId, t.reason, t.refType, t.refId)
    .where(sql`${t.refType} is not null and ${t.refType} != 'manual_refund'`),
  // 법인별 토큰 사용 내역 / 메트릭 집계.
  orgIdx: index("idx_token_ledger_org").on(t.orgId, t.createdAt),
}));

export const tokenPricing = sqliteTable("token_pricing", {
  featureKey: text("feature_key", {
    enum: ["job_post", "resume_upload", "interview", "interview_question_gen"],
  }).primaryKey(),
  cost: integer("cost").notNull(),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const paymentOrders = sqliteTable("payment_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  amountKrw: integer("amount_krw").notNull(),
  tokens: integer("tokens").notNull(),
  status: text("status", {
    enum: ["pending", "paid", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  provider: text("provider"),
  providerRef: text("provider_ref"),
  createdByUserId: integer("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * 사용자별 인앱 알림. 헤더 종 아이콘 + 드롭다운에서 표시.
 *
 * type 값:
 *   - ai_interview_done    : 내가 면접관인 공고에서 AI 면접 평가 완료
 *   - round1_decision      : 1차 면접 후 합/불 결정 대기
 *   - join_request         : 신규 합류 요청 (org_admin)
 *   - low_balance          : 토큰 잔액 부족 (org_admin)
 *   - new_org              : 신규 법인 등록 (system_admin)
 *   - candidate_appeal     : 후보자 이의 제기
 *
 * payload: JSON 문자열. 알림별 부가 정보(candidate_id, job_id, org_id 등).
 * 읽음 처리: read_at 이 null 이면 미읽음.
 */
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: [
      "ai_interview_done",
      "round1_decision",
      "join_request",
      "low_balance",
      "new_org",
      "candidate_appeal",
      "schedule_confirmed",
      "schedule_counter_proposed",
      "schedule_withdrawn",
      "announcement",
      "new_inquiry",
      "inquiry_replied",
    ],
  }).notNull(),
  title: text("title").notNull(),
  href: text("href").notNull(),
  payload: text("payload"),
  readAt: text("read_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 헤더 종 아이콘 — 페이지 로드마다 사용자별 미읽음 조회.
  userIdx: index("idx_notifications_user").on(t.userId, t.readAt),
}));

/**
 * 고객센터 문의 / 서비스 불편사항 신고.
 *
 * source 로 두 출처를 한 테이블에 통합:
 *   "org_user"  — 로그인한 고객(org_admin/member)의 버그·결제·사용법 문의. userId/orgId 세팅.
 *   "candidate" — 비로그인 후보자가 면접 토큰 페이지에서 올린 진행 오류·접속 문제 신고.
 *                 interviewSessionId/candidateId/orgId(세션의 채용 법인) 세팅.
 *
 * 처리: system_admin(전체) / org_admin(본인 법인) 이 /admin/inquiries 인박스에서 상태 관리.
 * 알림: 접수 시 지원 이메일(APPEAL_CONTACT)로 통지 — 실패해도 제출은 성공.
 */
export const inquiries = sqliteTable("inquiries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source", { enum: ["org_user", "candidate"] }).notNull(),
  // 분류 코드 — source 별 허용값은 lib/inquiry.ts 에서 검증. 라벨도 거기서 매핑.
  category: text("category").notNull(),
  message: text("message").notNull(),
  // 회신용 연락 이메일 (org_user = 계정 이메일, candidate = 입력값).
  contactEmail: text("contact_email").notNull(),
  // 출처별 컨텍스트 (nullable).
  orgId: integer("org_id"),
  userId: integer("user_id"),
  interviewSessionId: integer("interview_session_id"),
  candidateId: integer("candidate_id"),
  status: text("status", {
    enum: ["open", "in_progress", "resolved"],
  })
    .notNull()
    .default("open"),
  adminNote: text("admin_note"),
  resolvedByUserId: integer("resolved_by_user_id"),
  resolvedAt: text("resolved_at"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  // 인박스 — 상태별 + 최신순 조회.
  statusIdx: index("idx_inquiries_status").on(t.status, t.createdAt),
  // 법인별 인박스 (org_admin 본인 법인 필터).
  orgIdx: index("idx_inquiries_org").on(t.orgId, t.createdAt),
}));

export type Inquiry = typeof inquiries.$inferSelect;
export type NewInquiry = typeof inquiries.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type JobPosting = typeof jobPostings.$inferSelect;
export type NewJobPosting = typeof jobPostings.$inferInsert;
export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
export type InterviewSession = typeof interviewSessions.$inferSelect;
export type NewInterviewSession = typeof interviewSessions.$inferInsert;
export type OrgJoinRequest = typeof orgJoinRequests.$inferSelect;
export type TokenWallet = typeof tokenWallets.$inferSelect;
export type TokenLedger = typeof tokenLedger.$inferSelect;
export type TokenPricing = typeof tokenPricing.$inferSelect;
export type PaymentOrder = typeof paymentOrders.$inferSelect;
export type OrgSmtpConfig = typeof orgSmtpConfigs.$inferSelect;
export type NewOrgSmtpConfig = typeof orgSmtpConfigs.$inferInsert;
export type OrgZoomConfig = typeof orgZoomConfigs.$inferSelect;
export type NewOrgZoomConfig = typeof orgZoomConfigs.$inferInsert;
export type ScreeningJob = typeof screeningJobs.$inferSelect;
export type NewScreeningJob = typeof screeningJobs.$inferInsert;
export type AuthAttempt = typeof authAttempts.$inferSelect;
export type NewAuthAttempt = typeof authAttempts.$inferInsert;
export type ApiRateLog = typeof apiRateLog.$inferSelect;
export type ConsentLog = typeof consentLogs.$inferSelect;
export type NewConsentLog = typeof consentLogs.$inferInsert;
export type AppealLog = typeof appealLogs.$inferSelect;
export type NewAppealLog = typeof appealLogs.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type InterviewerNote = typeof interviewerNotes.$inferSelect;
export type NewInterviewerNote = typeof interviewerNotes.$inferInsert;
export type JobInterviewer = typeof jobInterviewers.$inferSelect;
export type NewJobInterviewer = typeof jobInterviewers.$inferInsert;
export type InterviewSchedule = typeof interviewSchedules.$inferSelect;
export type NewInterviewSchedule = typeof interviewSchedules.$inferInsert;
export type InterviewQuestionSheetRow = typeof interviewQuestionSheets.$inferSelect;
export type NewInterviewQuestionSheetRow = typeof interviewQuestionSheets.$inferInsert;

export type PasswordReset = typeof passwordResets.$inferSelect;
export type NewPasswordReset = typeof passwordResets.$inferInsert;
export type CandidateAttachment = typeof candidateAttachments.$inferSelect;
export type NewCandidateAttachment = typeof candidateAttachments.$inferInsert;
export type UserJobFavorite = typeof userJobFavorites.$inferSelect;
export type NewUserJobFavorite = typeof userJobFavorites.$inferInsert;
export type UserCandidateFavorite = typeof userCandidateFavorites.$inferSelect;
export type NewUserCandidateFavorite = typeof userCandidateFavorites.$inferInsert;
export type OrgInvite = typeof orgInvites.$inferSelect;
export type NewOrgInvite = typeof orgInvites.$inferInsert;

export type UserRole = "system_admin" | "org_admin" | "member";
export type TokenReason =
  | "charge"
  | "job_post"
  | "resume_upload"
  | "interview"
  | "job_extend"
  | "refund"
  | "admin_adjust";

// ---------------------------------------------------------------------------
// 마케팅 메일 수신자 — system_admin 이 등록·발송. 테넌트(org) 무관 시스템 전역.
export const marketingRecipients = sqliteTable(
  "marketing_recipients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    // 수신거부 페이지 접근 토큰 — 수신자별 고정, 비로그인 접근.
    unsubscribeToken: text("unsubscribe_token").notNull(),
    status: text("status", { enum: ["active", "unsubscribed"] })
      .notNull()
      .default("active"),
    lastSentAt: text("last_sent_at"),
    unsubscribedAt: text("unsubscribed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => ({
    emailUq: uniqueIndex("marketing_recipients_email_uq").on(t.email),
    tokenUq: uniqueIndex("marketing_recipients_token_uq").on(t.unsubscribeToken),
  })
);

export type MarketingRecipient = typeof marketingRecipients.$inferSelect;

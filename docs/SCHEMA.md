# DB Schema

정의: `lib/schema.ts` (Drizzle, libSQL/SQLite 호환).

스키마 변경 → `npm run db:push` (로컬). 데이터가 있어 푸시가 막히면 `scripts/migrate-multitenant.mjs` 처럼 raw ALTER 스크립트 작성.

## organizations

법인(테넌트) 루트.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| name | TEXT NOT NULL | 법인명 |
| biz_registration_no | TEXT NULL | 사업자등록번호 (검색용) |
| email_domain | TEXT NULL UNIQUE | 자동매칭 키. 공용도메인(gmail 등)은 저장 X |
| created_by_user_id | INTEGER NULL | 최초 등록자 (FK는 없음 — 순환 의존 회피) |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## users

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| email | TEXT UNIQUE NOT NULL | 로그인 ID |
| password_hash | TEXT NOT NULL | bcryptjs (rounds=10) |
| name | TEXT NOT NULL | |
| is_admin | INTEGER NOT NULL DEFAULT 0 | **레거시 컬럼**. role 으로 대체됨. 단, getCurrentUser는 role='system_admin'이면 isAdmin=true 로도 노출 |
| org_id | INTEGER NULL FK organizations(id) ON DELETE SET NULL | system_admin은 NULL 가능 |
| role | TEXT NOT NULL DEFAULT 'member' | `system_admin` / `org_admin` / `member` |
| status | TEXT NOT NULL DEFAULT 'active' | `active` / `pending` / `disabled`. pending은 합류 승인 대기 |
| email_verified_at | TEXT NULL | 인증 완료 시각. NULL 이면 로그인 차단. 기존 사용자는 마이그레이션으로 created_at 으로 백필 |
| must_change_password | INTEGER NOT NULL DEFAULT 0 | 임시 비밀번호 계정(부트스트랩 관리자 등). true 면 로그인 후 전역 오버레이(`ForcePasswordChange`)로 차단, 비밀번호 변경 시 자동 해제 |
| terms_accepted_at / terms_version / terms_accepted_ip / terms_accepted_ua | TEXT NULL | 이용약관 동의 시각·버전·IP·UA (분쟁 입증) |
| privacy_accepted_at / privacy_version / privacy_accepted_ip / privacy_accepted_ua | TEXT NULL | 처리방침 동의 시각·버전·IP·UA (분쟁 입증) |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## email_verifications

이메일 인증 토큰. 신규 가입/합류 요청 시 발급.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | |
| token | TEXT UNIQUE NOT NULL | `v_` + 24 random bytes hex |
| expires_at | TEXT NOT NULL | 3일 |
| consumed_at | TEXT NULL | 사용 시각. 한 번만 사용 가능 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## sessions

| 컬럼 | 타입 | 비고 |
|---|---|---|
| token | TEXT PK | `s_` + 24 bytes hex |
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | |
| ip | TEXT NULL | 로그인 시점 IP (x-forwarded-for 우선) |
| user_agent | TEXT NULL | 500자 잘림 |
| last_seen_at | TEXT NULL | `getCurrentUser` 가 60초 간격으로 갱신 |
| expires_at | TEXT NOT NULL | 14일 후 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

사용자는 `/account` 에서 본인 활성 세션 목록 + 원격 로그아웃 가능.

## org_join_requests

도메인 자동매칭/검색으로 가입 시 생성되는 합류 요청.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| org_id | INTEGER NOT NULL FK organizations(id) ON DELETE CASCADE | |
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | 가입과 동시에 user row 생성 (status='pending') |
| status | TEXT NOT NULL DEFAULT 'pending' | `pending` / `approved` / `rejected` |
| decided_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | 승인/거절한 org_admin |
| decided_at | TEXT NULL | |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## job_postings

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| org_id | INTEGER NULL FK organizations(id) ON DELETE CASCADE | 마이그레이션 호환 위해 nullable. 신규 row는 항상 채움 |
| title / position / level / employment_type / responsibilities / requirements | TEXT NOT NULL | |
| tone | TEXT NOT NULL DEFAULT '중립적인' | 친절한/중립적인/엄격한 |
| interview_duration_minutes | INTEGER NOT NULL DEFAULT 30 | |
| password_hash | TEXT NULL | 4자리 PIN |
| status | TEXT NOT NULL DEFAULT 'active' | `active` / `closed`. cron 이 closes_at 도래 시 closed 로 전환 |
| published_at | TEXT NOT NULL | 공고 게시 시각 (= 생성 시각으로 채움) |
| closes_at | TEXT NOT NULL | 종결 예정. 기본 published_at + 60일. 연장 시 +30일 |
| closed_at | TEXT NULL | cron 이 실제 종결 처리한 시각. PDF 폐기(+7일) / PII 폐기(+14일) 기준점 |
| extension_count | INTEGER NOT NULL DEFAULT 0 | 연장 횟수 (감사용) |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## candidates

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| org_id | INTEGER NULL FK organizations(id) ON DELETE CASCADE | job.org_id 와 동일하게 비정규화 (쿼리 단순화) |
| job_id | INTEGER NOT NULL FK job_postings(id) ON DELETE CASCADE | |
| uploaded_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| resume_hash | TEXT NULL | SHA-256 |
| name / email / phone / age / career_years / career_summary | … | 정규식 + LLM 추출 |
| education_level / education_school / education_major | TEXT NULL | 최종학력(수준/학교명/전공). 업로드 시 원문에서 결정적 추출 (`lib/education-extract.ts`). 셋 다 화면 표시. **AI 평가에는 학력 수준·전공만 전달(학교명 제외 — 학벌 차별 방지)** |
| stage | TEXT NOT NULL DEFAULT 'applied' | applied/screened/interview_1/interview_2/offer/hired/rejected/hold/withdrawn |
| decided_at | TEXT NULL | 단말 단계 (hired/rejected/withdrawn) 진입 시각 |
| decided_by_user_id | INTEGER NULL FK users | 결정한 채용담당자 |
| decision_note | TEXT NULL | 내부 메모 (후보자 비공개) |
| interview_email_count | INTEGER NOT NULL DEFAULT 0 | 면접링크 메일 발송 누적. 후보자당 10회 한도 |
| last_interview_email_sent_at | TEXT NULL | 가장 최근 면접 링크 메일 발송 시각. UI 경과일 배지에 사용 |
| decision_email_count | INTEGER NOT NULL DEFAULT 0 | 결정 통보 메일 발송 누적. 후보자당 10회 한도 |
| pii_purged_at | TEXT NULL | 공고 종결 +14일 cron 이 PII 익명화한 시각. NULL = 미처리 |
| applicant_consent_confirmed_at | TEXT NULL | 채용기업이 "지원자가 AI 평가 적용에 동의했음"을 확인한 시각. PIPA §15·§26·§28의8·§37의2 책임을 고객사로 전가. 업로드/평가 라우트가 NOT NULL 검증 (2026-05-22 이전 row 는 legacy 면제) |
| applicant_consent_confirmed_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | 동의 확인을 클릭한 채용기업 사용자 |
| resume_file_path | TEXT NOT NULL | 로컬 파일명 또는 Blob URL. 폐기 시 빈 문자열 |
| resume_text | TEXT NOT NULL | **항상 빈 문자열** — 원본은 DB 에 저장 안 함 (PIPA). 컬럼은 호환성 위해 유지 |
| resume_masked_text | TEXT NULL | 마스킹된 텍스트. **LLM 에 전달되는 유일한 본문**. UI 미리보기도 이 값. 폐기 시 NULL |
| screening_score | INTEGER NULL | 0~100 |
| screening_report | JSON NULL | 평가 리포트 (`ScreeningResult` — `lib/screening.ts`). 6축 `breakdown`(각 축 score/reason/**confidence**) + `level_match`(연차 보정) + `focus_match`(HR 가이드 가감) + **`requirement_gate`**(JD 필수요건 미충족 시 종합점수 하드캡 40) + **`requirement_coverage`**(JD 요건별 direct/indirect/none 매트릭스) + **`evidence_quality`**(specific/mixed/generic — 나열형 이력서 캡 60) + **`domain_fit`**(JD 전문 도메인 경험 none 시 캡 50) + `career_info` 등. 종합 점수는 LLM 출력이 아니라 **6축 가중평균 → spread(50기준 1.4배 확대) → 페널티/캡(confidence·구체성·도메인·약한핵심축·필수요건)** 으로 코드가 재계산 (`recomputeScore`). 6축 가중치: tech_fit .20 / experience_depth .20 / role_match .25 / achievement .15 / stability .10 / growth_attitude .10 |
| status | TEXT NOT NULL DEFAULT 'uploaded' | uploaded/screening/screened/interviewed/failed |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(job_id, uploaded_by_user_id, resume_hash)` 중복 체크.

## interview_sessions

기존과 동일. (org_id 비정규화 X — candidate 통해 조인)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id / candidate_id / access_token / status / messages / evaluation / started_at / completed_at / expires_at / created_at | … | |

## interviewer_notes / interviewer_assignments

사람 면접관 스코어카드·메모 + 배정.

### interviewer_notes
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| candidate_id | INTEGER NOT NULL FK candidates(id) ON DELETE CASCADE | |
| author_user_id | INTEGER NOT NULL FK users(id) | 본인만 수정·삭제 |
| interview_session_id | INTEGER NULL | (선택) 어느 면접 세션에 대한 메모인지 |
| round | TEXT NULL | `round1`/`round2` — 1차/2차 면접 스코어카드 구분. 작성 시 stage 에서 자동 추론 + 사용자 선택. null=레거시 |
| scores | TEXT NULL (JSON) | `{skill?, experience?, collaboration?, fit?}` 각 0-100 |
| note | TEXT NOT NULL DEFAULT '' | 자유 메모 5000자 이내 |
| created_at / updated_at | TEXT NOT NULL | |

### interviewer_assignments
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| candidate_id | INTEGER NOT NULL FK candidates(id) ON DELETE CASCADE | |
| user_id | INTEGER NOT NULL FK users(id) | 배정된 면접관 |
| assigned_by_user_id | INTEGER NULL FK users(id) | |
| created_at | TEXT NOT NULL | |

배정은 알림·UI 강조용 — 메모 작성 권한과 별개. 같은 법인 멤버만 배정 가능, 중복 방지.

## audit_logs

민감 액션 추적 (시스템관리자 cross-org 접근 포함).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| actor_user_id | INTEGER NULL | null = 비로그인 (후보자/system) |
| actor_role | TEXT NULL | system_admin/org_admin/member/candidate/system |
| org_id | INTEGER NULL | 대상 법인 (필터링) |
| action | TEXT NOT NULL | 예: 'candidate.delete', 'screen.bulk_trigger' |
| resource_type | TEXT NULL | candidate/user/org/interview_session/appeal |
| resource_id | INTEGER NULL | |
| ip / user_agent | TEXT NULL | |
| metadata | TEXT NULL (JSON) | 액션별 부가정보. `cross_org:true` 등 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(org_id, created_at DESC)`, `(actor_user_id, created_at DESC)`.

`lib/audit.ts` 의 `logAudit(req, entry)` 로 호출. fire-and-forget — 실패해도 본 흐름 영향 X.

## appeal_logs

자동화 의사결정 이의제기 (PIPA §37의2).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| candidate_id | INTEGER NOT NULL | |
| interview_session_id | INTEGER NOT NULL | |
| email | TEXT NOT NULL | 본인 확인 입력값 |
| reason | TEXT NOT NULL | 사유 (10~5000자) |
| status | TEXT NOT NULL DEFAULT 'pending' | pending/reviewed/resolved/rejected |
| ip / user_agent | TEXT NULL | |
| reviewed_by_user_id | INTEGER NULL | 검토한 채용담당자/관리자 |
| reviewed_at | TEXT NULL | |
| response | TEXT NULL | 내부 메모 / 답변 초안 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(candidate_id, created_at)`.

후보자는 면접 토큰으로 `/interview/[token]/appeal` 접근 → 제출 시 DPO 메일 알림. PIPA §37의2 에 따라 7영업일 내 답변 의무.

## consent_logs

후보자 동의 기록 (PIPA §15, §22, §26, §28의8, §37의2).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| interview_session_id | INTEGER NOT NULL | (논리 FK, ON DELETE cascade 없음 — 감사 보존) |
| candidate_id | INTEGER NOT NULL | 비정규화 |
| consent_version | TEXT NOT NULL | 예: `1.0.0-2026-05-16` |
| consents | TEXT NOT NULL (JSON) | `{collection_use: bool, ai_decision: bool, processors: bool, retention: bool, ...}` |
| ip | TEXT NULL | x-forwarded-for 첫 IP |
| user_agent | TEXT NULL | 500자 잘림 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(interview_session_id)`.

정책 변경 시 `CONSENT_VERSION` (lib/consent.ts) 상향 → 신규 면접 세션이 재동의 요구. 구버전 row 는 그대로 보존 (감사·증거).

## api_rate_log

범용 API rate limit 로그. `lib/rate-limit.ts` 의 `rateLimit()` 헬퍼가 사용.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| scope | TEXT NOT NULL | 'signup' / 'setup' / 'send-email' / 'llm-screen' 등 |
| identifier | TEXT NOT NULL | IP 또는 `user:${userId}` |
| attempted_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(scope, identifier, attempted_at)`.

정리: 24h 경과 row 일일 cron 으로 삭제 (`/api/cron/purge-original` 에 통합).

## auth_attempts

로그인 시도 기록. Rate limit + 무차별 대입 방어.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| identifier | TEXT NOT NULL | 이메일 or IP |
| kind | TEXT NOT NULL | 'email' / 'ip' |
| success | INTEGER NOT NULL | boolean |
| user_agent | TEXT NULL | (디버깅용, 500자 잘림) |
| attempted_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | UTC `'YYYY-MM-DD HH:MM:SS'` |

인덱스: `(identifier, kind, attempted_at)` 윈도우 조회용.

정책 (`lib/auth-attempts.ts`):
- email 15분 내 5회 실패 → 15분 잠금
- IP 15분 내 20회 실패 → 15분 잠금 (다수 계정 무차별 공격 차단)
- 성공 시 해당 identifier 의 이전 실패 row 모두 삭제 (즉시 잠금 해제)
- 30일 경과 row 일일 cron 정리 (`/api/cron/purge-original` 에 통합)

⚠️ timestamp 비교 주의: `CURRENT_TIMESTAMP` 와 JS `toISOString()` 포맷 다름. `sqliteTimestamp()` / `parseSqliteTimestamp()` 헬퍼 사용.

## screening_jobs

서류 평가 큐. candidate 1건당 active job 1개 (queued/processing). done/failed 는 이력으로 남음.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| candidate_id | INTEGER NOT NULL FK candidates(id) ON DELETE CASCADE | |
| status | TEXT NOT NULL DEFAULT 'queued' | queued / processing / done / failed |
| attempts | INTEGER NOT NULL DEFAULT 0 | 시도 횟수. MAX_ATTEMPTS=3 |
| not_before | TEXT NULL | 백오프 후 다음 시도 가능 시각 |
| locked_at | TEXT NULL | worker 가 점유한 시각. 5분+ 지속 시 stuck 으로 복구 |
| locked_by | TEXT NULL | worker id |
| last_error | TEXT NULL | 최근 실패 사유 (1000자 잘림) |
| enqueued_by_user_id | INTEGER NULL FK users(id) | 누가 큐에 넣었는지 |
| started_at / completed_at | TEXT NULL | |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(status, not_before)` 워커 조회용, `(candidate_id)`.

워커: `POST /api/internal/process-screenings` (동시성 N, 최대 M건/실행, 남으면 self-chain).
Cron 안전망: 매분 `/api/cron/process-screenings` 로 stuck 복구 + 잔여 처리.

## interview_question_sheets

1차 대면 면접 질문지. **후보자당 1건** (`candidate_id` UNIQUE — 재생성 시 덮어쓰기).

1차 면접 일정 확정(`interview_schedules` round1 · status='selected') 후 면접관 누구나 생성.
이력서(마스킹) + 서류평가(`screeningReport`) + AI 면접 평가(`interviewSessions.evaluation`, 있으면)를
종합해 LLM(task=`questionGen`)이 생성. **토큰 과금 없음(무료)**.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| candidate_id | INTEGER NOT NULL UNIQUE FK candidates(id) ON DELETE CASCADE | 후보자당 1건 |
| job_id | INTEGER NOT NULL FK job_postings(id) ON DELETE CASCADE | |
| org_id | INTEGER NULL FK organizations(id) ON DELETE CASCADE | |
| based_on_screening | INTEGER NOT NULL DEFAULT 0 | 생성 시 서류평가 반영 여부 (boolean) |
| based_on_interview | INTEGER NOT NULL DEFAULT 0 | 생성 시 AI면접 평가 반영 여부 (boolean) |
| questions | JSON NOT NULL | `InterviewQuestionSheet` — `{strategy, sections[], red_flags?}`. 섹션별 `{title, focus, questions[{question, intent, followups?, basis?}]}` |
| generated_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | 마지막 생성자 |
| created_at / updated_at | TEXT NOT NULL | |

타입: `InterviewQuestionSheet`(questions JSON 형상), `InterviewQuestionSheetRow`(row) — `lib/schema.ts`.

## org_smtp_configs

법인별 SMTP 설정. 1:1. 미설정 시 환경변수 SMTP (시스템 기본) 사용.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| org_id | INTEGER PK FK organizations(id) ON DELETE CASCADE | |
| host | TEXT NOT NULL | 예: smtp.gmail.com |
| port | INTEGER NOT NULL DEFAULT 465 | |
| secure | INTEGER NOT NULL DEFAULT 1 | boolean, 465=true, 587=false (STARTTLS) |
| auth_user | TEXT NOT NULL | SMTP 로그인 계정 |
| auth_pass | TEXT NOT NULL | 평문 저장 (프로토타입). 응답 시 마스킹 |
| from_email | TEXT NOT NULL | 발신 주소 |
| from_name | TEXT NULL | 발신자 표시명 |
| last_checked_at | TEXT NULL | 마지막 헬스체크 시각 |
| last_check_status | TEXT NULL | 'ok' / 'fail' |
| last_check_error | TEXT NULL | 실패 시 메시지 |
| updated_by_user_id | INTEGER NULL FK users(id) | |
| updated_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

저장 시 `nodemailer.transporter.verify()` 로 자동 헬스체크. 실패해도 저장은 진행 (상태만 fail 로 기록).

## token_wallets

법인별 지갑. 1:1.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| org_id | INTEGER PK FK organizations(id) ON DELETE CASCADE | |
| balance | INTEGER NOT NULL DEFAULT 0 | 음수 허용 (후불 정책) |
| updated_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## token_ledger

모든 토큰 변동 감사 로그. wallet.balance 의 누적 결과는 ledger 합과 일치해야 함.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| org_id | INTEGER NOT NULL FK organizations(id) ON DELETE CASCADE | |
| delta | INTEGER NOT NULL | 음수 = 차감, 양수 = 충전/환불 |
| reason | TEXT NOT NULL | `charge` / `job_post` / `resume_upload` / `interview` / `refund` / `admin_adjust` |
| ref_type | TEXT NULL | 차감/환불 대상 종류. 예: `job`, `candidate`, `interview_session` |
| ref_id | INTEGER NULL | 대상 id |
| balance_after | INTEGER NOT NULL | 기록 직후 잔액 |
| created_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| memo | TEXT NULL | |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

중복 방지 규칙 (코드 단): `chargeFeature` 는 `(org_id, reason, ref_type, ref_id)` 가 같은 row 있으면 no-op. `refundFeature` 도 같은 키로 환불 row 있으면 no-op.

## token_pricing

기능별 단가. system_admin만 수정.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| feature_key | TEXT PK | `job_post` / `resume_upload` / `interview` |
| cost | INTEGER NOT NULL | 0 이상 |
| updated_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| updated_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

변경 시 **소급 X** — chargeFeature 호출 시점의 pricing 으로 차감.

## payment_orders

결제 시스템 스텁. PR-6 시점에는 row 생성 흐름 없음.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id / org_id / amount_krw / tokens / status / provider / provider_ref / created_by_user_id / created_at | … | status: pending/paid/failed/cancelled |

## TypeScript 타입

`lib/schema.ts` 하단 export. `Organization`, `User`, `JobPosting`, `Candidate`, `InterviewSession`, `OrgJoinRequest`, `TokenWallet`, `TokenLedger`, `TokenPricing`, `PaymentOrder`, `UserRole`, `TokenReason` 등.

## 관계 다이어그램

```
organizations ─< users (org_id, role)
      │
      ├─< org_join_requests ─> users (user_id)
      ├─< token_wallets (1:1)
      ├─< token_ledger
      ├─< payment_orders
      ├─< job_postings ─< candidates ─< interview_sessions
      └─< (위 모든 자식 CASCADE)
```

## 마이그레이션 스크립트

기존 단일테넌트 → 멀티테넌트 이관: `scripts/migrate-multitenant.mjs`.
- 기본 법인 생성 (이름: `DEFAULT_ORG_NAME` 환경변수 또는 `default-org`)
- is_admin=1 → role='system_admin'
- 나머지 사용자 → 기본 법인 멤버, 가장 오래된 사용자 → org_admin
- 기존 job/candidate 모두 기본 법인에 귀속
- 기본 법인 wallet 10000 토큰
- 단가 시드 (`job_post=10`, `resume_upload=5`, `interview=30`)

테스트 시드: `scripts/seed-test.mjs` — `test-company-a` / `test-company-b` 2법인 + 4역할 사용자.

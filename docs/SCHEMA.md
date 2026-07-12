# DB Schema

정의: `lib/schema.ts` (Drizzle, libSQL/SQLite 호환).

스키마 변경 워크플로우는 CLAUDE.md "새 기능 추가 시 체크리스트" 참조: `lib/schema.ts` 수정 → `npm run db:generate` → 생성된 `drizzle/NNNN_*.sql` 검토(DROP/DELETE 있으면 운영 데이터 보호 규칙 적용) → `npm run db:migrate`. 로컬 빠른 실험만 `npm run db:push`.

## organizations

법인(테넌트) 루트.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| name | TEXT NOT NULL | 법인명 |
| biz_registration_no | TEXT NULL | 사업자등록번호 (검색용) |
| email_domain | TEXT NULL | 자동매칭 키. 공용도메인(gmail 등)은 저장 X. **UNIQUE 아님** — 같은 도메인 1:N 법인 허용(비유니크 인덱스, `lib/schema.ts`). check-email 이 `matchedOrgs[]` 배열로 반환해 사용자가 합류할 법인 선택 (ARCHITECTURE §8) |
| office_address | TEXT NULL | 오프라인 면접 시 후보자에게 안내될 회사 주소 (1차 면접 스케쥴 제시에 사용) |
| office_address_detail | TEXT NULL | 상세 주소 |
| allow_scan_ocr | INTEGER NOT NULL DEFAULT 0 | **OCR 개인정보 게이트** (boolean) — 스캔 PDF(텍스트 레이어 없음)를 Gemini 멀티모달 OCR 로 처리할지. OCR 은 마스킹 전 **원본** 이력서를 AI 수탁자에 전송하므로 처리방침·동의를 정비한 법인만 ON. OFF 면 스캔 PDF 는 평가 실패 → 재업로드 안내 |
| culture_fit_profile | TEXT NULL | 법인 전반의 선호 인재상·정성 평가 기준 (`CultureFitProfile` JSON — 선호 인재상 + 정성 평가 항목 6종). `/org/settings` 에서 입력 — JD 와 별개로 AI 이력서 평가·면접 질문지(1·2차) 생성에 자동 반영. NULL=미설정. **존재 여부가 인성검사 출제 게이트**. JSON 내 `traitProfile` 은 레거시 — Big Five 선호 특성은 `job_postings.trait_profile` 로 이동(2026-06), 읽기 경로는 전부 공고 값 사용 |
| logo_file_key | TEXT NULL | **지원 페이지 브랜딩** — 회사 로고 파일 키(`saveFile()` 반환: Blob URL 또는 로컬 파일명). 공개 지원 페이지(`/apply/[token]`)와 법인 설정 미리보기에 스트리밍 프록시로 노출(Blob URL 비노출). NULL=미설정 (0053) |
| brand_color | TEXT NULL | **지원 페이지 브랜딩** — 포인트 컬러 `#rrggbb`. 지원 페이지 헤더 밴드 배경·제출 버튼에 적용, 밴드 위 글자색은 YIQ 밝기로 자동 결정(`lib/brand-color.ts` — 대비 시스템 보장). NULL=기본 테마 (0053) |
| subdomain | TEXT NULL UNIQUE | **지원 페이지 서브도메인** — `{sub}.intervia.kr` 라벨. 사칭 방지를 위해 자유 입력 불가, email_domain 첫 라벨에서만 자동 유도(`lib/subdomain.ts` — 예약어·공용도메인 제외, 충돌 시 `-{orgId}` 접미사). apply-link 라우트에서 lazy 발급. 운영 활성화는 `SUBDOMAIN_APPLY_ENABLED=1`(와일드카드 DNS 필요, DEPLOY.md) (0054) |
| setup_guide_dismissed_at | TEXT NULL | **[deprecated]** 과거 "법인 단위" 가이드 숨김 시각. 숨김은 `users.setup_guide_dismissed_at`(개인 단위)로 이관됨(0026). 백필 소스·이력 보존용으로 유지(DROP 금지) |
| suspended_at | TEXT NULL | 시스템 관리자가 법인을 정지한 시각. NULL=정상. 정지 시 멤버 로그인 차단 + 신규 합류 차단 (진행 중 면접 세션은 종료까지 유지) |
| suspended_reason | TEXT NULL | 정지 사유 |
| verification_status | TEXT NOT NULL DEFAULT 'pending_review' | **사칭 방지 게이트** — `dart_matched`(DART 등록 사업자번호 일치 → 자동 검증) / `verified`(운영자 수동 확인) / `pending_review`(DART 미매칭 — 비상장사·신생법인, 운영자 검토 대기) / `rejected`(운영자가 사칭 판단해 거절) |
| verified_at | TEXT NULL | 검증 확정 시각 |
| verified_by_user_id | INTEGER NULL | 수동 검증/거절한 운영자 (FK 없음) |
| verification_note | TEXT NULL | 운영자 검토 메모 |
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
| totp_secret | TEXT NULL | 2FA(TOTP) base32 시크릿 — AES-256-GCM 암호화 저장 (`lib/crypto.ts`) |
| totp_enabled_at | TEXT NULL | 2FA 활성 시각. NULL=미활성 |
| last_totp_counter | INTEGER NULL | TOTP replay 방어 — 마지막 검증 성공 timestep(counter). 이하(또는 같은) counter 코드는 재사용 거부 (RFC 6238). NULL=검증 이력 없음 |
| setup_guide_dismissed_at | TEXT NULL | 시작 가이드(온보딩)를 본인이 직접 숨긴 시각 — **개인 단위**(0026). NULL=계속 표시. 4단계 완료와 무관하게 이 값이 찍히기 전까지 가이드(대시보드 hero/strip + 플로팅 위젯) 노출. `getCurrentUser`가 세션 조인으로 함께 로드 → `app/page.tsx`·`setup-progress` 라우트가 공유. (구 `organizations.setup_guide_dismissed_at`에서 이관) **법인담당자(org_admin) 전용** — 멤버는 이 순차 가이드를 안 보고 `seen_member_guides` 기반 페이지 가이드를 쓴다 |
| seen_member_guides | TEXT NULL | 멤버(면접관)가 이미 본 **페이지 가이드** 키 목록 — JSON 배열 문자열 (예: `["job_page","candidate_page"]`). 멤버는 순차 온보딩 대신 "공고/후보 페이지 첫 진입 시 그 페이지 가이드 1회" 방식이라, 노출된 키를 누적해 재노출을 막는다(계정별). NULL=아직 없음. `/api/orgs/me/member-guides`(GET 조회·POST 기록)가 사용. org_admin·system_admin 은 미사용 (0030) |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## password_resets

비밀번호 재설정 토큰 (`lib/password-reset.ts`). 발급 시 그 사용자의 기존 미사용 토큰을 모두 무효화 — 사용자당 활성 토큰 1개.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | |
| token | TEXT UNIQUE NOT NULL | `p_` + 24 random bytes hex |
| expires_at | TEXT NOT NULL | 1시간 (짧게) |
| consumed_at | TEXT NULL | 사용 시각. 한 번만 사용 가능 — 신규 발급에 의한 강제 무효화도 이 값으로 처리 |
| requested_ip | TEXT NULL | 요청 시점 IP |
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
| last_seen_at | TEXT NULL | `getCurrentUser` 가 5분 간격으로 갱신 (이때 expires_at 도 함께 슬라이딩) |
| expires_at | TEXT NOT NULL | 슬라이딩 24시간 — 발급/활동 시점 +24h (5분 throttle 로 갱신) |
| step_up_verified_at | TEXT NULL | 민감 액션(권한 변경/토큰 충전/cross-org 후보자 조회·삭제) 직전 step-up 인증 통과 시각. TTL 10분 — 만료 시 재인증 요구 |
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

## org_invites

법인 합류 초대 — 공고 공유를 통해 발급. 토큰 1회용, 7일 만료.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| token | TEXT UNIQUE NOT NULL | 초대 링크 토큰 (`/invite/[token]`, 비로그인 접근) |
| org_id | INTEGER NOT NULL FK organizations(id) ON DELETE CASCADE | |
| email | TEXT NOT NULL | 초대 대상. 멤버가 공고 상세에서 이메일 다수 입력 → 이메일별 row 생성 |
| job_id | INTEGER NULL FK job_postings(id) ON DELETE SET NULL | 어느 공고를 공유하며 발급된 초대인지 — 수락 후 그 공고로 안내 |
| invited_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | 발급자 |
| expires_at | TEXT NOT NULL | 7일 |
| used_at | TEXT NULL | 수락 시각. 1회용 |
| used_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | 수락한 사용자 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

수락 흐름: 미가입자는 자동 가입 + 법인 합류, 기가입자는 같은 이메일로 로그인 후 합류. 이미 다른 법인 소속이면 거절.

## job_postings

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| org_id | INTEGER NULL FK organizations(id) ON DELETE CASCADE | 마이그레이션 호환 위해 nullable. 신규 row는 항상 채움 |
| title / position / level / employment_type / responsibilities / requirements | TEXT NOT NULL | |
| requirement_checklist | TEXT NOT NULL DEFAULT '' | JD 요건 체크리스트 — 공고 저장 시 LLM 이 주요업무+자격요건을 4~8개 항목으로 1회 분해해 저장 (JSON `string[]`). 이력서 평가가 이 고정 목록으로 `requirement_coverage` 를 판정 → **같은 공고는 후보자가 달라도 항상 동일한 JD 항목** 보장. 빈 ''=미생성(구버전 공고) |
| ideal_profile | TEXT NOT NULL DEFAULT '' | 선호 인재상 — 평가·면접 시 추가 컨텍스트. 빈 문자열 허용 |
| trait_profile | TEXT NULL | AI 면접 인성검사 선호 Big Five 특성 (`TraitProfile` JSON). NULL=전 특성 medium(기본 세트만 출제). **공고 단위** — 직무마다 검증 특성이 달라 법인 설정이 아님. high 는 검증 우선순위(심화 문항 + 면접 행동 검증) — 최대 3개 서버 검증, 공고 폼에서 담당자가 직접 선택. 마이그레이션 0024 가 기존 공고에 법인 레거시 값 복사 |
| evaluation_focus | TEXT NOT NULL DEFAULT '' | AI 평가 중점 사항 — **HR 내부용, 후보자 비공개**. 평가 가중치 코멘트("보안 경력 최우선" 등)를 서류평가/면접 진행/면접 평가 프롬프트에 가이드 블록으로 주입. 차별 금지 항목(성별·나이·출신지·종교 등) 입력은 정책상 금지 |
| tone | TEXT NOT NULL DEFAULT '중립적인' | 친절한/중립적인/엄격한 |
| interview_duration_minutes | INTEGER NOT NULL DEFAULT 20 | |
| password_hash | TEXT NULL | 4자리 PIN |
| created_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | 최초 공고 생성자 — 자동으로 면접관(`job_interviewers`)에 포함 |
| applicant_consent_confirmed_at | TEXT NULL | 인사담당자가 "지원자로부터 AI 평가·국외이전·처리위탁 동의를 받았음"을 attest 한 시각. NULL=미확인 → 이력서 업로드 차단. PIPA 책임 전가 메커니즘 |
| applicant_consent_confirmed_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | attest 한 사용자 |
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
| resume_hash | TEXT NULL | 파일 **바이트** SHA-256. 업로드 시 `(job_id, resume_hash)` 중복 거부 (1차 dedup, 바이트 동일만) |
| resume_content_hash | TEXT NULL | 파싱된 **본문**(정규화) SHA-256. 워커가 파싱 후 기록. 같은 공고에 동일 내용이 먼저 있으면 자동 삭제 (2차 dedup, 바이트 달라도 잡음) |
| name / email / phone / age / career_years / career_summary | … | 정규식 + LLM 추출 |
| education_level / education_school / education_major | TEXT NULL | 최종학력(수준/학교명/전공). 업로드 시 원문에서 결정적 추출 (`lib/education-extract.ts`). 셋 다 화면 표시. **AI 평가에는 학력 수준·전공만 전달(학교명 제외 — 학벌 차별 방지)** |
| stage | TEXT NOT NULL DEFAULT 'applied' | 12값: applied/screened/ai_pending/ai_evaluated/round1_candidate/round1_scheduling/round1_waiting/round1_passed/round2_passed/hired/rejected/withdrawn. **파이프라인 위치** — 종결 후에도 보존 (`lib/stage-meta.ts`) |
| outcome | TEXT NULL | `hired`/`rejected`/`withdrawn`/NULL=진행중. **종결 결과** — stage 와 분리. 서브상태(누가 액션할 차례)는 컬럼이 아니라 `lib/candidate-state.ts` 가 큐/세션/스케줄에서 파생 |
| outcome_reason | TEXT NULL | 종결 사유 코드 (`OutcomeReason` — `lib/candidate-stage.ts`). rejected 는 필수 |
| decision_from_stage | TEXT NULL | 종결 시점의 stage 스냅샷 (통계용) |
| decided_at | TEXT NULL | 단말 단계 (hired/rejected/withdrawn) 진입 시각 |
| decided_by_user_id | INTEGER NULL FK users | 결정한 채용담당자 |
| decision_note | TEXT NULL | 내부 메모 (후보자 비공개) |
| interview_email_count | INTEGER NOT NULL DEFAULT 0 | 면접링크 메일 발송 누적. 후보자당 10회 한도 |
| last_interview_email_sent_at | TEXT NULL | 가장 최근 면접 링크 메일 발송 시각. UI 경과일 배지에 사용 |
| decision_email_count | INTEGER NOT NULL DEFAULT 0 | 결정 통보 메일 발송 누적. 후보자당 10회 한도 |
| pii_purged_at | TEXT NULL | ⚠️ **현재 미사용 컬럼** — 종결 +14일 폐기는 `purgePiiAfterClose` 가 candidates **행 자체를 삭제**(anonymize-in-place 아님)하므로 이 값을 set 하는 코드 경로가 없음. 향후 "행 보존 + 익명화" 전략으로 바꿀 때 사용 예정. (감사 로그 metadata 의 후보자 PII 는 삭제 시 `redactCandidateAuditPii` 로 [redacted] 처리) |
| applicant_consent_confirmed_at | TEXT NULL | 채용기업이 "지원자가 AI 평가 적용에 동의했음"을 확인한 시각. PIPA §15·§26·§28의8·§37의2 책임을 고객사로 전가. 업로드/평가 라우트가 NOT NULL 검증 (2026-05-22 이전 row 는 legacy 면제) |
| applicant_consent_confirmed_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | 동의 확인을 클릭한 채용기업 사용자 |
| resume_file_path | TEXT NOT NULL | 로컬 파일명 또는 Blob URL. 폐기 시 빈 문자열 |
| resume_text | TEXT NOT NULL | **항상 빈 문자열** — 원본은 DB 에 저장 안 함 (PIPA). 컬럼은 호환성 위해 유지 |
| resume_masked_text | TEXT NULL | 마스킹된 텍스트. **LLM 에 전달되는 유일한 본문**. UI 미리보기도 이 값. 폐기 시 NULL |
| photo_file_path | TEXT NULL | 이력서에서 추출한 증명사진 경로(로컬 파일명 또는 Blob URL). **표시 전용** — `/api/uploads/candidate/[id]/photo` 로 서빙. **AI 평가 입력엔 절대 미포함**(편향 회피). DOCX(word/media)·PDF(JPEG/DCTDecode)에서 best-effort 추출, 없으면 NULL. 사진=PII → resume_file_path 와 동일 보유정책으로 폐기 |
| screening_score | INTEGER NULL | 0~100 |
| screening_report | JSON NULL | 평가 리포트 (`ScreeningResult` — `lib/screening.ts`). 6축 `breakdown`(각 축 score/reason/**confidence**) + `level_match`(연차 보정) + `focus_match`(HR 가이드 가감) + **`requirement_gate`**(JD 필수요건 미충족 시 종합점수 캡 — severity `hard`=40 결격/`soft`=84 학력 등 경력상쇄 가능) + **`requirement_coverage`**(JD 요건별 direct/indirect/none 매트릭스) + **`evidence_quality`**(specific/mixed/generic — 나열형 이력서 캡 60) + **`domain_fit`**(JD 전문 도메인 경험 none 시 캡 50) + `career_info` 등. 종합 점수는 LLM 출력이 아니라 **6축 가중평균 → spread(60기준 1.4배 확대) → 보너스/캡(confidence·focus·구체성·도메인·약한핵심축·필수요건) → 맨 마지막에 직급/연차 페널티(오버스펙 −5/언더스펙 −10, fit 으로 코드가 산출)** 으로 코드가 재계산 (`recomputeScore`). 페널티를 최후에 둬 만점·보너스에 가려지지 않게 함(오버스펙 종합 ≤95). 6축 가중치: tech_fit .20 / experience_depth .20 / role_match .25 / achievement .15 / stability .10 / growth_attitude .10 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

(과거 문서의 `status` 컬럼(uploaded/screening/…)은 실제 스키마에 없음 — 평가 진행 상태는 `screening_jobs` 큐와 `stage` 로 파악)

중복 체크: 코드는 `(job_id, resume_hash)` 로 검사 (업로더 무관) + **DB 부분 유니크 인덱스 `candidates_job_resume_hash_uq`** (`resume_hash` non-null) 가 동시 업로드 race 를 DB 레벨 차단. 2차로 워커가 `(job_id, resume_content_hash)` 비교 후 중복 자동 삭제.

## candidate_attachments

후보자별 첨부 파일 — 메인 이력서 외 경력기술서·포트폴리오·자기소개서 등.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| candidate_id | INTEGER NOT NULL FK candidates(id) ON DELETE CASCADE | |
| kind | TEXT NOT NULL DEFAULT 'other' | `resume`(메인 이력서 1개 — `candidates.resume_masked_text` 로 평가) / `career_history` / `portfolio` / `cover_letter` / `other`. SQLite text enum 은 타입 레벨만 — CHECK 제약 없어 값 추가에 마이그레이션 불필요 |
| file_path | TEXT NOT NULL | 로컬 파일명 또는 Blob URL |
| original_name | TEXT NOT NULL | 업로드 당시 파일명 |
| mime | TEXT NULL | |
| size_bytes | INTEGER NOT NULL DEFAULT 0 | |
| masked_text | TEXT NULL | 첨부 내용 마스킹 텍스트 — LLM 평가에 사용. 파싱 실패/이미지 등은 NULL |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(candidate_id)`.

텍스트 추출 가능한 첨부(career_history·cover_letter·일부 other)는 마스킹 후 서류평가 프롬프트에 함께 포함 (`lib/screening.ts`) — resume·career_history 가 1순위 상세검토, portfolio 는 낮은 비중. 이미지 등 추출 불가 파일은 사람 참고용. 합·불 결정 시 메인 이력서와 함께 즉시 폐기.

## user_candidate_favorites

후보자 즐겨찾기 — 사용자별 (같은 법인이라도 멤버마다 다름). 검토 우선 후보를 목록 상단 고정용.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | |
| candidate_id | INTEGER NOT NULL FK candidates(id) ON DELETE CASCADE | |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

PK 없음 — `(user_id, candidate_id)` UNIQUE 인덱스가 사실상 복합 키.

## user_job_favorites

⚠️ **Deprecated (2026-05)** — 공고 즐겨찾기 기능 제거됨. 공고 목록은 "내가 면접관인 공고" 우선 정렬로 대체. 데이터 보존을 위해 테이블은 유지하되 **더 이상 읽거나 쓰지 않음**.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | |
| job_id | INTEGER NOT NULL FK job_postings(id) ON DELETE CASCADE | |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

PK 없음 — `(user_id, job_id)` UNIQUE.

## screening_cache

서류평가 결과 캐시 — 동일 입력은 같은 점수 재사용 (재평가·중복 시 점수 흔들림 방지 + 토큰 절약).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| prompt_hash | TEXT NOT NULL UNIQUE | `SHA-256("v{SCREENING_SCORING_VERSION}" + "\n" + job_id + "\n" + 평가 프롬프트 전체)`. 채점 버전·공고 평가기준·이력서 내용·첨부가 모두 반영됨 |
| score | INTEGER NOT NULL | 캐시된 종합 점수 (디버깅용) |
| report | JSON NOT NULL | `recomputeScore` 까지 반영된 최종 `ScreeningResult` |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

`lib/screening.ts runScreeningOnce` 가 LLM 호출 전 조회 → hit 면 LLM 생략. miss 면 평가 후 저장. 공고 평가기준이 바뀌거나 **채점 로직 버전(`SCREENING_SCORING_VERSION`)이 +1 되면** prompt_hash 가 달라져 자동으로 새로 평가 (= 채점 산식을 고치면 옛 캐시가 무효화됨, [GOTCHAS.md](GOTCHAS.md) §0-6). 정리 cron 없음 — 무한 증가하지만 행당 작음.

## interview_sessions

기존과 동일. (org_id 비정규화 X — candidate 통해 조인)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id / candidate_id / access_token / status / messages / evaluation / started_at / completed_at / expires_at / created_at | … | |
| created_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | 링크를 발급한 운영자. 면접 완료 토큰 차감 시 ledger `created_by_user_id` 로 전달 — 누가 면접을 결정했는지 추적. (구 세션은 NULL) |
| personality_responses | TEXT(JSON) NULL | 인성검사(컬처핏 사전 문항) 원응답 `[{itemId, value}]`. NULL = 미실시 (법인 컬처핏 미설정 또는 도입 전 세션) |
| personality_profile | TEXT(JSON) NULL | 결정적 채점 결과 (`lib/personality.ts` `PersonalityProfile` — Big Five 0~100 + 신뢰 플래그). 합불 점수 합산에 미사용 — 면접 꼬리질문 앵커·리포트 참고용 |
| reminder24_sent_at / reminder48_sent_at | TEXT NULL | AI 면접 미응답 리마인더 발송 시각. 링크 발급(created_at) 후 **48h** 경과 + `pending`/`in_progress` + 미만료일 때 cron(KST 09~20시)이 후보자에게 **1회** 넛지 후 `reminder48_sent_at` 기록(중복 방지). `reminder24_sent_at` 은 과거 24h 넛지용 컬럼으로 현재 미사용(운영 데이터 보호상 컬럼만 유지) |

## interview_schedules

대면 면접(1차/2차) 스케쥴. 면접관이 가능한 시간 슬롯을 제시하고, 후보자가 메일 링크로 선택.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| candidate_id | INTEGER NOT NULL FK candidates(id) ON DELETE CASCADE | |
| job_id | INTEGER NOT NULL FK job_postings(id) ON DELETE CASCADE | |
| org_id | INTEGER NULL FK organizations(id) ON DELETE CASCADE | 비정규화 |
| round | TEXT NOT NULL DEFAULT 'round1' | `round1` / `round2` |
| access_token | TEXT UNIQUE NOT NULL | 후보자 응답 페이지 토큰 (비로그인) |
| proposed_slots | JSON NOT NULL | 면접관 제시 슬롯 `[{start, end}, ...]` (ISO) |
| mode_online | INTEGER NOT NULL DEFAULT 1 | boolean — 온라인/오프라인 |
| address / address_detail | TEXT NULL | 오프라인 면접 장소 |
| online_meeting_url | TEXT NULL | 온라인 미팅 링크 (Zoom·Meet·Teams 수동 붙여넣기 또는 Zoom 연동 자동 생성). 확정(`selected`) 후 등록 → 후보자에게 메일 + ICS 발송. mode_online=true 일 때만 사용 |
| online_meeting_note | TEXT NULL | 접속 안내 메모 |
| meeting_link_sent_at | TEXT NULL | 미팅 링크 메일 발송 시각 |
| meeting_link_sent_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| interviewer_reminder_sent_at | TEXT NULL | 면접관 리마인더 발송 시각 — 확정 면접 24시간 전 cron 이 1회 발송 후 기록 (중복 방지) |
| candidate_reminder_sent_at | TEXT NULL | 후보자 D-1 리마인더 발송 시각 — 면접관 리마인더와 독립 추적. 같은 cron 스캔에서 후보자에게 1회 발송 후 기록 (round1/round2 모두) |
| selected_slot | JSON NULL | 지원자가 선택한 슬롯 `{start, end}` |
| counter_slots | JSON NULL | 지원자가 역제시한 슬롯 후보 |
| candidate_note | TEXT NULL | 지원자 코멘트 (역제시·취소 사유 등) |
| status | TEXT NOT NULL DEFAULT 'pending' | 라이프사이클 아래 참조 |
| proposed_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | 슬롯을 제시한 면접관 |
| expires_at | TEXT NOT NULL | 응답 기한 |
| responded_at | TEXT NULL | |
| created_at / updated_at | TEXT NOT NULL | |

인덱스: `(candidate_id)`, `(job_id)`, `(status, expires_at)` — 만료·리마인더 cron 스캔용.

라이프사이클: `pending`(면접관 제시 → 후보자 응답 대기) → `selected`(시간 선택 완료 → 면접 확정) / `counter_proposed`(다른 시간 역제시 → 면접관 재제시 필요) / `withdrawn`(후보자 지원취소). 같은 후보자에 재제시하면 새 row 추가 + 이전 row 는 `cancelled` 마킹 (감사용 보존).

## interviewer_notes

사람 면접관 스코어카드·메모. **UI는 2026-06-21 자유 코멘트 채팅([candidate_comments](#candidate_comments))으로 대체** — 점수 4종 입력이 번거롭다는 피드백. 테이블·기존 데이터·API 라우트(`/api/candidates/[id]/notes*`)는 보존(읽기 가능).

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

(후보자별 면접관 배정 `interviewer_assignments` 는 공고 단위 `job_interviewers` 로 대체되어 2026-06-10 테이블째 제거 — migration 0015)

## candidate_comments

이력서별 면접관 토론 — 한 후보자를 두고 면접관들이 자유롭게 남기는 채팅형 코멘트. `interviewer_notes`(스코어카드 UI)를 대체. **점수 없음**. (migration 0043, 2026-06-21)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| candidate_id | INTEGER NOT NULL FK candidates(id) ON DELETE CASCADE | |
| author_user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | 본인만 삭제(수정 없음) |
| body | TEXT NOT NULL | 코멘트 본문 5000자 이내 |
| created_at | TEXT NOT NULL | |

같은 법인 멤버 누구나 작성·조회. 채팅 의미론이라 수정 없이 본인 코멘트만 삭제. 근사 실시간은 폴링(열림 3s·닫힘 10s). **안읽음 상태는 서버 [candidate_comment_reads](#candidate_comment_reads) 테이블에 기록** — 사용자×후보자 읽음선과 비교해 남의 새 글만 카운트, 기기 무관(2026-06-28 localStorage 방식에서 전환, migration 0051). 공고 후보자 목록 카드에도 안읽음 배지 노출.

## candidate_comment_reads

면접관 토론 코멘트 "읽음" 워터마크 — 사용자 × 후보자 단위. `last_read_comment_id` 보다 큰 "남의"(author != user) 코멘트가 그 사용자의 안읽은 글. 패널 열람 시 POST `/api/candidates/[id]/comments/read` 가 최신 코멘트 id 로 upsert. (migration 0051, 2026-06-28)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | |
| candidate_id | INTEGER NOT NULL FK candidates(id) ON DELETE CASCADE | |
| last_read_comment_id | INTEGER NOT NULL DEFAULT 0 | 이 사용자가 읽은 마지막 코멘트 id |
| updated_at | TEXT NOT NULL | $onUpdate |

`job_interviewers` 와 동일하게 명시적 PK 없이 `idx_comment_reads_pk` UNIQUE(user_id, candidate_id) 로 유니크 강제(upsert 충돌 타깃) + `idx_comment_reads_candidate`(candidate_id).

## job_interviewers

공고별 면접관. 한 공고에 여러 면접관 지정 — 면접관 배정은 **공고 단위로만** 관리 (후보자별 배정은 2026-06 제거).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| job_id | INTEGER NOT NULL FK job_postings(id) ON DELETE CASCADE | |
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | |
| assigned_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| assigned_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

PK 없음 — `(job_id, user_id)` UNIQUE.

자동 추가 시점: ① 공고 생성자 (생성 시) ② 초대 링크로 합류한 사용자 (`org_invites.job_id` 있으면 그 공고에) ③ PIN 알고 잠금 해제한 사용자 (UI "면접관 지정" 버튼으로 본인 직접 추가).

## audit_logs

민감 액션 추적 (시스템관리자 cross-org 접근 포함).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| actor_user_id | INTEGER NULL | null = 비로그인 (후보자/system) |
| actor_role | TEXT NULL | system_admin/org_admin/member/candidate/system |
| org_id | INTEGER NULL | 대상 법인 (필터링) |
| job_id | INTEGER NULL | 관련 공고 (0052, FK 없음 — 공고 삭제 후에도 보존). 공고 타임라인 조회 키 |
| action | TEXT NOT NULL | 예: 'candidate.delete', 'screen.bulk_trigger' |
| resource_type | TEXT NULL | candidate/user/org/interview_session/appeal |
| resource_id | INTEGER NULL | |
| ip / user_agent | TEXT NULL | |
| metadata | TEXT NULL (JSON) | 액션별 부가정보. `cross_org:true` 등 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(org_id, created_at DESC)`, `(actor_user_id, created_at DESC)`, `(job_id, created_at)`.

`lib/audit.ts` 의 `logAudit(req, entry)` 로 호출. fire-and-forget — 실패해도 본 흐름 영향 X. `jobId` 를 넘기면 공고 활동 타임라인(`GET /api/jobs/[id]/timeline`)에 노출 대상이 된다 — 채용 진행 이벤트에는 반드시 포함할 것 (0052 마이그레이션이 과거 행도 resource 기준으로 백필).

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

## notifications

사용자별 인앱 알림. 헤더 종 아이콘 + 드롭다운에서 표시.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | 수신자 |
| type | TEXT NOT NULL | `ai_interview_done`(내가 면접관인 공고의 AI 면접 평가 완료) / `round1_decision`(1차 면접 후 합·불 결정 대기) / `join_request`(신규 합류 요청 — org_admin) / `low_balance`(토큰 잔액 부족 — org_admin) / `new_org`(신규 법인 등록 — system_admin) / `candidate_appeal`(후보자 이의제기) / `schedule_confirmed` · `schedule_counter_proposed` · `schedule_withdrawn`(면접 일정 확정/역제시/지원취소) / `announcement`(공지) / `new_inquiry`(고객센터 접수 — system_admin) / `inquiry_replied`(문의 답변/완료 — 문의한 고객) |
| title | TEXT NOT NULL | |
| href | TEXT NOT NULL | 클릭 시 이동 경로 |
| payload | TEXT NULL | JSON 문자열 — 알림별 부가 정보 (candidate_id, job_id, org_id 등) |
| read_at | TEXT NULL | NULL=미읽음 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(user_id, read_at)` — 페이지 로드마다 사용자별 미읽음 조회.

## inquiries

고객센터 문의 / 서비스 불편사항 신고. 고객(법인)·후보자 양쪽 출처를 한 테이블에 통합.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| source | TEXT NOT NULL | `org_user`(로그인 고객) / `candidate`(비로그인 후보자) |
| category | TEXT NOT NULL | 분류 코드. 허용값·라벨은 `lib/inquiry.ts` |
| message | TEXT NOT NULL | 내용 (5~5000자) |
| contact_email | TEXT NOT NULL | 회신 이메일 (org_user=계정 / candidate=입력값) |
| org_id | INTEGER NULL | org_user=소속 법인 / candidate=세션의 채용 법인 |
| user_id | INTEGER NULL | org_user 제출자 |
| interview_session_id | INTEGER NULL | candidate 출처 세션 |
| candidate_id | INTEGER NULL | candidate 출처 후보자 |
| status | TEXT NOT NULL DEFAULT 'open' | open(접수)/in_progress(처리중)/resolved(완료) |
| admin_note | TEXT NULL | 운영팀 답변 — 고객의 "내 문의 내역"에 노출 |
| resolved_by_user_id | INTEGER NULL | 완료 처리한 관리자 |
| resolved_at | TEXT NULL | resolved 전환 시 세팅 (그 외 NULL) |
| ip / user_agent | TEXT NULL | |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(status, created_at)`, `(org_id, created_at)`.

- 후보자: 면접 화면/종료 화면 → `/interview/[token]/inquiry` (본인 이메일 매칭 불요 — 막힌 후보자 차단 방지).
- 고객: `/support` 폼 + 본인 문의 내역. 관리자: `/admin/inquiries` 인박스 — **system_admin 전용**(고객센터=운영자 데스크, org_admin 은 제출만). 페이지는 서버 컴포넌트에서 역할 가드 + redirect.
- 접수 시 (`notifyNewInquiry`, `lib/inquiry-notify.ts`): ① **시스템 관리자 인앱 알림**(`notifications.type='new_inquiry'`, SMTP 무관 항상) + ② **Slack 즉시 푸시**(SLACK_WEBHOOK_URL, 메타데이터만 — 본문·연락처는 PII 라 국외 리전 Slack 제외) + ③ 지원 이메일(`APPEAL_CONTACT`) 통지(수신자가 운영팀이므로 **시스템 기본 SMTP 고정**, `orgId:null` — 법인 SMTP 라우팅 시 법인 설정 오류로 누락). 모두 실패해도 제출 성공.
- 처리 시 (`notifyInquiryReply`, PATCH `/api/admin/inquiries/[id]`): **완료 전환 또는 운영팀 답변 작성/변경 시** ① 문의자가 로그인 고객(`user_id` 있음)이면 **인앱 알림**(`type='inquiry_replied'`, href `/support`) + ② `contact_email` 로 회신 메일 1회 발송 (운영팀 발신=시스템 기본 SMTP, `orgId:null`). 후보자(비로그인)는 메일이 처리 결과를 확인하는 유일한 채널. 단순 처리중 전환·답변 없는 재저장은 미발송.
- 통지 호출은 모두 라우트에서 next/server `after()` 로 — 응답 반환 후 실행 보장 (`void` fire-and-forget 은 서버리스 suspend 시 유실).

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

대면 면접 질문지 (1차 실무 / 2차 임원). **후보자당 라운드별 1건** (`(candidate_id, round)` UNIQUE — 재생성 시 덮어쓰기).

해당 라운드 면접 일정 확정(`interview_schedules` round 일치 · status='selected') 후 면접관 누구나 생성.
이력서(마스킹) + 서류평가(`screeningReport`) + AI 면접 평가(`interviewSessions.evaluation`, 있으면)
+ 법인 컬쳐핏 기준(`organizations.culture_fit_profile`, 있으면 — 두 라운드 공통)을
종합해 LLM(task=`questionGen`)이 생성. 1차는 `buildInterviewQuestionsPrompt`(직무·기술 검증 중심),
2차는 `buildExecutiveInterviewQuestionsPrompt`(임원 관점 — 선호 인재상·컬쳐핏·가치관 70~80% + 임원 시선 직무 질문 1섹션 20~30%. 기술 재검증 X).
**`interview_question_gen` 토큰 차감(기본 5, 라운드 구분 없이 동일 단가)** — 생성 성공 시 후차감,
재생성·라운드 추가 생성도 매번 과금(`chargeRepeatable`, refType `candidate`/`candidate_re{N}` — 회차는 라운드 합산). (과거 "무료" 서술은 stale)

**비동기(백그라운드) 생성** (2026-06-19): POST 가 `status`(`generating`/`ready`/`failed`)를 세팅하고 즉시 202 반환,
`after()` 가 백그라운드에서 LLM·저장·과금 수행 — MCQ 생성과 동일 패턴. 생성 중 새로고침/이탈해도 진행 유지(상태 DB 영속),
완료 시 클라이언트 폴링이 자동 반영. `status='ready'` 일 때만 `questions` 가 실제 질문지(생성 중엔 placeholder, UI 미노출).
`generating` 이 5분 넘으면(함수 중단 등) GET 이 `failed` 로 노출해 재생성 허용. `gen_error` 는 실패 사유(UI 표시용).
기존 행은 마이그레이션 0042 에서 default `'ready'` 로 백필(비파괴 ADD COLUMN).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| candidate_id | INTEGER NOT NULL FK candidates(id) ON DELETE CASCADE | `(candidate_id, round)` UNIQUE |
| round | TEXT NOT NULL DEFAULT 'round1' | `round1`(1차 실무) / `round2`(2차 임원) |
| job_id | INTEGER NOT NULL FK job_postings(id) ON DELETE CASCADE | |
| org_id | INTEGER NULL FK organizations(id) ON DELETE CASCADE | |
| based_on_screening | INTEGER NOT NULL DEFAULT 0 | 생성 시 서류평가 반영 여부 (boolean) |
| based_on_interview | INTEGER NOT NULL DEFAULT 0 | 생성 시 AI면접 평가 반영 여부 (boolean) |
| based_on_culture_fit | INTEGER NOT NULL DEFAULT 0 | 생성 시 법인 컬쳐핏 기준 반영 여부 (boolean) |
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
| auth_pass | TEXT NOT NULL | **AES-256-GCM 암호화 저장** (`lib/crypto.ts` `encrypt()`, `enc:v1:` prefix). 사용 시 `decrypt()`, 응답 시 마스킹. (과거 "평문 저장" 기재는 stale — 실제 코드는 암호화함) |
| from_email | TEXT NOT NULL | 발신 주소 |
| from_name | TEXT NULL | 발신자 표시명 |
| last_checked_at | TEXT NULL | 마지막 헬스체크 시각 |
| last_check_status | TEXT NULL | 'ok' / 'fail' |
| last_check_error | TEXT NULL | 실패 시 메시지 |
| updated_by_user_id | INTEGER NULL FK users(id) | |
| updated_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

저장 시 `nodemailer.transporter.verify()` 로 자동 헬스체크. 실패해도 저장은 진행 (상태만 fail 로 기록).

## org_zoom_configs

법인별 Zoom 연동 설정. 1:1. 온라인 면접 확정 시 줌 회의 자동 생성에 사용.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| org_id | INTEGER PK FK organizations(id) ON DELETE CASCADE | |
| account_id | TEXT NOT NULL | Zoom "Server-to-Server OAuth" 앱의 Account ID |
| client_id | TEXT NOT NULL | 〃 Client ID |
| client_secret | TEXT NOT NULL | 〃 Client Secret — **AES-256-GCM 암호화 저장** (`lib/crypto.ts`, `enc:v1:` prefix, `org_smtp_configs.auth_pass` 와 동일 패턴). 조회 시 마스킹 |
| last_checked_at | TEXT NULL | 마지막 헬스체크 시각 |
| last_check_status | TEXT NULL | 'ok' / 'fail' |
| last_check_error | TEXT NULL | 실패 시 메시지 |
| updated_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| updated_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

법인이 줌 마켓플레이스에서 직접 생성한 Server-to-Server OAuth 앱 자격증명 3개를 등록. 1차 면접이 온라인으로 확정되면 `lib/zoom.ts` 가 토큰 발급 → 회의 생성 → join_url 을 `interview_schedules.online_meeting_url` 에 저장 + 메일 발송. 설정 가이드: docs/ZOOM_SETUP_GUIDE.md (인앱: `/org/zoom/guide`).

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
| reason | TEXT NOT NULL | `charge` / `job_post` / `resume_upload` / `interview` / `interview_question_gen` / `job_extend` / `refund` / `admin_adjust` |
| ref_type | TEXT NULL | 차감/환불 대상 종류. 예: `job`, `screening_job`, `interview_session`, `candidate`. 재평가/재생성은 회차 suffix `_re{N}` 부여 |
| ref_id | INTEGER NULL | 대상 id |
| balance_after | INTEGER NOT NULL | 기록 직후 잔액 |
| created_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| memo | TEXT NULL | |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

중복 방지 규칙: `chargeFeature`/`refundFeature`/`grantWelcomeBonus`/`applyChargePayment` 는 `(org_id, reason, ref_type, ref_id)` 멱등. 코드 fast-path(SELECT) + **DB 부분 유니크 인덱스 `token_ledger_idem_uq`** (`ref_type` non-null & ≠ `'manual_refund'`) 로 동시 중복 요청의 이중 차감/적립까지 DB 레벨 차단 (`writeLedgerIdempotent`). 반복 허용 항목(`admin_adjust` ref_type=null, `manual_refund`)은 부분 인덱스 예외.

## token_pricing

기능별 단가. system_admin만 수정.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| feature_key | TEXT PK | `job_post` / `resume_upload` / `interview` / `interview_question_gen` (DEFAULT_PRICING 폴백 5 — 시드에 행 없을 수 있음) |
| cost | INTEGER NOT NULL | 0 이상 |
| updated_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| updated_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

변경 시 **소급 X** — chargeFeature 호출 시점의 pricing 으로 차감.

## marketing_recipients

마케팅 브로셔 메일 수신자. system_admin 전용 — 테넌트(org) 무관 시스템 전역.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| email | TEXT NOT NULL UNIQUE | 소문자 정규화 후 저장 |
| unsubscribe_token | TEXT NOT NULL UNIQUE | 수신거부 페이지 토큰 (`/unsubscribe/[token]`, 비로그인) |
| status | TEXT NOT NULL DEFAULT 'active' | active / unsubscribed |
| last_sent_at | TEXT NULL | 마지막 발송 시각 (ISO) |
| unsubscribed_at | TEXT NULL | 수신거부 시각 (ISO) |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

unsubscribed 행은 발송 대상에서 제외되며 삭제하지 않고 보존 (재등록 방지 + 처리 증빙).

## payment_orders

결제 시스템 스텁. PR-6 시점에는 row 생성 흐름 없음.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id / org_id / amount_krw / tokens / status / provider / provider_ref / created_by_user_id / created_at | … | status: pending/paid/failed/cancelled |

## coupon_groups

시스템 관리자가 1회 발급하는 프로모션 단위. 같은 그룹의 코드는 동일한 `token_amount`·유효기간 공유.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| name | TEXT NOT NULL | 그룹 이름 |
| token_amount | INTEGER NOT NULL | 코드 1개 등록 시 지급 토큰 |
| valid_from / valid_until | TEXT NULL | 등록(redeem) 가능 기간 `YYYY-MM-DD`(KST, 양끝 포함) / null=무제한. **받은 토큰의 만료가 아니라 "등록 마감"** |
| status | TEXT NOT NULL DEFAULT `active` | `active` / `disabled`. disabled = 미등록 코드 신규 등록만 차단(이미 지급분 불변) |
| created_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## coupons

개별 쿠폰 코드. `code` 는 4-4-4-4 16자리 숫자를 **대시 없이** 저장(정규화). 등록 시 `lib/coupons.redeemCoupon` 이 단일 트랜잭션에서 조건부 `status='used'` + 토큰 지급(원장 `admin_adjust`/`ref_type='coupon'`/`ref_id=coupon.id`)을 원자 처리.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| group_id | INTEGER NOT NULL FK coupon_groups(id) ON DELETE CASCADE | |
| code | TEXT NOT NULL | 16자리 숫자(대시 제거). UNIQUE |
| status | TEXT NOT NULL DEFAULT `unused` | `unused` / `used` / `revoked` |
| redeemed_by_org_id | INTEGER NULL FK organizations(id) ON DELETE SET NULL | |
| redeemed_by_user_id | INTEGER NULL FK users(id) ON DELETE SET NULL | |
| redeemed_at | TEXT NULL | |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `coupon_code_uq`(code UNIQUE) · **`coupon_group_org_uq`(group_id, redeemed_by_org_id) WHERE redeemed_by_org_id is not null** = "한 법인은 한 그룹에서 1개만" DB 강제(동시 등록 race 최종 방어선) · `idx_coupon_group_status`(group_id, status) 집계용. 토큰 지급 멱등은 `token_ledger_idem_uq`(ref_type='coupon')가 백스톱. **쿠폰 테이블은 글로벌 시스템 자원 — `org_id` 테넌트 필터 대상 아님**(등록 기록만 org 범위). 운영 데이터 보호상 그룹·코드는 hard-delete 하지 않고 `disable` 만.

## recorded_interviews

대면(오프라인) 면접 녹음 → AI 평가. AI 채팅 면접(`interview_sessions`)과 별개 — 사람이 진행한 면접을 전사·평가. 업로드 + 준실시간 투트랙. 상세: [LIVE_INTERVIEW_PLAN.md](LIVE_INTERVIEW_PLAN.md).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| org_id | INTEGER NULL FK organizations ON DELETE CASCADE | 테넌트 |
| job_id | INTEGER NOT NULL FK job_postings ON DELETE CASCADE | |
| candidate_id | INTEGER NOT NULL FK candidates ON DELETE CASCADE | |
| round | TEXT NOT NULL DEFAULT 'round1' | round1 / round2 (대면 차수) |
| mode | TEXT NOT NULL DEFAULT 'upload' | upload(사후 파일) / live(준실시간 청크) |
| status | TEXT NOT NULL DEFAULT 'processing' | recording / **queued**(업로드 완료·워커 대기) / processing / ready / failed / confirmed |
| created_by_user_id | INTEGER NULL FK users ON DELETE SET NULL | 진행한 면접관(서기) |
| consent_confirmed_at | TEXT NULL | 면접관이 "지원자 녹취·전사·AI평가 동의 받음" 확인 시각 (PIPA attestation) |
| consent_confirmed_by_user_id | INTEGER NULL FK users ON DELETE SET NULL | |
| duration_seconds | INTEGER NOT NULL DEFAULT 0 | 녹음 길이 (업로드 모드는 전사 후 워커가 설정) |
| audio_blob_key | TEXT NULL | **업로드 모드 백그라운드 처리용** — 워커가 전사할 때까지만 임시 보관하는 오디오 위치(Blob URL/로컬 파일명). 전사 직후 `deleteFile`+null (마이그레이션 0034) |
| audio_mime | TEXT NULL | 업로드 원본 MIME — 워커가 Gemini inlineData 에 사용 (0034) |
| attempts | INTEGER NOT NULL DEFAULT 0 | 백그라운드 워커 재시도 횟수 (상한 3, stuck 판정용) (0034) |
| report | TEXT(JSON) NULL | `RecordedInterviewReport` — 점수·근거(evidence_seq)·확인필요·추천질문 |
| report_confirmed_at | TEXT NULL | AI 초안 → 사람 확정 시각 |
| report_confirmed_by_user_id | INTEGER NULL FK users ON DELETE SET NULL | |
| error | TEXT NULL | failed 진단 |
| started_at / completed_at | TEXT NULL | 처리 시작/완료 |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## interview_transcript_segments

대면 면접 전사 세그먼트(발화 단위). recorded_interview 1건에 다수. 음성 발화 = PII → +N일(`purge-original`)에 세그먼트 폐기, 리포트는 보존. 라이브는 청크가 전사될 때마다 누적 insert(텍스트만 — 오디오 미보관).

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| recorded_interview_id | INTEGER NOT NULL FK recorded_interviews ON DELETE CASCADE | |
| seq | INTEGER NOT NULL | 정렬 + 리포트 evidence_seq 참조 키 |
| speaker_label | TEXT NULL | 음향 분리 라벨. 라이브는 `청크번호#화자` 로 고유화 |
| role | TEXT NULL | candidate / interviewer / unknown — 종료 시 내용 기반 배정 |
| start_ms / end_ms | INTEGER NULL | 시각(ms) |
| text | TEXT NOT NULL | 발화 |
| low_confidence | INTEGER NOT NULL DEFAULT 0 | 저신뢰 전사(boolean) |
| created_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

## daily_digest_logs

면접관 일일 할 일 요약 메일(daily digest) 발송 기록 — 멱등용. 매일 KST 09:00 cron(`/api/cron/daily-digest`)이 면접관(`job_interviewers` 배정 active 계정)별로 본인 배정 공고의 '오늘 할 일'을 요약해 1통 발송한 뒤 `(user_id, digest_date)` 를 기록한다. 같은 날 중복 실행(수동 재호출·동시 실행)은 기록된 면접관을 건너뛴다. 순수 추가(additive) 테이블.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | INTEGER PK auto | |
| user_id | INTEGER NOT NULL FK users(id) ON DELETE CASCADE | 면접관 |
| digest_date | TEXT NOT NULL | `YYYY-MM-DD`(KST). 발송 기준일 |
| sent_at | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | |

인덱스: `(user_id, digest_date)` UNIQUE — 하루 1통 보장 + 동시 실행 race 의 최종 방어선.

## TypeScript 타입

`lib/schema.ts` 하단 export. `Organization`, `User`, `JobPosting`, `Candidate`, `InterviewSession`, `OrgJoinRequest`, `TokenWallet`, `TokenLedger`, `TokenPricing`, `PaymentOrder`, `UserRole`, `TokenReason` 등.

## 관계 다이어그램

```
organizations ─< users (org_id, role)
      │
      ├─< org_join_requests ─> users (user_id)
      ├─< org_invites (job_id ─> 공유한 공고)
      ├─< org_smtp_configs / org_zoom_configs (각 1:1)
      ├─< token_wallets (1:1)
      ├─< token_ledger
      ├─< payment_orders
      ├─< job_postings ─< candidates ─< interview_sessions
      │        │             ├─< candidate_attachments
      │        │             ├─< interview_schedules (job_id·org_id 비정규화)
      │        │             ├─< interview_question_sheets (후보자당 라운드별 1건)
      │        │             ├─< interviewer_notes
      │        │             ├─< candidate_comments
      │        │             └─< candidate_comment_reads >─ users (읽음 워터마크)
      │        └─< job_interviewers >─ users
      └─< (위 모든 자식 CASCADE)

users ─< sessions · password_resets · email_verifications · notifications
      └─< user_candidate_favorites · user_job_favorites (deprecated)

coupon_groups ─< coupons  (글로벌 시스템 자원 — organizations 아래 아님)
              coupons.redeemed_by_org_id >─ organizations (SET NULL, CASCADE 아님)
```

## 마이그레이션 스크립트

현재 마이그레이션은 drizzle-kit(`drizzle/NNNN_*.sql`) + `scripts/db-migrate.ts` 단일 체계.
pre-drizzle 시절의 수동 raw-ALTER 스크립트(단일테넌트→멀티테넌트 이관 등)는 `scripts/_legacy/`
에 있었으나 실행 불가(폴더 이동 시 `_load-env.mjs` 경로가 깨져 `ERR_MODULE_NOT_FOUND`)이고
`ALLOW_DESTRUCTIVE_MIGRATION` 가드 없는 destructive DDL 이라 2026-07-03 제거했다. 단일테넌트
이관은 이미 완료된 1회성 작업이고, 스크립트 이력은 git history 에 보존된다.
- 단가 시드 (`job_post=10`, `resume_upload=5`, `interview=30`)

테스트 시드: `scripts/seed-test.mjs` — `test-company-a` / `test-company-b` 2법인 + 4역할 사용자.

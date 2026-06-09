# Architecture

## 한눈에 보는 흐름

```
HR (로그인)
  │
  ├─ 공고 등록 → DB(jobPostings, 선택적 4자리 PIN)
  │
  ├─ 이력서 PDF 업로드
  │     ├─ SHA-256 해시 → 중복 체크
  │     ├─ Buffer로 pdf-parse → 텍스트 추출
  │     ├─ storage.saveFile() → 로컬 디스크 또는 Vercel Blob
  │     ├─ DB(candidates) 인서트, status=screening
  │     └─ fire-and-forget: LLM 서류 평가 → DB 업데이트
  │           (개인정보 phone/age/career도 추출해서 컬럼에 저장)
  │
  ├─ 후보자 상세 → "면접 링크 생성" → DB(interviewSessions) + UUID 토큰
  │     │
  │     └─ "📧 발송" → nodemailer + Gmail SMTP → 후보자 이메일로 링크 발송
  │
  └─ 면접 종료 후 후보자 상세에서 평가/대화록 확인

후보자 (외부 — 인증 없음, 토큰만)
  └─ /interview/[token]
        ├─ GET /api/interview/[token] → 세션 정보 로드
        ├─ "면접을 시작해주세요" → POST /api/interview/[token]/chat (스트리밍)
        │     - 매 턴마다 시스템 프롬프트(JD+이력서) 주입
        │     - Gemini 2.5 Flash-Lite, 스트리밍, DB에 메시지 누적 저장
        │     - AI가 [INTERVIEW_END] 출력 시 자동 종료 트리거
        ├─ "면접 종료" 버튼 또는 [INTERVIEW_END] → POST /complete
        │     - 평가 LLM 호출 → JSON 평가 → DB 저장
        │     - 후보자에게는 평가 미노출, "감사합니다" 메시지만
        └─ 평가는 HR이 후보자 상세에서만 확인
```

## 폴더 구조

```
interviewer/
├── app/
│   ├── page.tsx                    # 대시보드 (server) — 첫 실행 가이드 / KPI / 공고 목록
│   ├── jobs-list.tsx               # 대시보드 클라이언트 컴포넌트 (PIN 모달)
│   ├── layout.tsx                  # 루트 레이아웃 (server) — 네비바
│   ├── logout-button.tsx           # 클라이언트 컴포넌트
│   ├── login/page.tsx              # 로그인 + 첫 setup 자동 전환
│   ├── signup/page.tsx
│   ├── account/page.tsx            # 비밀번호 변경
│   ├── jobs/
│   │   ├── new/page.tsx            # 공고 등록
│   │   └── [id]/
│   │       ├── page.tsx            # 공고 상세 (이력서 업로드 + 후보자 리스트)
│   │       └── edit/page.tsx       # 공고 수정
│   ├── candidates/[id]/page.tsx    # 후보자 상세 (서류평가 + 면접 + 결과)
│   ├── interview/[token]/page.tsx  # 면접 채팅 (외부 토큰 기반)
│   └── api/
│       ├── auth/                   # login/logout/signup/setup/status/change-password
│       ├── jobs/                   # 공고 CRUD + unlock + candidates
│       ├── candidates/[id]/        # 상세/삭제/면접링크 발급
│       ├── interview/[token]/      # chat (스트리밍) / complete (평가 생성)
│       ├── interview-sessions/[id]/send-email/   # 이메일 발송
│       └── uploads/[file]/         # 로컬 모드 파일 서빙 (Blob URL은 직접 사용)
├── lib/
│   ├── db.ts                       # libSQL 클라이언트 (로컬/Turso 자동 분기)
│   ├── schema.ts                   # Drizzle 테이블 정의
│   ├── auth.ts                     # bcrypt + 쿠키 세션
│   ├── job-lock.ts                 # 공고 PIN 잠금 해제 쿠키 (관리자 우회)
│   ├── storage.ts                  # 로컬 디스크 / Vercel Blob 자동 분기
│   ├── parsers.ts                  # PDF/TXT/HTML → 텍스트 (buffer 기반)
│   ├── prompts.ts                  # 면접관 시스템 프롬프트 + 평가 프롬프트
│   ├── gemini.ts                   # Gemini API 래퍼 (스트리밍 + JSON 모드)
│   ├── mailer.ts                   # nodemailer + 메일 HTML 템플릿
│   ├── utils.ts                    # 토큰/날짜/점수 헬퍼
│   └── pdf-parse.d.ts              # pdf-parse 서브경로 타입 선언
├── proxy.ts                        # Next.js 16 미들웨어 (인증 가드)
├── drizzle.config.ts               # 로컬/Turso 자동 분기
├── DEPLOY.md
├── AGENTS.md                       # Next.js 16 경고 (CLAUDE.md가 import)
├── CLAUDE.md                       # 이 폴더 메모 (루트 CLAUDE.md import)
└── docs/                           # 이 문서들
```

## 주요 설계 결정

### 1. 멀티테넌트 (법인 = Organization)
- 모든 핵심 리소스(jobs, candidates)는 `org_id` 보유. system_admin 외엔 다른 법인 리소스에 접근 불가 (404 위장).
- 역할: `system_admin` / `org_admin` / `member`. system_admin은 PIN 가드도 우회.
- 가드 헬퍼: `lib/tenant.ts` — `jobOrgFilter`, `candidateOrgFilter`, `ownsOrg`, `requireUser`.
- 공고별 4자리 PIN은 **법인 격리 이후의 2차 가드** (같은 법인 내에서도 PIN 모르면 상세 X).

### 2. 인증
- bcryptjs + DB 세션 (별도 sessions 테이블, 14일 만료)
- httpOnly + sameSite=lax 쿠키
- `proxy.ts`는 쿠키 존재만 체크 (Edge runtime이라 DB 못 씀)
- 실제 검증은 페이지/API의 `getCurrentUser()`에서 (Node runtime)
- `/login`, `/signup`, `/interview/*`, `/api/auth/*`, `/api/interview/*`, `/api/uploads/*`는 인증 면제

### 3. 면접 토큰
- 후보자는 인증 없이 `/interview/[token]`만 알면 면접 가능
- 토큰 UUID 32바이트, 기본 3일 만료
- 토큰 자체가 인증 역할 — 별도 비밀번호 X

### 4. AI 호출
- Paid tier. 모든 task 통합 (`lib/gemini.ts` `MODELS`):
  - 서류 평가·AI 면접 채팅·면접 평가 모두 → `gemini-2.5-flash` · **Vertex AI 서울 (asia-northeast3)** · AI 단계 §28의8 회피
- SDK 단일: `@google/genai` (vertexai: true 고정)
- 면접 = 스트리밍 (`startChat` + `sendMessageStream`)
- 평가 = JSON 모드 (`responseMimeType: application/json`, temperature=0.2)
- 시스템 프롬프트에 직무+이력서 전부 주입 (벡터 검색 X — 프로토타입은 컨텍스트로 충분)
- Vertex AI 서울 응답 시간: 13K char 프롬프트 기준 30~40초. screening 은 비동기 큐라 UX 영향 X.

### 5. 면접 종료 트리거
- 사용자가 "면접 종료" 버튼 클릭 → finalize
- AI가 응답에 `[INTERVIEW_END]` 토큰 포함 → 자동 finalize
- finalize = `/complete` 호출 → 평가 생성 + DB 저장 → 상태 `completed`
- 후보자 UI는 평가 결과 미노출 (감사 메시지만)

### 6. 이력서 중복 방지 (2단계)
1. **업로드 시 (동기, 파일 바이트 해시)** — `resume_hash` = 파일 buffer SHA-256.
   - 코드는 `(job_id, resume_hash)` 만 검사 (업로더 무관). 같으면 업로드 거부.
   - **바이트가 1비트라도 다르면 통과** — 재저장·재export·다른 ZIP 으로 올린 동일 이력서는 못 잡음.
2. **파싱 후 (워커, 내용 해시)** — `resume_content_hash` = 파싱된 본문 정규화 SHA-256 (`lib/screening.ts contentHashOf`).
   - 같은 공고에 동일 내용이 *더 먼저*(작은 id) 있으면 이 후보자는 중복 → **평가 없이 자동 삭제** (과금도 안 됨).
   - 바이트가 달라도 본문이 같으면 잡힘. 원본(작은 id) 보존.
- 같은 이력서를 다른 공고에 올리는 건 허용 (둘 다 job_id 로 스코프).
- ⚠️ 동시 같은-배치 업로드 reorder 시 드물게 둘 다 생존 가능 (순차 업로드는 안전).

### 7. 점수 산정
- 서류 평가: `screeningReport.score` (0~100)
- 면접 평가: `evaluation.overall_score` (0~100)
- 종합: `screening * 0.4 + interview * 0.6` (한쪽 없으면 있는 쪽 그대로)
- 등급: 85+ 강력추천 / 70+ 추천 / 50+ 보류 / 미만 비추천

### 8. 회원가입 / 합류 흐름
- **회사(법인) 도메인 이메일만 가입 가능** — gmail/naver/임시메일 등 공용 도메인(`PUBLIC_EMAIL_DOMAINS`, `lib/email-domain.ts`)은 차단. `check-email` 은 공용 도메인에 `{available:false, reason:"public_email"}` 반환, `POST /api/orgs` 도 서버 측 400 차단. **공용메일 선점으로 인한 도메인 매핑 사각지대·법인 사칭을 원천 제거** (결정: 소기업/공용메일 타겟 제외).
- **가입 시 사업자번호 불요** — 도메인 메일함 통제(이메일 인증)가 곧 소속 증명. 세금계산서·정산에 필요하면 **법인 설정(`/org/settings`)에서 추후 입력** (`PUT /api/orgs/me/biz`, org_admin, 타 법인 중복 번호 차단).
- `/signup` 페이지 = 상태머신: 이메일 중복확인 → 도메인 매칭(`organizations.email_domain`) / 멀티 매칭 / 검색 / 신규등록 분기.
- **같은 도메인 1:N 허용** — (드문) 도메인 공유 케이스 대응. 매칭 결과가 2개 이상이면 사용자가 검증상태·담당자 정보를 보고 합류할 법인을 선택. `/api/auth/check-email` 응답의 `matchedOrgs` 배열.
- 법인 검증 상태: `dart_matched`(자동, 상장·외감), `verified`(도메인 이메일 인증 기반 **자동 검증** 또는 운영자 수동), `pending_review`(레거시·운영자 생성용 — **신규 가입 경로에선 더 이상 생성 안 됨**), `rejected`(사칭 판정). 검토 대기·거절 상태 법인은 합류 요청 차단.
- **신규 법인 = 즉시 `verified`** (DART 매칭 시 `dart_matched`) → 같은 도메인 동료가 운영자 검토 없이 바로 합류 요청 가능.
- 운영자 도구: `/admin/orgs` 에서 사후 도메인 매핑 해제·법인 거절 (감사 로그 + step-up 인증).
- 신규 법인 등록: `POST /api/orgs` — 트랜잭션(법인+사용자+wallet). **세션은 발급하지 않음** — 이메일 인증 후 로그인.
- 기존 법인 합류: `POST /api/orgs/join-requests` — user.status=`pending`, 세션 발급 X. org_admin이 `PATCH /api/orgs/join-requests/[id]` 로 승인하면 `active`.
  - **공고 공유 → 신규 합류는 승인 필수 (2026-06-08)**: 공유는 일반 멤버도 할 수 있으므로, 초대 링크로 들어온 신규 가입자도 법인담당자 승인을 거친다. 경로:
    - 미가입자 초대 가입(`signup-via-invite`): `users.status=pending` + `orgJoinRequests` 생성, **세션·면접관 등록 X**. 초대 링크 클릭=메일함 증명이라 `email_verified_at` 만 즉시 세팅. 초대 토큰은 consume 하지 않음.
      - **재방문 가드 (2026-06-10)**: 토큰은 승인 시점에야 consume 되므로 가입~승인 구간엔 링크가 살아 있다. 이때 비로그인 재방문이면 가입 폼을 또 보여주지 않고 "이미 가입됨" 안내를 띄운다. `GET /api/invites/[token]` 이 초대 이메일로 가입한 계정 유무·status 를 `account` 필드로 반환하고, `/invite/[token]` 랜딩이 분기(pending=승인 대기 / active=로그인 후 합류 / disabled=문의). 자기 이메일 가입 여부 노출이라 위험 없음(토큰 소유자=초대받은 본인).
    - 무소속 로그인 사용자 수락(`invites/[token]/accept`): 마찬가지로 `pending` + 합류 요청 생성 + **현재 세션 만료**(pending 사용자가 로그인 상태로 남으면 인증 게이트 우회). 같은 법인 멤버는 예외 — 즉시 그 공고 면접관 등록 후 공고로 이동.
    - **active 전환 시 공유 초대 honor** (헬퍼 `lib/invites.ts` `honorJobShareInvites(userId, orgId)`): 그 사용자 이메일로 발급된 미사용 `orgInvites`(jobId 보유)를 조회해 `jobInterviewers` 에 자동 등록(멱등) + 초대 consume. 만료는 무시(활성화 자체가 본인확인이고, 초대 만료는 '링크 자가가입' 보안용이지 공유 의사의 만료가 아님). **사용자가 그 법인의 active 멤버가 되는 모든 경로에서 호출** — 활성화 경로가 갈라져도 면접관 등록이 누락되지 않도록:
      - 합류요청 승인 `PATCH /api/orgs/join-requests/[id]` (action=approve)
      - 멤버 상태 변경 `PATCH /api/users/[id]` 에서 status 가 active 로 전환(거절 후 토글 재활성화·대리 이메일 인증 활성화 포함)
      - `/signup` 도메인 매칭 가입 → 합류요청 승인 경로로 흡수
      - ⚠️ **회귀 주의 (2026-06-09)**: 예전엔 honor 가 승인 핸들러에만 있어, org_admin 이 합류요청을 거절했다가 멤버 목록에서 상태 토글로 다시 active 시키면(`user.status_change`) 면접관 등록이 누락됐다. 새 active 전환 경로를 추가하면 이 헬퍼 호출을 반드시 같이 챙길 것.
- **이메일 인증 (필수)**:
  - 두 경로 모두 가입 직후 `lib/email-verify.ts` 의 `sendVerificationMail()` 호출 → `email_verifications` row + 3일 만료 토큰 + 메일 발송.
  - 사용자가 `/verify?token=...` 클릭 → `POST /api/auth/verify-email` → `users.email_verified_at` 세팅.
  - 로그인 시 `email_verified_at` 이 NULL 이면 403 + `{code:"email_unverified"}` 응답. 로그인 페이지 UI 에서 "인증 메일 재발송" 버튼 노출.
- 로그인 시 `pending`/`disabled` → 403.

### 9. 토큰 / 결제
- 법인별 지갑 (`token_wallets`) + 변동 감사 로그 (`token_ledger`). 단가는 `token_pricing` (system_admin 수정).
- 차감 시점: 공고 생성은 **선차감**. **서류 평가·AI 면접은 후차감** — 서류는 워커가 평가 성공 시 `chargeScreeningSuccess`(refType=`screening_job`), AI 면접은 `complete`/`reevaluate` 에서 평가 성공 시 `chargeFeature(interview, interview_session)` 1건(멱등 refId=session.id). 동의·시작·링크 발급 시점엔 과금 X. 오류/재시도/면접 미응답/미시작 만료는 과금 안 됨 → 환불 불필요. **재평가/재생성은 성공할 때마다 매번 과금** — 서류는 새 `screening_jobs.id`, AI 면접·면접 문제 생성은 `chargeRepeatable`(`lib/tokens.ts`)이 기존 차감 횟수를 세어 회차별 refType(`{base}` / `{base}_re{N}`)으로 분리. 같은 회차 동시 따닥은 `token_ledger_idem_uq` 멱등.
- 환불: 공고 5분 내 삭제 시 자동 (`refundFeature`). (서류 평가·AI 면접은 후차감이라 환불 대상 아님.)
- **마이너스 허용 (후불 정책)** — 잔액 0 이하여도 기능은 계속 동작, `/org/tokens` 에 경고 배너만.
- 단가 변경은 **호출 시점 기준** 적용 (소급 X).
- 결제 시스템은 미연동. `payment_orders` 테이블만 스텁. system_admin이 `/admin/orgs` 에서 수동 충전.
- **만료 정리 cron**: `/api/cron/expire-interviews` 가 시간당(`0 * * * *`) 호출 — `expires_at < now` 세션을 `expired` 처리. `pending`(AI 미시작) 만료는 자동 불합격(`ai_link_expired`). **면접은 후차감이라 만료 환불 없음**(미시작/미평가는 과금된 적 없음). Vercel Cron + `CRON_SECRET` 헤더 인증.

### 11. 이력서 평가 흐름 — 마스킹 + 사용자 확인 게이트 + 자동 폐기

```
[1] 업로드 (POST /api/jobs/[id]/candidates)
    ├─ 파일 저장
    ├─ 텍스트 추출 (lib/parsers.ts)
    ├─ PII 사전 추출 (lib/pii-extract.ts)
    │   → name (라벨 또는 폼 입력), phone, email, age (라벨 또는 DOB→만나이)
    │   → candidates.{name, phone, email, age} 컬럼에 직접 저장
    ├─ 마스킹 적용 (lib/mask.ts)
    │   → 추출된 PII 를 known 으로 넘겨 strict literal 치환까지 보강
    │   → 정규식: RRN, 전화, 이메일, URL, DOB, 우편번호, 도로명/지번 주소
    │   → 라벨: 한·영·중 이름/주소/연락처/이메일/생년월일
    │   → 사전: 한국 대학(~250) + 해외 대학(~100) + 행정구역(~200)
    └─ DB insert (resume_text='' 영구 미보관, resume_masked_text=마스킹본, status='uploaded')
       ※ 원본 텍스트는 DB 에 저장하지 않음 — LLM·UI 모두 마스킹본만 사용.
         (원본 파일은 storage 에 남아있어 사용자 검수용 다운로드 가능, +30일 폐기)

[2] 사용자 확인 대기
    └─ candidate 상세 페이지: 마스킹된 텍스트 미리보기 (디폴트)
       + "원본 표시" 토글 (체크 시 빨간 박스로 강조 — 개인정보 노출 경고)

[3] 사용자 "검토 진행"/"재평가" 클릭 (POST /api/candidates/[id]/screen)
    ├─ screening_jobs 큐에 enqueue (차감 없음 — 과금은 성공 시점에)
    ├─ 이미 평가된 후보도 허용(재평가). 진행 중(queued/processing)만 중복 차단.
    └─ /api/internal/process-screenings 즉시 트리거 (fire-and-forget)

[3-bulk] 사용자 N명 일괄 평가/재평가 (POST /api/candidates/bulk-screen)
    └─ N개 enqueue (차감 없음) + 워커 1회 트리거 (이후 self-chain). 동의 확인된 후보면 평가 완료 여부 무관 대상.

[4] 워커 (lib/screening-queue.ts + /api/internal/process-screenings)
    ├─ cleanupStuck() + reconcileBalanceHolds() — 실행 시작마다.
    │    reconcile: 잔액 0 이하 법인 queued→paused(활성 큐 분리), 충전된 법인 paused→queued(자동 재개).
    │    → 잔액 소진 법인이 타 법인 큐에 영향 없음. cron 매분 실행이라 충전 후 ~1분 내 재개.
    ├─ atomicClaimNext() — queued 중 점유. **법인별 공정 분배**: 슬롯(max)을 활성 법인 수로
    │    나눠 cap = ceil(max/활성법인수). 한 법인의 대량 업로드가 타 법인을 굶기지 않음.
    │    (전역 cap + 법인 cap 을 claim UPDATE 서브쿼리로 원자 보장)
    ├─ runScreeningOnce() — ensureParsed(파싱+마스킹, 미파싱이면) → LLM 평가 → candidates 업데이트
    ├─ 성공: markDone(status='done') + chargeScreeningSuccess(후차감, job 단위 멱등), candidate.status='screened'
    ├─ transient 실패 (429/timeout/503/저장소): attempts++ + backoff (30s/2m/5m) 재큐 (과금 없음)
    ├─ permanent 실패 (파싱 실패/스캔 PDF/JSON 파싱 실패): 즉시 final fail (과금 전이라 환불 불필요)
    └─ 동시성 8 (env 조절). 1 회 호출당 최대 40건 처리, 잔여시 self-chain(처리 0 건이면 생략).

[4-cron] 매분 /api/cron/process-screenings (Vercel Cron)
    ├─ stuck (lockedAt < now-5min, status=processing) 복구 → queued
    └─ 워커 재호출 — self-chain 이 끊겼을 때 안전망

[4] 평가 완료 (status='screened')
    ├─ screening_report / score / 추천 DB 보관
    └─ careerYears / careerSummary 컬럼에도 추가 반영

[5] N일 경과 (PURGE_AFTER_DAYS=30, 매일 03:30 cron)
    ├─ resume_text, resume_masked_text, resume_file_path 모두 폐기
    └─ 평가 결과는 보존 (가명처리 원칙)
```

**LLM 에는 절대 원본 텍스트가 전달되지 않음** — `screenCandidate(id, job, textForLLM)` 의 `textForLLM` 은 `resume_masked_text` 만. 원본은 사용자가 UI에서 마스킹 품질 검수용으로만 열람 가능.

**직접 식별자(name/phone/email/age)는 LLM 이 추출하지 않음** — `lib/pii-extract.ts` 가 업로드 시점에 정규식·라벨·DOB→만나이 계산으로 직접 추출 후 candidates 테이블에 저장. LLM 은 `career_years` / `career_summary` (요약·추론 필요한 항목) 만 채움.

**왜 업로드 시점에 미리 마스킹하는가**:
1. 사용자가 "검토 진행" 누르기 전에 마스킹 결과를 검수할 수 있어야 함
2. 마스킹 실패 시 후보자 추가 안 함 (또는 known-PII 추가 입력) 옵션 제공
3. LLM 호출 직전 동적 마스킹은 race condition 위험

### 10. 환경별 DB / 저장소 분기 (배포 가능 핵심)
- DB: `TURSO_DATABASE_URL` 있으면 Turso, 없으면 `file:./data.db`
- 파일: `BLOB_READ_WRITE_TOKEN` 있으면 Vercel Blob, 없으면 `./uploads/`
- `lib/storage.ts`의 `saveFile()` 호출자는 모른다. 반환되는 key가 파일명일 수도, 전체 URL일 수도 있을 뿐.

### 12. 첫 사용자 단순화 (온보딩 · 네비 · 단계 그룹)

신규/방문 사용자의 인지 부담을 낮추기 위한 **표시 계층** 단순화. 핵심 원칙은 **기능 삭제가 아니라 "필요할 때까지 숨김"** — 내부 데이터·라우트·stage enum 은 그대로 두고 첫 사용자의 시야에서만 치운다.

- **대시보드 첫 실행 가이드** (`app/page.tsx` `SetupGuide`): 법인의 "공고 → 이력서 → AI 면접" 첫 사이클 완료 여부로 3스텝 진행도를 계산.
  - 진행 판정: `setup1`=공고>0, `setup2`=후보>0, `setup3`=stage 가 `ai_pending` 이상 도달(후보자 집계 `interviewReached`).
  - **공고 0개** → KPI/알림/공고목록 대신 hero 가이드만 노출 (가장 비어 있는 시점에 가장 빽빽하던 화면을 제거).
  - **일부 진행** → 대시보드 상단에 슬림 진행 스트립(`시작 가이드 N/3` + 다음 단계 CTA). **3스텝 완료** → 자동 숨김.
  - 서버 렌더, 영속 상태 없음(localStorage 미사용). 공고 등록 CTA 는 기존 정책대로 PC 전용 + 모바일 안내문.
- **네비 정리** (`app/components/NavBar.tsx`): org_admin "법인" 드롭다운에서 **메일서버(`/org/smtp`)·줌(`/org/zoom`) 제외** → 법인 설정(`/org/settings`) 의 "외부 연동" 섹션으로 이동. 모바일 메뉴는 원래 둘을 숨기고 있어 데스크톱과 일관성도 맞췄다. 미설정 시 Intervia 기본값으로 동작하므로 첫 흐름에서 빠져도 무방(SMTP 는 후보자 상세에서도 맥락 링크로 도달 가능).
- **단계 필터 4버킷 그룹화** (`app/jobs/[id]/page.tsx` 후보자 필터 `<select>`): 12개 세부 stage 를 `<optgroup>` 4그룹(**서류 전형 / AI 면접 / 대면 면접 / 결정**)으로 묶어 표시. 매핑은 `lib/stage-meta.ts` 의 `STAGE_GROUPS` / `STAGE_GROUP_LABELS` / `STAGE_GROUP_OF` (재사용 가능). 내부 stage enum 과 "전형 단계 현황" 보드(이미 색상 그룹 구분)는 불변.

## 데이터 흐름 디테일

### 이력서 업로드 → 서류 평가
1. `POST /api/jobs/[id]/candidates` (multipart)
2. 공고 잠금 체크 (관리자면 우회)
3. 파일 buffer 읽기 → SHA-256 → DB에서 (jobId, userId, hash) 중복 체크 → 409 or 진행
4. `extractTextFromBuffer()` — PDF/TXT/HTML → 텍스트
5. 텍스트 < 30자면 실패 반환 (스캔 PDF 가능성)
6. `saveFile()` → 로컬 디스크 또는 Vercel Blob
7. `candidates` 인서트, status=`screening` → 즉시 응답
8. **비동기 백그라운드**: `screenAndPersist()` — `buildScreeningPrompt` → `generateJSON` → 점수+개인정보 추출 → DB 업데이트 → status=`screened` 또는 `failed`
9. 클라이언트는 4초 polling으로 갱신

### 면접 채팅 (한 턴)
1. `POST /api/interview/[token]/chat` body=`{userMessage}`
2. 세션 + 후보자 + 공고 로드
3. 만료/완료 체크
4. 첫 턴이면 `started_at` 기록, status=`in_progress`
5. `buildSystemPrompt(job, resumeText)` → Gemini systemInstruction
6. 이전 메시지 전부 history로 주입
7. `sendMessageStream(userMessage)` → ReadableStream 반환
8. 스트림 종료 시 메시지 누적 → DB의 `messages` JSON 컬럼 업데이트
9. 클라이언트는 응답에 `[INTERVIEW_END]` 포함 시 자동 finalize 호출

### 면접 종료 (finalize)
1. `POST /api/interview/[token]/complete`
2. 메시지 2개 미만이면 거부
3. 대화록 텍스트화 → `buildSummaryPrompt`
4. `generateJSON` → 평가 JSON
5. DB 업데이트: status=`completed`, evaluation=JSON, completed_at=now
6. `candidates.status` → `interviewed`

## 페이지 라우팅 매트릭스

| 경로 | 컴포넌트 종류 | 인증 | 잠금 |
|---|---|---|---|
| `/` | server | 필요 | - |
| `/login`, `/signup`, `/verify` | client | 면제 | - |
| `/account` | client | 필요 | - |
| `/jobs/new` | client | 필요 | - |
| `/jobs/[id]` | client | 필요 | PIN 가드 (system_admin 우회) |
| `/jobs/[id]/edit` | client | 필요 | PIN 가드 |
| `/candidates/[id]` | client | 필요 | 부모 공고 PIN 가드 |
| `/org/members` | client | 🛡️ | 멤버·합류요청 통합 1테이블. 승인대기(pending) 행이 상단 고정 + 인라인 승인/거절 |
| `/org/join-requests` | server | 🛡️ | `/org/members` 로 영구 리다이렉트 (호환용) |
| `/org/tokens` | client | 필요 | - |
| `/org/settings` | client | 🛡️ | 법인 정보·사업자번호·주소·OCR + **외부 연동(메일서버/줌) 진입점** |
| `/org/smtp` | client | 🛡️ | 메일 서버(SMTP). 네비 드롭다운 제외 — `/org/settings` 외부 연동에서 진입 |
| `/org/zoom` | client | 🛡️ | 화상 면접(줌). 네비 드롭다운 제외 — `/org/settings` 외부 연동에서 진입 |
| `/admin/orgs` | client | 👑 | - |
| `/admin/users` | client | 👑 | - |
| `/admin/pricing` | client | 👑 | - |
| `/interview/[token]` | client | **면제** | 토큰 인증 |

## 컴포넌트 패턴

- 서버 컴포넌트: DB 직접 쿼리, 첫 페인트 빠름 — 주로 대시보드/레이아웃
- 클라이언트 컴포넌트: 인터랙티브 폼/채팅/모달 — 대부분의 페이지
- 서버 → 클라이언트 분리: dashboard에서 직접 DB 쿼리 후 `<JobsList jobs={...} isAdmin={...} />`로 props 전달

## 면접관 페르소나 (lib/prompts.ts)

핵심 프롬프트 위치는 `lib/prompts.ts`. 페르소나/평가 품질 튜닝은 여기서.

- `buildSystemPrompt`: 면접관 톤/시간 따른 질문 개수/꼬리질문 규칙/프롬프트 인젝션 방어/종료 토큰
- `buildScreeningPrompt`: 서류 평가 + 개인정보 추출 (이름/전화/이메일/나이/경력연수/요약)
- `buildSummaryPrompt`: 면접 평가 (4개 영역 + 강점/우려/추가 질문 + 외부 LLM 보조 의심 신호 노트 + 답변 AI 생성 가능성 판별 `ai_authorship`)

### 부정행위(외부 LLM 보조) 탐지/억제

후보자가 ChatGPT/Claude 등으로 답변을 대신 생성하는 것을 억제·탐지하는 다층 방어:
- **복사 방지** (`app/interview/[token]/page.tsx`): 대화 로그 `onCopy/onCut/onContextMenu` 차단 + AI 질문 버블 `select-none`. 차단되지만 스크린샷 등 우회는 가능 → 억제 + 신호 수집 목적.
- **행동 신호 수집** (턴별 `InterviewMessage.inputSignals`): 붙여넣기 횟수·글자수, 타이핑 글자수, 첫 입력까지 지연, 탭 전환·창 이탈(`visibilitychange`) 횟수, 질문 복사 시도 횟수.
- **집계** (`lib/interview-signals.ts` `computeTranscriptStats`): complete·reevaluate 공용. 붙여넣기 비율/탭이탈/복사시도 임계 초과 시 `suspicious`. 평가 프롬프트에 객관 수치로 전달 → `llm_assist_note`.
- **AI 자동 판별** (C): 평가 LLM 이 답변 텍스트 **문체만** 분석해 `ai_authorship`(likelihood/score/signals/note) 산출. 행동 신호와 독립적, 추가 LLM 호출 없음.
- 모든 신호는 **단정 금지·중립 톤** — 정당 사용 가능성 명시, 후보자 상세 리포트에 표시.
- `buildInterviewQuestionsPrompt`: 1차 대면 면접 질문지 (이력서+서류평가+AI면접 평가 종합 → 섹션별 맞춤 질문지). 1차 일정 확정 후 면접관이 생성, `interview_question_sheets` 에 저장.

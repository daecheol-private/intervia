# 상용 서비스 개발 계획

> **목표**: 결제 기능 제외, 외부 후보자에게 면접 링크 발송해서 실서비스처럼 테스트 가능한 수준으로 만들기.
> **진행 방식**: 각 작업 완료 시 체크박스 `[ ]` → `[x]` 로 업데이트. 시작 시점/완료 시점 기록.
> **업데이트 정책**: 작업 끝날 때마다 이 파일을 함께 커밋. 큰 변경이면 `## 변경 이력` 섹션도 추가.

---

## 📊 전체 진행 현황

| Phase | 작업 | 완료 | 진행률 |
|---|---|---|---|
| 1. 법적 안전망 + 보안 | 21 | 18 | 86% |
| 2. 채용 워크플로우 | 11 | 10 | 91% |
| 3. 운영 안정성 | 8 | 6 | 75% |
| 4. UX / 차별화 | 7 | 5 | 71% |
| 6. 시스템 관리자 운영 기능 | 16 | 10 | 63% |
| 7. 디자인 시스템 리뉴얼 (Forest+Ivory) | 4 | 1 | 25% |
| 8. 고객센터 / 문의 접수 | 5 | 5 | 100% |
| **합계** | **72** | **55** | **76%** |

마일스톤:
- **M1 — Phase 1 완료** = 외부 후보자에게 링크 뿌릴 수 있는 법적·보안 최소선
- **M2 — Phase 2 완료** = 채용 사이클 1회 풀로 돌릴 수 있음
- **M3 — Phase 3 완료** = 장애 추적·복구 가능
- **M4 — Phase 4 완료** = 영업·차별화 가능
- **M6-A — Phase 6-A 완료** = 첫 유료 고객 받기 전 운영 필수 기능 완비

---

## 🚨 사용자가 결정해야 할 항목

> 시작 전에 결정되어야 진행 가능. 또는 진행하며 결정.

### A. 즉시 결정 필요 (Phase 1 차단)
- [x] **A-1**: 서비스 이름 → **Intervia** (2026-05-16 결정) — 리브랜딩 작업 1-0 로 추가됨
- [x] **A-2**: 도메인 → Vercel 기본 (`xxx.vercel.app`)으로 시작, 추후 자체 도메인 연결 (2026-05-16 결정)
- [x] **A-3**: 사업자 정보 (2026-05-16 결정)
  ```
  상호      : Intervia
  대표자    : 강대철
  사업자번호 : 추후 등록
  주소      : 서울특별시 강서구 양천로 28길 29 마곡우림필유 101동 110호
  전화      : 010-7496-2696
  대표 이메일: daecheol1983@gmail.com
  ```
- [x] **A-4**: DPO → **대표자 겸직** (2026-05-16 결정)
  - 이름/연락처/이메일 모두 A-3 과 동일
  - 1인 기업이므로 별도 DPO 지정 의무 없음, 대표자가 책임자
- [x] **A-6**: 이의제기 수신처 → **DPO 이메일 동일** (`daecheol1983@gmail.com`) (2026-05-16 결정. 향후 트래픽 늘면 별도 메일 분리)
- [x] **DB**: **Turso 유지** (2026-05-16 결정. Phase 4 출시 직전 재평가)
- [x] **호스팅**: **Vercel Hobby + cron-job.org** (2026-05-16 결정)
  - 사유: 테스트 단계에선 비용 0원, 실매출 발생 시 Pro 이전
  - cron-job.org 무료로 1분/시간 단위 cron 사용 (가이드: `DEPLOY.md` §5)
  - Vercel cron 은 daily 2개 (data purge / queue safety net) 만
- [x] **A-5**: 후보자 데이터 보유기간 디폴트 → **합·불 결정 시점 즉시 폐기** (2026-05-16 결정)
- [x] **A-6**: 자동화 의사결정 이의제기 수신처 → **DPO 이메일과 통합** (`daecheol1983@gmail.com`, 1인 기업이라 DPO·이의제기·문의 모두 단일 채널). 2026-05-26 결정. 구현 완료: `lib/site-info.ts` `APPEAL_CONTACT`, `app/interview/[token]/appeal/page.tsx`, `app/api/interview/[token]/appeal/route.ts` 모두 존재. 분리 필요해지는 시점(이의제기 빈도 높아져서 DPO 일반 문의와 섞이면 운영 불편) 까지는 단일 채널 유지.
- [x] **A-7**: 비밀번호 정책 → **최소 10자 + 영문 대/소/숫자/특수문자 중 3종 이상** (2026-05-16 결정. 2026-05-20 12자 → 10자 완화)
- [x] **A-8**: 시스템관리자 데이터 접근 → **항상 가능** (2026-05-16 결정. 단, 모든 접근은 감사 로그 기록)

### B. Phase 2 전에 결정
- [x] **B-1**: 채용 단계(Stage) 표준 (2026-06-02 결정) — **고정 12-stage 모델 유지, 차수는 1·2차만**. 2차는 별도 세부 단계(후보/스케줄/대기)를 만들지 않고 `round1_passed` 후보에게 **2차 일정 조율만** 제공(stage 변경 없음, 2차합격은 수동 전환). 설정형 N차/법인별 커스텀은 고정 enum·funnel·UI 전면 리팩터 부담으로 보류.
- [x] **B-2**: 합·불 통보 메일 템플릿 (2026-06-02 결정) — **현재 기본 템플릿 유지**(`buildDecisionEmail`). 결정 시 커스텀 본문 입력 가능. 법인별 템플릿 저장 기능은 미도입.

### C. Phase 3 전에 결정
- [ ] **C-1**: 에러 모니터링 서비스 — Sentry (무료 5k events/월) / Logtail / 자체
- [ ] **C-2**: 백업 정책 — Turso 자동 백업만? 별도 일일 export?

### D. 글로벌 / 향후 (지금 결정 안 해도 됨)
- [ ] **D-1**: 다국어 (영어/중국어) 우선순위
- [ ] **D-2**: EU 진출 시 GDPR · EU AI Act 적용 필요 (현재 한국만)

---

## 🔑 외부 발급·세팅 필요 항목

> 사용자가 직접 발급/구매해야 하는 것. 발급 후 환경변수 또는 시스템관리자 페이지에 등록.

### 즉시 필요 (배포 전)
- [ ] **K-1**: **프로덕션 Google AI Studio API 키** — 결제 미연동 새 프로젝트로 발급 (무료 1500/일). 트래픽 늘면 결제 연동 (Pay-as-you-go 시 한도 ↑)
  - 발급: https://aistudio.google.com/app/apikey
  - `.env` 의 `GOOGLE_API_KEY` 에 입력
- [x] **K-2**: Turso DB 생성 완료 (2026-05-16). `intervia-daecheol-private.aws-ap-northeast-1.turso.io` (도쿄 리전). 14개 테이블 + 가격 시드 적용 완료. 자격증명은 `.env.production.local` 에 저장.
- [ ] **K-3**: **Vercel Blob 토큰**
  - Vercel 대시보드 → Storage → Blob → Create
  - `BLOB_READ_WRITE_TOKEN`
- [ ] **K-4**: **Vercel 프로젝트** 연결 — **Hobby 티어** (실매출 발생 전까지). cron-job.org 로 cron 보완
- [ ] **K-4-2**: **cron-job.org 가입 + 3개 cronjob 등록** (가이드: `DEPLOY.md` §5)
- [x] **K-5**: **CRON_SECRET / INTERNAL_API_SECRET / MASTER_ENCRYPTION_KEY** → `.env.local` 자동 주입 완료 (2026-05-16)
- [ ] **K-6**: **SMTP_*** 환경변수 (시스템 기본 메일서버) — 법인 SMTP 미등록 시 폴백.
  - dev: Resend Free + `onboarding@resend.dev` (본인 메일에만 발송, 월 3,000통) — 적용 완료 (2026-05-20)
  - **운영 전환 시**: ① 본인 도메인 등록 + DKIM/SPF DNS 레코드 → Resend Domains에서 verify, ② `SMTP_FROM`을 `noreply@your-domain.com`으로 교체, ③ 트래픽 늘면 Resend Pro ($20/월, 5만통)
  - 상세: `DEPLOY.md` §3-1
- [ ] **K-6-3**: **DART_API_KEY** — opendart.fss.or.kr (전자공시시스템) 상장사·외감법인 회사명 자동완성 데이터 생성용
  - dev: 가입 즉시 무료 발급 (일 10,000건). `.env.local` 입력 후 `npm run dart:fetch` 1회 실행 → `lib/dart-corps.json` 생성 (~3,500개)
  - **운영 전환 시**: 동일 키 재사용. 분기 1회 재실행 권장 (신규 상장사 반영)
- [ ] **K-6-2**: **BUSINESS_REGISTRY_API_KEY** — data.go.kr 국세청 사업자등록정보 진위확인 API
  - dev: 활용신청 시 "개발" 선택 → 자동승인 → 일 1,000건. (가이드: `DEPLOY.md` §3-1)
  - **운영 전환 시**: 동일 API를 "운영" 구분으로 재신청 (사람 검토 1-3 영업일) → 운영 키 발급되면 Vercel 환경변수 교체
- [ ] **K-7**: **APP_BASE_URL** — 배포된 프로덕션 도메인 (예: `https://intervia.vercel.app`)
- [ ] **K-8**: **마스터 암호화 키** (`MASTER_ENCRYPTION_KEY`) — 32바이트 임의값. SMTP 비밀번호 등 민감 정보 AES-256 암호화에 사용

### Phase 1 진행 중 필요
- [x] **K-9**: 처리방침/이용약관 → **PIPA 표준 템플릿 기반 초안 생성** (2026-05-16 결정)

### Phase 3 진행 중 필요
- [ ] **K-10**: Sentry DSN (오류 추적, 무료 티어 OK)
- [ ] **K-11**: 모니터링 알림 채널 (Slack webhook 또는 이메일)

### 선택적
- [ ] **K-12**: HIBP API 키 (비밀번호 유출 검사 — k-anonymity 방식은 무료/키 불필요)

---

## Phase 1 — 법적 안전망 + 보안 기반

> 외부 후보자 노출 전 반드시 완료. 마무리되면 **M1 달성**.

### 1-0. 리브랜딩 → "Intervia"

- [x] **1-0-1** 브랜드 노출 위치 전체 변경 (완료 2026-05-16)
  - ✅ `app/layout.tsx` metadata title / 네비바 (AI → iV / "AI 면접관" → "Intervia")
  - ✅ `app/login/page.tsx` (로고 + "관리자 페이지")
  - ✅ `lib/mailer.ts` (HTML 헤더 + subject "[Intervia 면접 안내]" + 푸터)
  - ✅ `lib/email-verify.ts` (subject + 본문)
  - ✅ `app/jobs/new/page.tsx` (페르소나 설명 — AI 면접관 → 면접관)
  - ✅ `package.json` name (intervia)
  - ✅ `.env.local.example` SMTP_FROM
  - ✅ `DEPLOY.md` SMTP_FROM
  - ✅ 루트 `CLAUDE.md` 제목

### 1-1. 인증 / 인가 강화

- [x] **1-1-1** 로그인 Rate limit + 시도 잠금 (완료 2026-05-16)
  - ✅ `auth_attempts` 테이블 (Turso + 로컬 모두 적용)
  - ✅ Email 15분 5회 실패 → 15분 잠금 / IP 15분 20회 실패 → 15분 잠금
  - ✅ 성공 시 실패 기록 즉시 리셋
  - ✅ 로그인 UI 에 잠금 메시지 노출 (잔여 분 포함)
  - ✅ 30일 경과 row 일일 cron 으로 자동 정리 (purge-original 에 통합)
  - ✅ 단위 테스트 통과 (5회 실패 → 잠김, retryAfter=900s, 성공 시 해제)
  - ⏭️ CAPTCHA 는 Phase 4 차별화 단계로 이관 (영업 임팩트 X)
- [x] **1-1-2** 비밀번호 정책 강제 (완료 2026-05-16)
  - ✅ 최소 10자 + 영문 대/소·숫자·특수문자 중 3종 이상 (A-7 결정 반영)
  - ✅ HIBP (Have I Been Pwned) k-anonymity 검사 (`api.pwnedpasswords.com/range/{prefix}`, 키 X, 타임아웃 3초)
  - ✅ 4개 라우트 적용: `/api/orgs` / `/api/orgs/join-requests` / `/api/auth/setup` / `/api/auth/change-password`
  - ✅ UI: `<PasswordStrength>` 컴포넌트로 회원가입/setup/계정설정에 실시간 체크리스트
  - ✅ 환경변수 `SKIP_HIBP=1` 로 오프라인 dev 우회 가능
  - ✅ 단위 테스트: short/2종/3종/4종/유출비번(Password1234) 검증 통과
- [x] **1-1-3** `/api/uploads/*` 인증 추가 (완료 2026-05-16)
  - ✅ 신규 라우트 `/api/uploads/candidate/[id]` — 세션 + `ownsOrg` + 부모 공고 PIN 잠금 + Blob URL stream proxy
  - ✅ 기존 `/api/uploads/[file]` legacy 가드 추가 (로그인 필수, Blob URL 거부)
  - ✅ 클라이언트 다운로드 링크 candidate 페이지에서 새 라우트로 전환
  - ✅ `lib/storage.ts` 의 `getDownloadUrl` deprecate 표시
  - ✅ Blob URL 외부 노출 X (Vercel Blob `public` 모드여도 우리 함수가 proxy 함)
  - ✅ 세 가지 우회 시도 모두 401: candidate 경로 / legacy 경로 / Blob URL as file param
- [x] **1-1-4** 활성 세션 목록 / 원격 로그아웃 (완료 2026-05-16)
  - ✅ `sessions` 테이블에 `ip / user_agent / last_seen_at` 컬럼 추가 (Turso + 로컬)
  - ✅ `createSession(userId, {ip, userAgent})` 시그니처 확장
  - ✅ `getCurrentUser` 가 60초 간격으로 `last_seen_at` 갱신 (DB 부하 회피)
  - ✅ `GET /api/auth/sessions` — 본인 세션 목록 (displayId만, 전체 토큰 미노출)
  - ✅ `DELETE /api/auth/sessions/[id]` — prefix 매칭 + userId 가드로 원격 로그아웃
  - ✅ `POST /api/auth/sessions/revoke-others` — 현재 세션 제외 일괄 종료
  - ✅ `/account` UI: 디바이스/IP/최근활동/로그아웃 버튼, "현재 세션" 배지
  - ✅ 401 가드 3종 검증 통과
- [x] **1-1-5** API Rate limit (완료 2026-05-16)
  - ✅ `api_rate_log` 테이블 + `lib/rate-limit.ts` 헬퍼 (DB 기반 sliding window)
  - ✅ 적용 라우트 (분당 한도):
    - signup (`/api/orgs`, `/api/orgs/join-requests`): 5회
    - setup (`/api/auth/setup`): 5회
    - change-password (`/api/auth/change-password`): 5회/사용자
    - resend-verification (`/api/auth/resend-verification`): 3회
    - send-email (`/api/interview-sessions/[id]/send-email`): 5회/사용자
    - llm-screen (`/api/candidates/[id]/screen`): 30회/사용자
    - llm-bulk-screen (`/api/candidates/bulk-screen`): 5회/사용자 (1회당 최대 500건)
  - ✅ login 은 기존 `auth_attempts` 잠금이 더 강력 — 별도 RL 불필요
  - ✅ INSERT 는 fire-and-forget 으로 응답 지연 최소화
  - ✅ 24h 경과 row 일일 cron 정리 (purge-original 통합)
  - ✅ 시나리오 검증: signup 분당 5회 초과 시 429 + `{code:"rate_limited", retryAfterSeconds}`

### 1-2. PIPA 컴플라이언스

- [x] **1-2-1** `consent_logs` 테이블 + 후보자 동의 흐름 (완료 2026-05-16)
  - ✅ `consent_logs` 테이블 (Turso + 로컬)
  - ✅ `lib/consent.ts` — `CONSENT_VERSION="1.0.0-2026-05-16"`, 4가지 필수 항목 정의 (collection_use / ai_decision / processors / retention)
  - ✅ `POST /api/interview/[token]/consent` — 필수 항목 누락 시 400, 정상 동의 시 row 생성 + IP/UA 기록
  - ✅ `GET /api/interview/[token]` 응답에 `consentRequired / consentVersion / consentItems` 포함
  - ✅ `chat` / `complete` 라우트 동의 가드 — 미동의 시 403 + `{code:"consent_required"}`
  - ✅ UI: `<ConsentGate>` 컴포넌트 — 항목별 체크박스 + 필수/선택 배지 + 법적 근거 표시
  - ✅ 시나리오 검증: 동의 없이 chat → 403 / 부족 동의 → 400 / 완전 동의 → 200 + chat 200
  - 📋 동의 버전 변경 시 신규 동의 자동 요구 (구버전 row 는 감사용 보존)
- [x] **1-2-2** `/privacy` 처리방침 페이지 (완료 2026-05-16)
  - ✅ PIPA 표준 11개 조항 (목적/항목/보유/제공/위탁/권리/자동화/안전성/DPO/구제/변경)
  - ✅ §28의8 국외이전 명시 (미국·일본·호주)
  - ✅ §37의2 자동화 의사결정 권리 + 이의제기 채널
  - ✅ 시행일·DPO·사업자 정보 자동 노출
- [x] **1-2-3** `/terms` 이용약관 페이지 (완료 2026-05-16)
  - ✅ 11개 조항 (목적/정의/서비스/가입/의무/회사의무/토큰/중지/면책/해지/관할)
  - ✅ AI 평가는 참고자료, 최종 합·불 책임은 법인 명시
  - ✅ 채용절차법 준수 의무 명시
- [x] **1-2-4** 처리위탁 업체 목록 (완료 2026-05-16, 1-2-2 §5 에 통합)
  - ✅ `PROCESSORS` 상수 (Google/Vercel/Turso/Vercel Blob/HIBP/SMTP 6개) — 처리방침 §5 에 표 형태로 노출
  - ✅ 별도 페이지보다 처리방침 내 섹션이 정보주체 가독성에 유리 — 별도 페이지 X
- [x] **1-2-5** 자동화 의사결정 이의제기 채널 (완료 2026-05-16)
  - ✅ `appeal_logs` 테이블 (status: pending/reviewed/resolved/rejected)
  - ✅ `POST /api/interview/[token]/appeal` — 본인 이메일 매칭 + 사유 10~5000자 + IP/UA 기록 + DPO 알림 메일
  - ✅ Rate limit IP 3/분 (스팸 방지)
  - ✅ `GET /api/candidates/[id]/appeals` (채용담당자), `PATCH .../[appealId]` 상태·메모 업데이트
  - ✅ `/interview/[token]/appeal` 후보자 UI (이메일+사유 폼, 완료 시 접수 확인)
  - ✅ 면접 종료 화면에 "자동화 의사결정 이의제기 →" 링크 노출
  - ✅ 후보자 상세 페이지(`/candidates/[id]`)에 `<AppealsPanel>` — 상태 변경/내부 메모 가능
  - ✅ 검증: wrong email 403 / wrong token 404 / short reason 400 / API 비로그인 redirect
- [x] **1-2-6** 사업자/DPO 정보 자동 반영 (완료 2026-05-16, 단순화)
  - ✅ `lib/site-info.ts` 단일 source — 처리방침/이용약관/메일 모두 여기서 조회
  - ✅ 변경 시 한 파일만 수정 → 모든 페이지 자동 반영
  - 📋 후속 (1-3 단계 이후): DB `system_settings` 로 이전 + 관리자 UI

### 1-3. 데이터 보호

- [x] **1-3-1** SMTP 비밀번호 암호화 AES-256-GCM (완료 2026-05-16)
  - ✅ `lib/crypto.ts` — `encrypt/decrypt/isEncrypted`. 포맷 `enc:v1:` + base64(iv 12B + tag 16B + ciphertext)
  - ✅ `/api/orgs/smtp` PUT — 평문으로 verify 후 암호화하여 저장. 마스킹 입력 시 기존 값 decrypt 해서 재사용
  - ✅ `mailer.ts` resolveSmtp — DB authPass decrypt 후 nodemailer 에 전달
  - ✅ GET 응답 마스킹 — 길이 노출 안 함 (`************` 고정)
  - ✅ `scripts/migrate-encrypt-smtp.mjs` — 기존 평문 row 일괄 암호화 (실행 완료, 현재 row 0건)
  - ✅ legacy 평문 passthrough — `decrypt` 가 `enc:v1:` prefix 없으면 그대로 반환 → 마이그레이션 도중 안전
  - ✅ GCM authTag 변조 감지 검증 통과
- [x] **1-3-2** `audit_logs` + 감사 로깅 (완료 2026-05-16)
  - ✅ 테이블 (Turso + 로컬)
  - ✅ `lib/audit.ts` fire-and-forget 헬퍼
  - ✅ 적용: login.success / candidate.view·delete·bulk_delete·download / screen.trigger·bulk / send-email / appeal.submit·status_change / user.role·status_change / org.smtp_update·delete / candidate.self_view·self_delete
  - ✅ system_admin 이 타 법인 candidate 조회 시 `metadata.cross_org=true` 자동 표기 → UI에서 amber 강조
  - ✅ `GET /api/admin/audit` (system_admin/org_admin) + `/admin/audit` 페이지 (액션 필터, 7/30/90일 범위)
- [x] **1-3-3** 시스템관리자 데이터 접근 정책 (완료 2026-05-16, A-8 항상가능 결정)
  - ✅ 현재 정책 유지. 단, 1-3-2 감사로깅으로 모든 접근 추적
  - ✅ system_admin × cross_org 자동 마킹 → /admin/audit 에서 amber 행으로 즉시 식별
- [x] **1-3-4** 보유기간 정책 (완료 2026-05-16, Phase 2-1-4 와 함께 구현됨)
  - ✅ `purgeOnDecision` — 합·불·철회 결정 즉시 이력서 본문·파일 폐기
  - ✅ 일일 cron 30일 폐기도 안전망으로 유지 (결정 안 한 채 묵힌 후보자 대응)
- [x] **1-3-5** 후보자 본인 정보 조회/삭제 (완료 2026-05-16)
- [x] **1-3-6** 지원자 동의 취득 책임 전가 (완료 2026-05-22) — 사람인/잡코리아 우회 흐름의 동의 단절 차단. candidates 테이블 컬럼 + 업로드/평가 API 게이트 + 업로드 UI 체크박스 + 표준 동의 문구 페이지(`/legal/applicant-consent-template`) + 이용약관 §5 전면 개정 (TERMS_VERSION 1.1.0). PIPA §15·§26·§28의8·§37의2 책임을 계약·기술 양면에서 채용기업으로 전가.
  - ✅ `POST /api/interview/[token]/me` — 본인 이메일 확인 후 보유 데이터 요약 반환
  - ✅ `DELETE /api/interview/[token]/me` — 이력서 본문·파일·전화 즉시 폐기 (평가 결과 1년 보존)
  - ✅ `/interview/[token]/me` UI — 이메일 인증 후 데이터 표 + 폐기 버튼
  - ✅ 면접 종료 화면에 셀프 채널 + 이의제기 링크 함께 노출
  - ✅ Rate limit (조회 5/분, 삭제 3/분) + 감사 로그

---

## Phase 2 — 채용 워크플로우 완성

### 2-1. 후보자 상태 관리

- [x] **2-1-1** 채용 단계(Stage) 시스템 (완료 2026-05-16)
  - ✅ `candidates` 에 `stage` 컬럼 (Turso + 로컬, 기존 데이터 백필)
  - ✅ 9단계: applied / screened / interview_1 / interview_2 / offer / hired / rejected / hold / withdrawn
  - ✅ `PATCH /api/candidates/[id]/stage` — 단계 변경 + 감사 로그
  - ✅ UI: 후보자 상세 헤더에 stage 배지 + "단계 변경" / "합·불 결정" 버튼
- [x] **2-1-2** 합격/불합격 결정 + 결정 사유 메모 (완료 2026-05-16)
  - ✅ `decided_at / decided_by_user_id / decision_note` 컬럼
  - ✅ 결정 모달 — rejected/hired/hold 선택 + 내부 메모 입력
  - ✅ 단말 단계(hired/rejected/withdrawn) 도달 시 자동으로 decided_at/by 기록
- [x] **2-1-3** 결과 통보 메일 자동/수동 발송 (완료 2026-05-16)
  - ✅ `lib/candidate-stage.ts` `buildDecisionEmail` — 합격/불합격/보류 기본 템플릿
  - ✅ 결정 모달에서 "이메일 발송" 체크박스 + 커스텀 본문 입력란
  - ✅ SMTP 미설정 시 안내 + 결정은 그대로 진행
- [x] **2-1-4** 채용 종료 시점 → 즉시 폐기 (완료 2026-05-16, 1-3-4 해결)
  - ✅ `purgeOnDecision` 헬퍼 — 이력서 본문·파일 즉시 삭제 (평가 결과 보존)
  - ✅ hired/rejected/withdrawn 도달 자동 트리거
  - ✅ 결정 모달에 PIPA A-5 정책 명시 안내

### 2-2. 다단계 면접 / 사람 면접관

- [x] **2-2-1** 사람 면접관 메모 / 스코어카드 (완료 2026-05-16)
  - ✅ `interviewer_notes` 테이블 (Turso + 로컬)
  - ✅ scores 4영역 (skill/experience/collaboration/fit, 0-100) + 자유 메모
  - ✅ `GET/POST /api/candidates/[id]/notes` + `PATCH/DELETE .../[noteId]`
  - ✅ 본인 작성 메모만 수정·삭제, 같은 법인 멤버 조회 가능
  - ✅ UI: `<InterviewerNotesPanel>` — 작성 폼 + 평균 점수 + 4영역 표
- [x] **2-2-2** 면접관 배정 / 권한 (완료 2026-05-16)
  - ✅ `interviewer_assignments` 테이블
  - ✅ `GET/POST /api/candidates/[id]/assignments` + `DELETE .../[aid]`
  - ✅ 같은 법인 멤버만 배정 가능, 중복 방지
  - ✅ UI: `<AssignmentsPanel>` — 멤버 선택 드롭다운 + 배정/해제
- [ ] **2-2-3** 면접 일정 슬롯 — Phase 4 차별화로 이동
  - 자체 슬롯 픽커는 외부 도구 (Calendly/Google Calendar) 로 대체 권장
  - 운영 데이터 보고 필요성 재평가 후 결정

### 2-3. 비교 / 분석

- [x] **2-3-1** 후보자 비교 뷰 (완료 2026-05-16)
  - ✅ `/jobs/[id]/compare?ids=1,2,3` — N명 카드 grid (점수 3블럭 + 강점/우려/면접추천)
  - ✅ jobs/[id] 선택 도구에 "비교 (N)" 버튼 (indigo)
- [x] **2-3-2** CSV 익스포트 (완료 2026-05-16)
  - ✅ `GET /api/jobs/[id]/candidates/export` — UTF-8 BOM (Excel 한글 호환) + 14컬럼
  - ✅ jobs/[id] 우측 상단 "📥 CSV" 다운로드 버튼
  - ✅ 감사 로그 metadata.kind=export_csv 기록
- [x] **2-3-3** 공고별 깔때기 분석 (완료 2026-05-16)
  - ✅ `GET /api/jobs/[id]/funnel` — 9단계 카운트 + 평균 AI 서류 점수
  - ✅ jobs/[id] 헤더 아래 `<FunnelPanel>` (단계별 색상 카드 grid)
- [x] **2-3-4** 평가 대시보드 (완료 2026-05-16, 3-2-1 에 통합 — `/admin/metrics`)

---

## Phase 3 — 운영 안정성

### 3-1. 모니터링

- [x] **3-1-1** Sentry 연동 (완료 2026-05-16, lightweight)
  - ✅ `lib/error-reporter.ts` — Sentry envelope HTTP API 직접 POST (SDK 없이)
  - ✅ `SENTRY_DSN` 미설정 시 graceful — console.error 만
  - ✅ `captureError(err, ctx)` / `captureCritical(err, ctx)` 통합 진입점
- [x] **3-1-2** 구조화 로깅 + 요청 ID (완료 2026-05-16)
  - ✅ `lib/logger.ts` — JSON 1줄 출력
  - ✅ `withRequest(req)` — req_id 자동 부착 (`x-vercel-id` / 자동생성)
- [x] **3-1-3** 헬스체크 (완료 2026-05-16)
  - ✅ `/api/health` — DB ping + env 검증 + Blob/Sentry/Slack 설정 표시
  - ✅ 응답 200 / 503 — Pingdom/UptimeRobot/cron-job.org 호환
  - ✅ 검증: DB latency 1ms, env 4종 OK
- [x] **3-1-4** 에러 알림 (완료 2026-05-16)
  - ✅ `captureCritical` → Sentry + Slack webhook 동시 발송
  - ✅ `SLACK_WEBHOOK_URL` 미설정 시 graceful skip

### 3-2. 운영 도구

- [x] **3-2-1** 시스템관리자 메트릭 페이지 (완료 2026-05-16, 2-3-4 통합)
  - ✅ `GET /api/admin/metrics?days=N` — 법인/사용자/공고/후보자 카운트, stage 분포, 토큰 사용, 큐 상태, 면접 통계, 법인별 분포, cross-org 추적
  - ✅ `/admin/metrics` UI — system_admin 전체 통계 / org_admin 본인 법인 한정
  - ✅ 네비바 "메트릭" 메뉴 추가
- [ ] **3-2-2** 백업 검증 — Turso 자동 백업 의존 + 별도 export cron 은 후속
  - 현재: Turso Free tier 가 7일 PITR 제공. 운영 시작 후 별도 export cron 추가 검토
- [x] **3-2-3** 환경변수 검증 + `lib/config.ts` 중앙화 (완료 2026-05-16)
  - ✅ `lib/config.ts` — `config()` lazy validation, `checkConfig()` 헬스체크용
  - ✅ 필수: GOOGLE_API_KEY, MASTER_ENCRYPTION_KEY (길이 64 검증)
  - ✅ 운영(NODE_ENV=production)에서 TURSO_*/CRON_SECRET 등 권장 체크
- [ ] **3-2-4** DB 마이그레이션 자동화 — 후속
  - 현재 `scripts/setup-fresh-db.mjs` + 개별 마이그레이션. Vercel deploy hook 통합은 운영 안정화 후

---

## Phase 4 — UX / 차별화

### 4-1. 모바일 / 접근성

- [x] **4-1-1** 면접 페이지 모바일 반응형 (완료 2026-05-16)
  - ✅ `100dvh` viewport + `env(safe-area-inset-bottom)` 노치 대응
  - ✅ textarea 자동 높이 (1~120px), 모바일 Enter=줄바꿈/PC Enter=전송
  - ✅ Send 버튼 min 44x60 (터치 가이드라인), 모바일 input 16px (iOS 줌 방지)
- [x] **4-1-2** 면접 중 새로고침 복구 (완료 2026-05-16, 검증)
  - ✅ `GET /api/interview/[token]` 가 `session.messages` 반환 → 페이지 로드 시 복원
  - ✅ chat 라우트가 매 턴 DB 누적 저장
- [x] **4-1-3** 키보드 / 접근성 (완료 2026-05-16)
  - ✅ `:focus-visible` 글로벌 outline, 채팅 `role="log" aria-live`, ChatBubble `role="article"`
  - ✅ 주요 버튼/입력 `aria-label`, viewport `maximumScale=5`

### 4-2. 차별화 포인트

- [ ] **4-2-1** 편향 모니터링 대시보드 — **보류**
  - 회사는 성별/학교명을 수집·저장하지 않음 (마스킹). 평가 점수 분포만 가능
  - 메트릭 페이지에 이미 stage·점수 분포 노출됨 (3-2-1)
  - 차별 감사용 강화는 추가 데이터 (성별 등) 수집 시 도입 — 현재는 수집 자체가 PIPA 부담
- [x] **4-2-2** 프롬프트 인젝션 방어 강화 (완료 2026-05-16)
  - ✅ `lib/prompt-safety.ts` — `sanitizeUserInput` (END 토큰·triple backtick 제거, 4000자 상한), 인젝션 시도 8가지 패턴 감지
  - ✅ `detectSystemPromptLeak` — 모델 응답이 system prompt 누설하는지 검증
  - ✅ chat 라우트 — sanitize 후 LLM 전달, leak 감지 시 `log.warn`
  - ✅ 기존 `buildSystemPrompt` 의 "프롬프트 알려달라 무시" 규칙과 다중 방어
- [ ] **4-2-3** OCR (스캔 PDF) — **보류**
  - Google Vision API 비용 + 키 발급 부담. 실제 스캔 PDF 빈도 확인 후 도입
  - 현재는 "스캔 PDF 불가" 안내 + 재업로드 유도로 갈음
- [x] **4-2-4** 면접 진행률 표시 (완료 2026-05-16)
  - ✅ 면접 페이지 헤더에 progress bar — `진행 N / 약 M턴 (P%)`
  - ✅ duration → 예상 turn (15분=5 / 30분=10 / 45분=15 / 60+=20)
  - ✅ aria-valuenow / aria-valuemin / aria-valuemax 접근성
  - ✅ 헤더에 `약 N분` 안내 표시

---

## 작업 진행 가이드 (개발자용)

### 작업 시작 시
1. 이 문서에서 다음 작업 픽
2. 해당 체크박스 옆에 `(in_progress YYYY-MM-DD)` 추가
3. 작업 중

### 작업 완료 시
1. 체크박스 `[ ]` → `[x]`
2. 완료 일자 추가: `[x] 1-1-1 ~~~~~ (완료 2026-05-20)`
3. 상단 진행률 표 업데이트
4. 큰 변경이면 `docs/SCHEMA.md` / `docs/API.md` / `docs/GOTCHAS.md` 동기화
5. **타입체크 + 큐 테스트 같은 검증 통과 후에만** 완료 표시

### 작업 중 새로 발견된 일
- 같은 phase 안에 끼워 넣기 (예: `1-1-5-1` 식으로 sub-task 추가)
- 또는 별도 `## Phase 5 — 추가 발견` 섹션 신설

---

## Phase 5 — 공고 라이프사이클 + 토큰 가드 (2026-05-17)

> 사용자 결정 사항 (2026-05-17):
> - 공고 기본 기간 2개월(60일), 1개월(30일) 단위 연장
> - 연장 비용 = (현재 후보자 수) × resume_upload 단가
> - 종결 +7일: 이력서/포트폴리오 PDF 자동 삭제
> - 종결 +14일: candidates PII 일괄 삭제 (job_postings 보존)
> - 종결된 공고: 신규 업로드/면접 차단
> - 이메일 발송 한도: 면접링크 10회, 결정통보 10회 (후보자당)
> - 토큰 0 이하: 이력서 업로드/평가, 이메일, 면접 시작 차단 (데이터 수정은 허용)

- [x] **5-1** 스키마 + 마이그레이션 (`scripts/migrate-job-lifecycle.mjs`) — Turso + 로컬 적용 완료
- [x] **5-2** `lib/job-lifecycle.ts` — closesAt 계산, extendJob, closeExpiredJobs, purgePdfsAfterClose, purgePiiAfterClose, runLifecycleSweep
- [x] **5-3** `GET/POST /api/jobs/[id]/extend` — 차감액 미리보기 + 1개월 연장
- [x] **5-4** `lib/wallet-guard.ts` — `requirePositiveBalance` + 402 응답 헬퍼
- [x] **5-5** 가드 적용 — 업로드/평가/면접링크/면접메일/결정통보 5개 라우트
- [x] **5-6** cron 통합 (`/api/cron/purge-original` 에 `runLifecycleSweep` 끼움)
- [x] **5-7** UI — 목록 D-day 배지, 상세 LifecyclePanel + 연장 모달

---

## Phase 6 — 시스템 관리자 운영 기능 (2026-05-21)

**배경**: 현재 sysadmin이 일반 사용자와 차이가 거의 없음. 환불·정지·권한이전 같은 기본 운영 기능이 없어 첫 유료 고객 대응 불가.

**Audit 결과** (2026-05-21):
- 있음: 법인 목록 + 토큰 가감, 사용자 검색 + 역할(member↔org_admin), 단가 변경, 메트릭/감사로그/잠금 조회
- 없음: 토큰 환불, 법인 정보 수정, 법인 정지, sysadmin 권한 부여/회수, 강제 로그아웃, sysadmin 대시보드, 비번 리셋, cross-org 후보자 삭제, org_admin 이전, 감사 export, 임퍼소네이트

### Phase 6-A — 운영 필수 (P0, 첫 유료 고객 전 완료 필수)

- [x] **6-A-1**: 토큰 환불 (2026-05-21) — `refundTokens()` in `lib/tokens.ts` (양/음수 모두 허용, 사유 5자+ 필수), `/api/admin/orgs/[id]/refund` 라우트, `/admin/orgs` UI에 별도 "환불" 버튼 + 사유 입력란. 감사 로그 `tokens.refund`. 기존 grant-tokens 라우트에도 `tokens.adjust` 감사 로그 추가.
- [x] **6-A-2**: 법인 정보 수정 (2026-05-21) — `PATCH /api/admin/orgs/[id]` (name/emailDomain/bizRegistrationNo, uniqueness 가드, 공용 도메인 차단, bizno 정규화), `/admin/orgs` 행 인라인 편집 모드. 감사 로그 `org.update` (변경된 필드의 from/to 메타).
- [x] **6-A-3**: 법인 정지/재개 (2026-05-21) — `organizations.suspended_at` + `suspended_reason` 컬럼 추가. POST/DELETE `/api/admin/orgs/[id]/suspend`. 정지 시: 로그인 라우트 차단 + `getCurrentUser` 자동 로그아웃 + 해당 법인 모든 세션 즉시 삭제. system_admin 우회 보장. UI 정지/재개 버튼 + 사유 prompt + "정지" 배지. 감사 로그 `org.suspend`/`org.resume`.
- [x] **6-A-4**: sysadmin 권한 부여/회수 (2026-05-21) — `/api/users/[id]` PATCH 에 마지막 sysadmin 0명 방지 가드 (role 변경/status disable 둘 다). `/admin/users` UI 에 `→ system_admin` 부여 / `sysadmin 회수` 버튼 (둘 다 confirm + sysadmin 배지 노란색 강조). 감사 로그는 기존 `user.role_change` 로 충분 (from/to 메타).
- [x] **6-A-5**: 강제 로그아웃 (2026-05-21) — `DELETE /api/admin/users/[id]/sessions` (per-user) + `POST /api/admin/sessions/all` (전체, `confirm: "FORCE-LOGOUT-ALL"` 문자열 가드 + 사유 5자+). 본인 세션 보호. UI: 사용자 row 마다 "강제 로그아웃" 버튼 + 페이지 상단 "🚨 전체 강제 로그아웃" (사유 prompt + double confirm). 감사 로그 `session.force_logout` (scope: user/all).

### Phase 6-B — 운영 편의 (P1, 사용자 50+ 시점)

- [x] **6-B-1**: sysadmin 전용 대시보드 (2026-05-21) — `/admin/dashboard` (server component). KPI 5개 (전체 법인 / 마이너스 토큰 / 정지 / 24h 신규 가입 / 평가 큐) + 섹션별 상세 (마이너스 잔액 톱10 / 정지 법인 리스트 / 신규 가입 8건 / 큐 상태 / 최근 critical 액션 10건). 헤더 sysadmin 메뉴 첫 항목으로 "운영" 링크 추가.
- [x] **6-B-2**: 비밀번호 리셋 메일 강제 발송 (2026-05-21) — `POST /api/admin/users/[id]/password-reset` (기존 sendPasswordResetMail 재사용 + extractIp). `/admin/users` 행 마다 "비번 리셋" 버튼 (confirm + 발송 결과 alert). 감사 로그 `user.password_reset_email`.
- [x] **6-B-3**: 후보자 cross-org 삭제 (2026-05-21) — `GET /api/admin/candidates?q=` (이름/이메일/전화 부분일치, 30건), `DELETE /api/admin/candidates/[id]` (사유 5자+ + 식별자 정확 일치 confirm). 새 페이지 `/admin/candidates` (PIPA 권리요청 워크플로우 + 빨간 경고 배너). 헤더에 "후보자" 링크. 감사 로그 `candidate.admin_delete`.
- [x] **6-B-4**: org_admin 이전 (2026-05-21) — `POST /api/admin/orgs/[id]/transfer-admin` (toUserId 필수, fromUserId 옵션 강등, 같은 법인 가드, 활성 사용자만, sysadmin 보호). 새 페이지 `/admin/orgs/[id]/transfer-admin` (드롭다운 + 강등 옵션 + 사유). `/admin/orgs` 행에 "관리자 이전" 링크. 감사 로그 `org.admin_transfer`.
- [x] **6-B-5**: 감사 로그 CSV export (2026-05-21) — `GET /api/admin/audit/export?days=&action=&orgId=` UTF-8 BOM CSV (엑셀 한글 호환), Content-Disposition attachment. `/admin/audit` 페이지에 "CSV 다운로드" 버튼 (현재 필터 그대로). sysadmin/org_admin 권한 분기 (org_admin 은 본인 법인만).

### Phase 6-C — 운영 고도화 (P2, 필요 시)

- [ ] **6-C-1**: 임퍼소네이트 — "이 사용자로 보기" 토글. 이유 입력 필수 + 30분 자동 만료 + 모든 액션에 `impersonated_by` 메타
- [ ] **6-C-2**: 2FA 강제 활성화 정책 — system_admin 의무화
- [ ] **6-C-3**: 메트릭 커스텀 기간/export
- [ ] **6-C-4**: 토큰 단가 변경 이력 + 영향도 시뮬레이션
- [ ] **6-C-5**: 공고 강제 종료 (org_admin 무능 시)
- [ ] **6-C-6**: 운영 알림 채널 — 마이너스 토큰·실패율 급증 → Slack/메일

### 공통 보안 원칙

1. 모든 위험 액션은 **감사 로그 필수** — actor / target / reason / before-after
2. cross-org 접근은 "타법인접근" 플래그 (이미 있음)
3. 환불·정지·삭제·임퍼소네이트는 **이유 입력 강제**
4. sysadmin·org_admin **마지막 1명 가드**
5. 권한부여·정지·임퍼소네이트는 critical Slack/메일 (Phase 3 알림채널 연계)

---

## 변경 이력

- 2026-05-16 — 초안 작성. 4 Phase / 45 작업 / 사용자 결정 8건 / 외부 발급 12건.
- 2026-05-16 — 사용자 결정 반영: 서비스명 Intervia / 도메인 vercel.app / 사업자정보 / DPO 대표자겸직 / 보유기간 합·불결정시 즉시폐기 / 비번 12자+3종 / sysadmin 항상가능 / 처리방침 PIPA 템플릿 / DB Turso 유지.
- 2026-05-16 — 시크릿 3개(.env.local) 자동 생성. **1-0-1 리브랜딩 완료**.
- 2026-05-16 — 호스팅 결정: Vercel Hobby + cron-job.org. `vercel.json` 을 daily 2개로 축소, `DEPLOY.md` §5 외부 cron 가이드 추가.
- 2026-05-16 — env 파일 분리 패턴 도입: `.env.local`=로컬 dev / `.env.production.local`=운영 마이그레이션. `@next/env` + `scripts/_load-env.mjs` 로 모든 마이그레이션 스크립트가 자동 로드. **Turso DB (도쿄) 셋업 + 시드 완료**.
- 2026-05-16 — **1-1-1 로그인 Rate limit + 시도 잠금 완료**. `auth_attempts` 테이블 + `lib/auth-attempts.ts` + 로그인 라우트 통합 + UI 잠금 메시지 + 일일 cron 정리. 단위 테스트 통과.
- 2026-05-16 — **1-1-2 비밀번호 정책 완료**. `lib/password-policy.ts` (12자 + 3종 + HIBP) + 4개 라우트 적용 + UI 컴포넌트 `<PasswordStrength>` 신규. 단위 테스트로 5가지 케이스 검증.
- 2026-05-16 — **1-1-3 파일 다운로드 인증 완료**. `/api/uploads/candidate/[id]` 신규 (세션+ownsOrg+PIN+Blob proxy). 기존 `/api/uploads/[file]` 가드 추가. 401 시나리오 3건 검증.
- 2026-05-16 — **1-1-4 세션 관리 완료**. sessions 테이블 ip/UA/last_seen 추가, `GET/DELETE/POST /api/auth/sessions*` 3종, `/account` 디바이스 목록 UI. 토큰 전체 미노출 (displayId prefix 매칭).
- 2026-05-16 — **1-1-5 API Rate limit 완료**. `api_rate_log` 테이블 + `rateLimit(req, scope, opts, userId?)` 헬퍼 + 7개 라우트 적용. signup 분당 5회 시나리오 검증 (6번째 429). **Phase 1-1 인증/인가 강화 5개 모두 완료 (30%).**
- 2026-05-16 — **1-2-1 후보자 동의 흐름 완료**. `consent_logs` + `lib/consent.ts` (4 필수 항목, v1.0.0). `POST /api/interview/[token]/consent` + chat/complete 가드. UI `<ConsentGate>`. 403/400/200 시나리오 검증.
- 2026-05-16 — **1-2-2/3/4/6 정책 페이지 4건 동시 완료**. `lib/site-info.ts` 단일 source / `/privacy` PIPA 11조 / `/terms` 11조 / 처리위탁 표 / 푸터 링크 / 동의화면 링크. 비로그인 200 확인.
- 2026-05-16 — **1-2-5 이의제기 채널 완료**. `appeal_logs` + 후보자 UI(`/interview/[token]/appeal`) + DPO 알림 메일 + 채용담당자 검토 UI. **Phase 1-2 PIPA 컴플라이언스 6/6 (100%).**
- 2026-05-16 — **1-3-1 SMTP 암호화 완료**. AES-256-GCM (`lib/crypto.ts`), MASTER_ENCRYPTION_KEY 기반. legacy passthrough + GCM tamper 검증 통과. 마이그레이션 스크립트 실행 (현재 row 0건).
- 2026-05-16 — **1-3-2/3/5 묶음 완료**. `audit_logs` + `lib/audit.ts` + 11개 라우트 logAudit + `/admin/audit` UI (cross_org 자동 마킹). 1-3-3 = A-8 항상가능 결정 + 감사로깅 강화로 충족. 후보자 셀프 채널 `/interview/[token]/me` 열람·즉시폐기.
- 2026-05-16 — 1-3-4 보유기간 정책은 Phase 2-1 (합·불 결정) 과 함께 처리 예정으로 보류.
- 2026-05-16 — **2-1-1/2/3/4 채용 단계·결정 액션 4건 묶음 완료**. candidates 에 stage/decision_* 컬럼, 9단계 시스템, 결정 모달 (합/불/보류 + 메모 + 메일 발송), 단말 단계 도달 자동 폐기 (`purgeOnDecision` — PIPA A-5). **1-3-4 동시 해결.**
- 2026-05-16 — **2-2-1/2 면접관 메모·배정 2건 묶음 완료**. `interviewer_notes` (4영역 스코어카드 + 자유 메모, 본인 row 만 수정), `interviewer_assignments` (같은 법인 멤버 배정/해제). 2-2-3 슬롯은 외부도구 권장으로 Phase 4 이동.
- 2026-05-16 — **2-3-1/2/3 비교·익스포트·깔때기 3건 묶음 완료**. `/jobs/[id]/compare` 카드 grid 비교 뷰, `/api/jobs/[id]/candidates/export` CSV (UTF-8 BOM), `/api/jobs/[id]/funnel` + UI 패널. 2-3-4 대시보드는 Phase 3-2 와 병합.
- 2026-05-16 — **Phase 3 6건 묶음 완료** (3-1-1/2/3/4 + 3-2-1 + 3-2-3 + 2-3-4 통합). lightweight Sentry/Slack 통합, JSON 로거, `/api/health`, `/api/admin/metrics` + `/admin/metrics` UI, `lib/config.ts` env 검증. 3-2-2 백업·3-2-4 마이그레이션 자동화는 후속.
- 2026-05-16 — **Phase 4-1 모바일/접근성 3건 묶음 완료**. 100dvh + safe-area, textarea 자동높이, 모바일 vs PC Enter 동작 분기, iOS 16px 줌방지, aria-live 채팅·aria-label·focus-visible. 4-1-2 새로고침 복구는 기존 구조 검증으로 충족.
- 2026-05-16 — **Phase 4-2 인젝션 방어 + 진행률 2건 완료**. `lib/prompt-safety.ts` (sanitize + leak 감지), 면접 페이지 progress bar (예상 N턴 대비 %). 4-2-1 편향 모니터링/4-2-3 OCR 은 추가 데이터 수집·API 비용 부담으로 보류.
- 2026-05-16 — **상용화 검토 보강 P0 5건 완료** (`docs/USER_TODO.md` 동기 추가).
  - **비밀번호 재설정 흐름**: `password_resets` 테이블 + `lib/password-reset.ts` + `/api/auth/password-reset/{request,confirm}` + `/password-reset` 페이지 (request·confirm 통합) + 로그인 페이지 링크. 토큰 1시간, 사용 시 동일 사용자 전 세션 무효화.
  - **면접 chat 스트림 중단 시 부분 응답 저장**: try/finally + cancel 핸들러로 클라이언트 단절·서버 예외 어떤 경우든 누적분 1회 저장. truncated 표시.
  - **CSRF Origin/Referer 검증**: `proxy.ts` 가 모든 state-changing API 요청에 Origin 검증. `/api/interview/*`, `/api/cron/*`, `/api/uploads/*` 는 면제. `ALLOWED_ORIGINS` env 로 추가 host 허용.
  - **이력서 업로드 size/MIME 가드**: 10MB 컷 + 빈파일 차단 + 확장자(.pdf/.docx) + magic byte 검증(PDF `%PDF-`, DOCX `PK`).
  - **면접 chat rate-limit**: 세션 토큰당 분당 20턴, IP당 분당 60턴, 메시지 8KB 컷. LLM 비용 DoS 차단.
- 2026-05-16 — `docs/USER_TODO.md` 신규 — 운영자가 외부 서비스에서 처리할 15개 항목(P0~P3) 별도 트래킹.
- 2026-05-16 — **상용화 검토 보강 P1 8건 완료**.
  - **Appeal 이메일 enumeration 차단**: 이메일 불일치 시 정상과 동일한 성공 응답, DB 저장 안 함, 시도는 감사 로그(`appeal.submit_mismatch`).
  - **SSRF host 화이트리스트**: `/api/uploads/candidate/[id]` 가 `blob.vercel-storage.com` 만 허용. `BLOB_ALLOWED_HOSTS` env 로 추가 가능. https 강제.
  - **세션 쿠키 항상 secure**: `NODE_ENV !== "development"` 시 secure=true (Vercel preview/staging 포함).
  - **채용절차법 §4의2 평가 금지 항목**: `buildSystemPrompt`/`buildScreeningPrompt` 에 성별·나이·출신지·가족관계·종교·정치·학교명·신체조건·부모정보 평가 금지 명시.
  - **자동화 거부권 동의 + Google 국외이전 단독 분리**: `CONSENT_VERSION` 1.1.0, `ai_decision` 거부 시 영향 명시, `overseas_transfer_google` 단독 항목 신설 (PIPA §28의8).
  - **가입자 약관·정책 동의 시각·버전 기록**: `users` 테이블 `terms_accepted_at/version`, `privacy_accepted_at/version` 4컬럼 추가. `PRIVACY_VERSION`/`TERMS_VERSION` 상수. signup 페이지에 필수 체크박스 + API 검증.
  - **이력서 prompt-injection sanitize**: `sanitizeResumeText()` — 시스템 토큰·역할변경 지시문·"100점/만점/강력추천 강요" 패턴 마스킹. 업로드 시 마스킹 직후 적용.
  - **감사 로그 실패 critical alert**: 11개 critical 액션(role_change·candidate.delete·download_resume·smtp_update·session.revoke_others·password_reset.confirm 등) 또는 cross-org 시스템관리자 접근 시 DB insert 실패하면 `captureCritical()` 로 Sentry/Slack 전송. metadata.cross_org=true 자동 기록.
- 2026-05-16 — **상용화 검토 보강 P2 5건 완료**.
  - **14세 미만 가입 차단 (PIPA §22의2)**: signup 폼에 "본인은 만 14세 이상" 필수 체크박스 + `/api/orgs`·`/api/orgs/join-requests` 서버 검증.
  - **계정 잠금 unlock 관리자 도구**: `lib/auth-attempts.ts` 에 `adminUnlock()` / `listLockedIdentifiers()`, `/api/admin/locks` GET / `/api/admin/locks/unlock` POST, `/admin/locks` 페이지 (system_admin 전용) + 상단 네비 "잠금" 링크. 락아웃 DoS 대응.
  - **결정 메일 발송 실패 시 폐기 보류**: 통보 메일 요청했는데 실패하면 `purgeOnDecision` 건너뜀. `purgeSkippedReason` 응답에 사유 포함. 후보자가 결과도 못 받고 데이터도 사라지는 케이스 차단.
  - **이용약관 §7-2 환불 정책 (전상법 §17)**: `/terms` 에 청약철회 7일·일부사용 차감·신청방법(시스템관리자 이메일)·처리기간·제한 5항 추가.
  - **(P2-5 pdf-parse Dependabot)** 은 운영자 GitHub 설정 작업으로 `docs/USER_TODO.md` #6 트래킹.
- 2026-05-17 — **보유기간 정책 일관화 완료**. `purgePiiAfterClose` 가 익명화 대신 candidate row 통째 삭제 (cascade 로 sessions/notes/assignments/attachments 정리). 결정 모달·일괄결정 안내·처리방침 §3·후보자 셀프 폐기·동의 항목 모두 "공고 종결 +14일 후 자동 삭제" 로 통일. CONSENT_VERSION 1.2.0 으로 bump (기존 동의자에게 재동의 요구).
- 2026-05-17 — **UX 보강 묶음 A (1+3+4) 완료**.
  - 면접 메일 경과일: `candidates.last_interview_email_sent_at` 추가, send-email 라우트가 timestamp 기록, 후보자 상세 헤더에 "📧 N일 전 발송" 배지 (7일↑ amber, 14일↑ red).
  - 후보자 정보 수정: `PATCH /api/candidates/[id]` (이름/이메일/연락처만, 감사 로그). 상세 헤더에 "✎ 정보 수정" 버튼 + 모달.
  - 파일명 이름 추출: `extractKoreanNameFromFilename` (한글 2~4자 토큰, 노이즈어 제외). 업로드 시 우선순위 = 수동입력 > 파일명 한국어 이름 > LLM 추출 > 그룹 폴더명.
- 2026-05-17 — **Phase 5 공고 라이프사이클 + 토큰 가드 7건 묶음 완료**. 공고 2개월 기본 + 1개월 단위 연장(후보자수×이력서 단가 차감), 종결+7일 PDF 폐기 / +14일 PII 폐기, 토큰 0 이하 시 유료행위 5종(업로드/평가/면접링크/면접메일/결정통보) 차단, 후보자당 면접 메일 10회·결정통보 10회 한도. 마이그레이션 Turso+로컬 적용, tsc 통과.
- 2026-05-16 — **상용화 검토 보강 P3 3건 완료**.
  - **`/api/health` 보호 강화**: 인증 없으면 `{ok}` 단순 응답 (uptime 모니터링 호환). `Authorization: Bearer <HEALTH_TOKEN>` 시에만 환경변수 설정 상태 등 상세 진단 노출. `HEALTH_TOKEN` 미설정 시 상세 모드 차단.
  - **bcryptjs cost 10 → 12**: 2026 권장 강도. 기존 cost=10 해시는 verify 시 자동 호환 (점진 마이그레이션 불필요).
  - **2FA (TOTP) 옵트인**: `lib/totp.ts` 외부 의존성 없는 RFC 6238 구현 (Google Auth/Authy/1Password 호환). `lib/login-challenge.ts` HMAC 서명 챌린지 토큰(5분). `users` 테이블 `totp_secret`(AES-256-GCM)/`totp_enabled_at` 추가. `/api/account/2fa/{setup,enable,disable}` + `/api/auth/login/totp`. `/account` 페이지 2FA 패널(시크릿+otpauth URL 수동 등록), `/login` 페이지 2단계 폼. 모든 사용자 자율 활성화 가능 (system_admin 권장).
- 2026-05-20 — **비밀번호 정책 12자 → 10자 완화**. `MIN_LENGTH`는 처음부터 10이었으나 문서/CLAUDE.md 표기가 12로 남아 있던 불일치를 해소. 정책 자체(3종+HIBP)는 유지.
- 2026-05-21 — **Phase 6-A 완료** (운영 필수 5건). 토큰 환불 (사유 강제 + 양/음수 양방향), 법인 정보 수정 (uniqueness 가드 + bizno 정규화), 법인 정지/재개 (세션 즉시 만료 + system_admin 우회), sysadmin 권한 부여/회수 (마지막 1명 가드), 강제 로그아웃 (per-user + 전체 "FORCE-LOGOUT-ALL" 가드). 모든 액션 감사 로그 + 새 액션 7개 등록 (tokens.refund/adjust, org.update/suspend/resume, session.force_logout). `organizations` 테이블에 `suspended_at`/`suspended_reason` 컬럼 추가.
- 2026-05-21 — **Phase 6-B 완료** (운영 편의 5건). sysadmin 운영 대시보드 (/admin/dashboard, KPI 5 + 5 섹션), 비번 리셋 메일 강제 발송 (sendPasswordResetMail 재사용), 후보자 cross-org 검색 + PIPA 강제 삭제 (사유 + 식별자 confirm 이중 가드), org_admin 이전 (전용 페이지, 강등 옵션), 감사 로그 CSV export (UTF-8 BOM). 감사 액션 3개 신규 등록 (user.password_reset_email, candidate.admin_delete, org.admin_transfer). 헤더 sysadmin 메뉴에 운영/후보자 링크 추가.

---

## Phase 7 — 디자인 시스템 리뉴얼 (Forest + Ivory, 2026-05-21)

**결정**: 옵션 B (Deep Forest #0D4F3C + Ivory #FBF9F5 + Apricot accent). 시리프 X, Pretendard 산세리프만. 미리보기 페이지 `/preview/option-a` `/preview/option-b` 제공 후 사용자가 B 선택.

**참고 사이트**: Linear customers, Stripe, Anthropic, Ashby, Greenhouse, Lever — 공통점: 시그니처 컬러 절제 사용 + 풍부한 여백 + 타이포 hierarchy + 데이터 dense UI도 숨 쉬게.

### Phase 7-A — 디자인 토큰 + 기반

- [x] **7-A** 디자인 토큰 (2026-05-21) — `app/globals.css` 전면 재정의 (브랜드 컬러 9종 + semantic 8종 + shadow/radius 스케일 + Tailwind v4 `@theme inline` 토큰 등록 `bg-primary` `text-ink-soft` 등 유틸리티). Pretendard 가변폰트 `<link>` 로드 (CSS `@import` 는 tailwindcss 인라인 전개 충돌). `app/layout.tsx` Geist 제거 + 네비/푸터 토큰 적용. 랜딩 hero 톤 적용 (forest 강조 + ivory 배경 + 둥근 사각 CTA).

### Phase 7-B — 코어 화면 리뉴얼 (남음)

- [ ] **7-B-1** 랜딩 페이지 나머지 섹션 (가격·기능·동작방식·CTA) — 옵션 B 톤 적용. 가격 카드는 forest 반전 배경 패턴 사용.
- [ ] **7-B-2** 로그인 / 회원가입 / 비번 리셋 / 이메일 인증 페이지 — 카드형 폼, 둥근 사각 입력, primary 버튼.
- [ ] **7-B-3** 메인 대시보드 (`/`) + 내 법인 페이지들 (`/org/*`) — 기존 KPI 카드·공고 카드 톤 통일.
- [ ] **7-B-4** Admin 페이지 전체 (`/admin/*`) — 테이블·배지·버튼 토큰 일관 적용, 운영 대시보드 시각 강화.
- [ ] **7-B-5** 공고/후보자 페이지 (`/jobs/*`, `/candidates/*`) — 데이터 dense 화면. 표/카드 일관성, 단계 배지 컬러 정리.
- [ ] **7-B-6** 후보자 채팅 면접 화면 (`/interview/*`) — 차분한 톤, 메시지 버블 정돈.

### Phase 7-C — 컴포넌트 추출 + 정리

- [ ] **7-C-1** 자주 쓰는 패턴 추출 — `<Button>`, `<Card>`, `<Badge>`, `<Input>`, `<Table>`, `<Modal>` 을 `app/components/ui/` 에. 페이지에서 인라인 className 반복 줄이기.
- [ ] **7-C-2** 색·간격 사용 일관성 검증 — `slate-*` `blue-*` `emerald-*` `amber-*` 같은 임시 컬러를 토큰으로 일괄 마이그레이션.

### Phase 7-D — 마이크로카피 + 모션 (선택)

- [ ] **7-D-1** 버튼·에러·빈상태 등 한국어 톤 통일 — "...할까요?" 친근체 vs "...하시겠습니까?" 정중체 결정 + 일관 적용.
- [ ] **7-D-2** 미세 transition (hover, focus, page enter) 토큰화. 200ms ease-out 기본.

---

- 2026-05-21 — **Phase 7-A 완료** (디자인 토큰). Forest + Ivory 색 시스템 + Pretendard + 네비/푸터/랜딩 hero 1차 적용. 나머지 화면은 7-B 에서 단계별 진행. `app/preview/{option-a,option-b}` 미리보기 페이지 도입 (proxy.ts public allowlist).
- 2026-05-22 — **Phase A 진행 가속 묶음 완료** (사업자등록·Vercel Pro 외).
  - **A-4 Sentry 가입**: DSN 발급, `.env.production.local` 등록, envelope POST 검증 (test-sentry.mjs HTTP 200). `lib/error-reporter.ts` 의 eventId Math.random 버그 발견·수정 (`crypto.randomBytes(16).toString("hex")`).
  - **A-5 Vercel Blob**: 새 Vercel 계정 (GitHub OAuth) + empty project `intervia` + Blob store `intervia-resumes` (ICN1 서울 region). Private → Public 재생성. `.env.production.local` 등록. test-blob.mjs 업로드/다운로드/삭제 3단계 통과.
  - **A-6 E2E 풀 사이클**: scripts/test-e2e-cycle.mjs 9단계 91.9초 통과. 모델 분기·thinking budget·consent gate·토큰 차감 모두 검증. Pro thinking=128 latency 평균 5.7s.
  - **LLM transient retry 안전망**: `lib/gemini.ts` 에 `withRetry` 헬퍼 + `generateJSON` · `startChatStreamWithRetry` 자동 재시도 (2회 backoff, 503/429/timeout 패턴). E2E 에서 발견된 flash 간헐 503 대응.
  - **HEALTH_TOKEN 발급**: 32B random hex → `.env.production.local`. 운영 진단용 상세 분기 동작 확인.
  - **Production build smoke test**: `npm run build` → `next start -p 3004` → `/api/health` 인증·미인증 분기 + sentry/blob configured 확인.
  - **Resend SMTP 통합 sanity**: test-resend.mjs SMTP verify + 본인 메일 발송 성공 (250 OK). `.env.local` SMTP_FROM 의 닫는 `>` 누락 수정.
  - **.gitignore 정비**: test-fixtures/, legal/, .tmp-dart/ 추가.
  - **PDFKit devDependency 추가**: scripts/make-test-resume.mjs 테스트 PDF 생성용.
- 2026-05-22 — **배포 전 검증 묶음 완료** (LLM 모델 분기 + thinking 튜닝 + 게이트 회귀 테스트).
  - **LLM 모델 분기**: `lib/gemini.ts` MODELS 맵 — screening=flash, interview=pro, interviewEval=pro. 3개 콜사이트 task 명시. GOTCHAS·ARCHITECTURE·CLAUDE.md 갱신.
  - **Thinking budget 튜닝**: 측정 결과 pro 기본 thinking 시 13~15초 (UX 불가). pro 는 thinkingBudget=0 거부. interview 만 `thinkingBudget=128` 적용 → 3~4초로 단축 + 자연스러운 응답 유지. screening/interviewEval 은 default 유지 (비동기, 품질 우선).
  - **업로드 게이트 보안 강화**: JSON manifest 경로에서 consent 체크를 blob fetch **이전** 으로 이동. SSRF 위험 + UX 지연 동시 차단.
  - **회귀 테스트 스크립트 4종 추가**: `verify-deployment-schema.mjs` (DB 컬럼) / `test-gemini.mjs` (paid tier 호출) / `test-gemini-thinking.mjs` (latency 비교) / `test-consent-gate.mjs` (게이트 3 시나리오) / `test-csrf-guards.mjs` (CSRF·public 라우트). 모두 통과.
  - **production 빌드 통과**: `npm run build` ✓ Compiled successfully. 75 정적 페이지 생성, 새 /legal/* 라우트 정상 등록.
  - **시드 스크립트 패치**: `scripts/seed-test.mjs` 의 job_postings closes_at NOT NULL 위반 수정 (Phase 5 라이프사이클 도입 후 깨졌던 부분).
- 2026-05-22 — **법적 컴플라이언스 보강 4건 묶음 완료** (사업자등록·DPA 대기 중 코드/문서로 가능한 P0~P1).
  - **약관 §5 톤다운**: "회사는 면책된다" → "회사 안전조치 의무는 면제 안 됨" + "이용자가 회사를 면책시키고 손해배상" (indemnify). 약관규제법 §6/§7 적합. TERMS_VERSION 1.1.1.
  - **AI 평가 사전공개 페이지** (`/legal/ai-evaluation-disclosure`): §37의2 4항 사전공개 의무 충족. 평가 차원/가중치/사용 모델/인적 검토 절차/정보주체 권리/평가 금지 항목/보유 기간/처리위탁/채용기업 권고 사항. 비로그인 공개. 푸터 링크 추가.
  - **약관·처리방침 동의 IP/UA 기록**: users 테이블에 terms_accepted_ip/ua + privacy_accepted_ip/ua 4컬럼 추가. 3개 가입 라우트(orgs, join-requests, signup-via-invite)에서 자동 기록. 분쟁 시 "동의 안 받았다" 주장에 대한 기술적 입증.
  - **`docs/COMPLIANCE_SOP.md` 운영 SOP**: 사업자등록·DPA 절차 / 분기 동의 취득 실태 점검 (고객사 5곳 표본 + 메일 템플릿) / 침해 사고 72시간 대응 / 자동화 의사결정 이의제기 7영업일 응대 / 정보주체 권리 요청 / 인권위 진정 대응 / 보호위 자료 제출 / 자료 보존 기간 / 변호사 자문 트리거.
- 2026-05-22 — **지원자 동의 취득 책임 전가 메커니즘 (안 1) 완료**. 사람인·잡코리아 등 외부 채용 플랫폼에서 받은 이력서를 본 서비스에 업로드하는 흐름에서 동의 단절 문제 해결.
  - **DB**: `candidates.applicant_consent_confirmed_at` / `applicant_consent_confirmed_by_user_id` 컬럼 추가 (Turso + 로컬 마이그레이션).
  - **업로드 API** (`POST /api/jobs/[id]/candidates`): `applicantConsentConfirmed=true` 필수. 미체크 시 400 + `{code:"applicant_consent_required"}`. multipart + JSON manifest 양쪽 모두. 성공 시 row 에 timestamp/userId 기록 + 감사 로그 `candidate.upload_with_consent`.
  - **평가 API 가드**: `POST /api/candidates/[id]/screen` + `POST /api/candidates/bulk-screen` 에서 동의 NULL row 차단 (2026-05-22 이전 legacy row 면제).
  - **업로드 UI**: jobs/[id] 페이지에 amber 강조 동의 확인 체크박스 + 표준 동의 문구 링크. 미체크 시 업로드 영역 비활성화.
  - **신규 페이지 `/legal/applicant-consent-template`**: 한국어·영어 표준 동의 문구 + 처리위탁 표 + FAQ. 사람인/잡코리아 "추가 동의 항목" 에 복붙 사용. 비로그인 공개.
  - **이용약관 §5 전면 개정**: "지원자 동의 취득 책임" 7개 항목으로 명문화 — Intervia 는 수탁자 지위, 동의 취득 책임은 채용기업, 미취득 시 채용기업이 단독 부담, 회사는 면책. TERMS_VERSION 1.1.0 으로 bump.
  - 감사 액션 `candidate.upload_with_consent` 신규 등록. proxy.ts `/legal/*` public allowlist 추가.
- 2026-06-02 — **HR 워크플로우 보강 4건 묶음 완료** (B-1·B-2 결정 반영).
  - **2차 면접 일정 조율**: `interview_schedules.round` 의 round2 를 실배선. `schedule-propose` 가 `round` 파라미터 수신(round2 는 `round1_passed` 후보 가드, stage 변경 없음). `select`/`confirm`/`meeting-link` 라우트 + 일정/확정/미팅링크 메일·ICS·알림 문구를 차수 인지(1차/2차)로. 후보 상세에 `round1_passed` 일 때 "📅 2차 일정 제시" 진입점(`ScheduleProposeModal round="round2"`). 후보자 일정 페이지 헤딩 차수 인지. **스키마 변경 없음**(round2 enum 기존재).
  - **스코어카드 차수 태그**: `interviewer_notes.round` 컬럼 추가(마이그레이션 `0007`). notes POST 가 round 저장(미지정 시 stage 에서 추론), GET 반환. `InterviewerNotesPanel` 에 1차/2차 토글 + 메모별 차수 배지 + 요약 차수별 건수.
  - **불합격 미통보 일괄 발송**: 후보 목록 API 에 `decisionEmailCount` 노출. jobs/[id] 목록에 "📭 통보 미발송" 배지 + 상단 배너(미발송 N명 + 불합격 필터 + 일괄 발송). `decision-mail` 라우트 6-worker 루프.
  - **법인 채용 현황 대시보드**: `GET /api/org/funnel` (outcome 분리 집계 — 진행 stage 분포 + 결정 outcome 분포 + 총계·최근·활성공고·평균점수). 신규 `/org/dashboard` (KPI + 파이프라인 바 + 결정 현황). NavBar org_admin 메뉴에 "채용 현황" 추가.

---

## Phase 8 — 고객센터 / 문의 접수 (2026-06-04)

**배경**: 고객(법인 HR)이 제품 안에서 버그·결제·사용법을 문의할 채널, 후보자가 면접 중 오류를 신고할 채널이 없었음. 기존 appeal 은 PIPA §37의2 자동화 의사결정 이의제기로 범위가 좁아 일반 불편사항을 못 받음.

- [x] **8-1** `inquiries` 테이블 (마이그레이션 `0013`, source=org_user/candidate 통합) + `lib/inquiry.ts` 상수/라벨 + audit 액션 `inquiry.submit`/`inquiry.status_change`. Turso + 로컬 적용.
- [x] **8-2** 후보자 신고: `POST /api/interview/[token]/inquiry` (본인 이메일 매칭 불요 — 막힌 후보자 차단 방지, RL IP 3/분) + `/interview/[token]/inquiry` 페이지 + 면접 화면 상시 "문제 신고" 링크.
- [x] **8-3** 고객 문의: `POST/GET /api/support/inquiries` (RL 사용자당 5/분) + `/support` 폼 + 본인 문의 내역(상태·답변).
- [x] **8-4** 관리자 인박스: `GET /api/admin/inquiries` + `PATCH /api/admin/inquiries/[id]` (**system_admin 전용** — 고객센터=운영자 데스크) + `/admin/inquiries` (서버 컴포넌트 역할 가드 + redirect, 상태 토글 + 답변, open 우선). 답변은 고객 문의 내역에 노출.
- [x] **8-5** 진입점: NavBar(sysadmin "문의함" / org "고객센터" / 모바일 공통) + Footer "고객센터"(로그인 시) + 접수 시 지원 이메일 통지 (`lib/inquiry-notify.ts`).

검증: tsc 통과(소스 0 에러), dev 서버에서 후보자 신고·고객 문의 접수·관리자 답변→고객 내역 반영 풀 라운드트립 확인.

- 2026-06-04 — **Phase 8 고객센터 5건 묶음 완료**. `inquiries` 단일 테이블로 고객/후보자 출처 통합, 후보자(`/interview/[token]/inquiry`)·고객(`/support`)·관리자(`/admin/inquiries`) 3채널 + 지원 메일 통지. appeal 패턴 재사용(인박스·통지·감사). 마이그레이션 0013 Turso+로컬 적용.
- 2026-06-04 — **Phase 8 보강 2건**. ① `/admin/inquiries` **system_admin 전용**으로 잠금(서버 컴포넌트 역할 가드 + redirect, API 403). 고객센터=운영자 데스크, org_admin 은 `/support` 제출만. ② `/support`·`/admin/inquiries` **게시판+팝업 리디자인** — 행당 1줄 테이블(누적 대비), `/support` 는 "문의하기" 버튼→폼 모달, 양쪽 행 클릭→상세 모달(관리자는 상태 토글+답변). 공용 `app/components/Modal.tsx` 신규.

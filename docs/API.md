# API Endpoints

전부 Next.js Route Handler (`app/api/.../route.ts`). 모두 `runtime = 'nodejs'`.

표기: 🔒 = 로그인 필요, 🏢 = 테넌트 격리 (org_id 가드), 🔑 = 공고 PIN 잠금 (system_admin 우회), 👑 = system_admin 전용, 🛡️ = org_admin / system_admin, 🎫 = 면접 토큰 인증, 🌐 = 공개

## 인증

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/auth/status` | 🌐 | 현재 user + setupRequired |
| POST | `/api/auth/setup` | 🌐 | (레거시) 첫 사용자 생성 |
| POST | `/api/auth/signup` | 🌐 | **410 Gone** — `/api/orgs` 또는 `/api/orgs/join-requests` 사용 |
| POST | `/api/auth/check-email` | 🌐 | `{email}` → `{available, matchedOrg?, isPublicDomain, suggestion}` |
| POST | `/api/auth/login` | 🌐 | 미인증 시 403 + `{code:"email_unverified"}`. pending/disabled 도 403. **429 + `{code:"rate_limited", retryAfterSeconds}`** — email 15분 5회 실패 또는 IP 20회 실패 시 15분 잠금 |
| POST | `/api/auth/verify-email` | 🌐 | `{token}` → 인증 토큰 소비. 성공 시 `email_verified_at` 기록 |
| POST | `/api/auth/resend-verification` | 🌐 | `{email}` → 미인증 사용자에게 메일 재발송 (존재 여부 노출 X) |
| POST | `/api/auth/logout` | 🔒 | |
| POST | `/api/auth/change-password` | 🔒 | 10자+3종+HIBP 정책. 동일 비번 거부 |
| DELETE | `/api/account` | 🔒 | **본인 계정 탈퇴** (되돌릴 수 없음). `{password, code?, confirm:이메일}`. 2FA 켜져 있으면 `code` 필수. system_admin·법인 유일 관리자(다른 멤버 존재 시)는 409 차단. FK CASCADE 정리, 작성 공고·후보자는 SET NULL 보존 |
| GET | `/api/auth/sessions` | 🔒 | 본인 활성 세션 목록. `displayId` (토큰 앞 12자) + ip/browser/lastSeenAt |
| DELETE | `/api/auth/sessions/[displayId]` | 🔒 | 특정 세션 원격 종료. 현재 세션 거부 |
| POST | `/api/auth/sessions/revoke-others` | 🔒 | 현재 세션 제외 일괄 종료 |

## 감사 로그 / 메트릭 / 헬스

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/admin/audit` | 🔒 🏢 (admin) | 감사 로그 조회. query: `days`, `action`, `orgId` |
| GET | `/api/admin/appeals` | 🔒 🏢 (admin) | 자동화 의사결정 이의제기 개요 (PIPA §37의2). system_admin=전체 / org_admin=자기 법인. query: `status`(pending/reviewed/resolved/rejected). pending 우선 정렬 + `pendingCount`. DPO 알림 메일이 링크하는 `/admin/appeals` 페이지 데이터 소스 |
| GET | `/api/admin/inquiries` | 🔒 👑 (sysadmin) | 고객센터 문의 인박스 — **system_admin 전용**. query: `status`(open/in_progress/resolved). open 우선 정렬 + `openCount` |
| PATCH | `/api/admin/inquiries/[id]` | 🔒 👑 (sysadmin) | 문의 상태/답변 업데이트 — **system_admin 전용**. body: `{status?, adminNote?}`. resolved 전환 시 resolved_at/by 세팅. adminNote 는 고객 문의 내역에 노출 |
| GET | `/api/admin/announcements` | 🔒 👑 (sysadmin) | 공지 발송 폼용 — 예상 수신자(활성 사용자) 수 `{activeUsers}` |
| POST | `/api/admin/announcements` | 🔒 👑 (sysadmin) | 운영 공지 발송. body: `{title(2~200자), href?(내부 경로 '/'시작)}`. 전체 활성 사용자에게 인앱 알림(type=`announcement`) fanout. 응답 `{sent}`. 발송 시점 활성 사용자만 수신·회수 없음 |
| GET | `/api/admin/metrics` | 🔒 🏢 (admin) | 운영 메트릭 — totals / stages / queue / interviews / tokenUsage / perOrg / recentCrossOrg |
| GET | `/api/health` | 🌐 | DB·env 헬스체크. 200 정상 / 503 실패. 외부 모니터링 호환 |

## 법인 / 가입 / 합류

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/api/orgs` | 🌐 | 신규 법인 + 첫 사용자 동시 생성. 첫 사용자=org_admin, wallet=0, 즉시 로그인 |
| GET | `/api/orgs/search?q=` | 🌐 | 회사명/사업자번호 LIKE 검색 (2자 이상) |
| POST | `/api/orgs/join-requests` | 🌐 | 비로그인 가입 + 합류 요청. user.status=pending |
| GET | `/api/orgs/join-requests?orgId=&status=` | 🛡️ | 자기 법인 합류 요청 목록 |
| PATCH | `/api/orgs/join-requests/[id]` | 🛡️ | `{action: 'approve'|'reject'}` |
| GET | `/api/orgs/members?orgId?` | 🛡️ | 자기 법인 멤버 (system_admin은 orgId 지정 가능) |
| GET | `/api/orgs/tokens?orgId?` | 🔒 | 자기 법인 잔액 + ledger + 현재 단가 |

## 사용자

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| PATCH | `/api/users/[id]` | 🛡️ | `{role?, status?}`. system_admin 부여는 system_admin만. 마지막 org_admin 박탈/비활성화 차단. **`SYSTEM_ADMIN_EMAIL` 로 지정된 보호 계정은 변경 불가 (403)** — 운영 락아웃 방지 |

## 공고 (Jobs)

전부 🔒 🏢. PIN 잠금 가드 🔑 는 system_admin 우회.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/jobs` | 자기 법인 공고 + 통계. system_admin은 전체 |
| POST | `/api/jobs` | 공고 생성. **`job_post` 토큰 차감** |
| GET | `/api/jobs/[id]` | 🔑 |
| PUT | `/api/jobs/[id]` | 🔑 |
| DELETE | `/api/jobs/[id]` | 🔑 + cascade. **생성 5분 내 삭제 시 자동 환불** |
| POST | `/api/jobs/[id]/unlock` | PIN 잠금 해제 쿠키 세팅 |

## 후보자 (Candidates)

전부 🔒 🏢.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/jobs/[id]/candidates` | 🔑 후보자 목록 + 최근 면접 세션 머지 |
| GET | `/api/jobs/[id]/round1-schedule` | 🔑 `stage=round1_waiting` + 확정 schedule(`status=selected`, round1) 조인 → 후보자별 선택 슬롯·온오프라인·주소, 시간 빠른 순. "1차 면접 스케쥴 보기" 팝업용 |
| POST | `/api/jobs/[id]/schedule-propose` | 🔑 후보자 다수에게 면접 슬롯 제시 + 메일. `round`(round1/round2, 기본 round1) — **round2 는 `round1_passed` 후보만** 가드, stage 변경 없음(round1 은 round1_scheduling 으로 전환) |
| GET | `/api/org/funnel` | 🔒 🏢 (admin) 법인 채용 퍼널 — 진행 stage 분포(outcome NULL) + 결정 outcome 분포 + 총계·최근 N일·활성공고·진행중 평균 서류점수. `/org/dashboard` 용 |
| POST | `/api/jobs/[id]/candidates` | 🔑 multipart 또는 JSON manifest 업로드. **`applicantConsentConfirmed=true` 필수** — 미체크 시 400 + `{code:"applicant_consent_required"}`. 채용기업이 지원자 동의 취득 책임 확인. 업로드 후 자동 큐 enqueue (과금은 평가 성공 시 후차감). 감사 로그 `candidate.upload_with_consent` |
| POST | `/api/candidates/[id]/screen` | 수동 트리거 (신규 평가 + **재평가** + **재시도 대기 즉시 재시도** 공용). 백그라운드 LLM 평가. **과금은 평가 성공 시 후차감** (오류면 과금 X). 동작: `processing`→409, `queued`(백오프 포함)→새 job 안 만들고 백오프 해제 후 즉시 재시도, 그 외(done/failed/미시작)→새 job enqueue. **지원자 동의 확인 누락(2026-05-22 이후 row) 시 400** |
| GET | `/api/candidates/[id]` | 🔑 |
| DELETE | `/api/candidates/[id]` | 후보자 + 파일 삭제 |
| POST | `/api/candidates/[id]/interview-link` | 새 면접 세션 + 링크 발급 (차감 없음 — 지원자 면접 시작 시 과금) |
| GET | `/api/candidates/[id]/interview-questions` | 저장된 1차 면접 질문지 + `scheduleConfirmed`(1차 일정 확정 여부) 반환. 없으면 `sheet:null` |
| POST | `/api/candidates/[id]/interview-questions` | 1차 면접 질문지 **생성/재생성**(무료). 게이트: round1 일정 `selected` 아니면 409. 이력서+서류평가+AI면접 평가 종합 LLM(task=questionGen) → 후보자당 1건 upsert. 감사 `interview_questions.generate` |

## 면접 (외부 — 후보자용)

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/interview/[token]` | 🎫 | 세션 + 후보자 + 공고 |
| GET | `/api/interview/[token]` | 🎫 | 세션 정보. 미동의 시 `consentRequired:true` + `consentItems[]` |
| POST | `/api/interview/[token]/consent` | 🎫 | 후보자 동의 기록 + **`interview` 차감** (면접 실제 시작 시점, 멱등). 필수 항목 누락 시 400 `{code:"consent_missing", missing}`. IP/UA/version 자동 기록 |
| POST | `/api/interview/[token]/chat` | 🎫 | 스트리밍 응답. **동의 없으면 403 `{code:"consent_required"}`** |
| POST | `/api/interview/[token]/complete` | 🎫 | 평가 LLM + 저장. **동의 없으면 403** |
| POST | `/api/interview/[token]/appeal` | 🎫 | 자동화 의사결정 이의제기. body: `{email, reason}`. 본인 이메일 매칭 + 사유 10~5000자. DPO 알림 메일 (실패해도 제출 성공). Rate limit IP 3/분 |
| POST | `/api/interview/[token]/inquiry` | 🎫 | 면접 중 문제 신고/문의. body: `{email, category, message}`. 본인 이메일 매칭 **불요**(막힌 후보자 차단 방지) + 내용 5~5000자. 지원 메일 통지 (실패해도 제출 성공). Rate limit IP 3/분 |
| POST | `/api/interview/[token]/me` | 🎫 | 후보자 본인 데이터 열람 (PIPA §35). body: `{email}` 본인 확인 후 보유 항목 요약 |
| DELETE | `/api/interview/[token]/me` | 🎫 | 후보자 본인 데이터 즉시 폐기 (PIPA §36). body: `{email}`. 이력서 본문·파일·전화 삭제, 평가 결과 보존 |
| GET | `/api/candidates/[id]/appeals` | 🔒 🏢 | 후보자별 이의제기 목록 |
| PATCH | `/api/candidates/[id]/appeals/[appealId]` | 🔒 🏢 | 상태/내부메모 업데이트. status: pending/reviewed/resolved/rejected |
| POST | `/api/support/inquiries` | 🔒 | 로그인 고객 고객센터 문의 접수. body: `{category, message}`. 회신 이메일=계정 이메일. Rate limit 사용자당 5/분 |
| GET | `/api/support/inquiries` | 🔒 | 본인이 접수한 문의 내역(상태·답변 포함) |

## 이메일 / 업로드

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/api/interview-sessions/[id]/send-email` | 🔒 🏢 | 면접 링크 발송 — 후보자 법인의 SMTP 설정 우선, 없으면 환경변수 SMTP |
| GET | `/api/uploads/candidate/[id]` | 🔒 🏢 | **권장 다운로드 경로** — 세션 + ownsOrg + 부모 공고 PIN 잠금 검증 후 stream proxy. Blob URL 도 우리 함수가 fetch 해서 외부 직접 노출 X |
| GET | `/api/uploads/[file]` | 🔒 | (deprecated) 로컬 파일 서빙. 로그인 필수, Blob URL 거부 |

## 법인 SMTP

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/orgs/smtp` | 🏢 (admin) | 법인 SMTP 설정 조회 (비밀번호 마스킹) |
| PUT | `/api/orgs/smtp` | 🏢 (admin) | 저장 + `transporter.verify()` 헬스체크. 결과 `{ok, error}`. 헬스체크 실패해도 저장은 진행 |
| DELETE | `/api/orgs/smtp` | 🏢 (admin) | 설정 삭제 (이후 환경변수 fallback) |

## 후보자 일괄 작업

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/api/candidates/bulk-delete` | 🔒 🏢 | `{ids:number[]}` — 타 법인 ID 포함 시 전체 거부 |
| POST | `/api/candidates/bulk-screen` | 🔒 🏢 | `{ids:number[]}` — 평가/재평가 일괄 (과금은 성공 시 후차감). 완료/미평가→enqueue, `queued`(재시도 대기)→백오프 해제(즉시 재시도), `processing`/`paused`→skip. 응답 `{enqueued, kicked, skipped, details}` |
| PATCH | `/api/candidates/[id]/stage` | 🔒 🏢 | `{stage, outcome?, outcomeReason?, note?, sendNotification?, customMessage?}` — 단계 변경. 단말(hired/rejected/withdrawn) 도달 시 자동 폐기 + (옵션) 통보 메일. **outcome=rejected 는 `outcomeReason`(목록값) 필수** — 없으면 `400 {code:"reason_required"}` (PIPA §37의2 인적검토 근거 기록). 응답 `{stage, terminal, purged, mail}` |
| GET | `/api/candidates/[id]/notes` | 🔒 🏢 | 면접관 메모 목록 (같은 법인 누구나 조회) |
| POST | `/api/candidates/[id]/notes` | 🔒 🏢 | `{scores?, note?, interviewSessionId?}` 메모/스코어카드 작성. 본인 row 생성 |
| PATCH | `/api/candidates/[id]/notes/[noteId]` | 🔒 🏢 | 본인 작성 메모 수정 |
| DELETE | `/api/candidates/[id]/notes/[noteId]` | 🔒 🏢 | 본인 작성 메모 삭제 |
| GET | `/api/candidates/[id]/assignments` | 🔒 🏢 | 배정된 면접관 목록 |
| POST | `/api/candidates/[id]/assignments` | 🔒 🏢 | `{userId}` 같은 법인 멤버를 면접관으로 배정 |
| DELETE | `/api/candidates/[id]/assignments/[aid]` | 🔒 🏢 | 배정 해제 |
| GET | `/api/jobs/[id]/funnel` | 🔒 🏢 | 공고 채용 깔때기 — `{stages, total, avgScreeningScore, countWithScreeningScore}` |
| GET | `/api/jobs/[id]/candidates/export` | 🔒 🏢 | CSV 다운로드 (UTF-8 BOM, 14컬럼) |

## 서류 평가 큐 (내부/cron)

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/api/candidates/[id]/screen` | 🔒 🏢 | 단건 평가/재평가 큐 등록 (과금은 성공 시 후차감) + 워커 즉시 트리거 |
| POST/GET | `/api/internal/process-screenings` | 🔒 (X-Internal-Secret 또는 X-Vercel-Cron 또는 system_admin) | 큐 워커. 동시성 N, 최대 M건, 잔여 시 self-chain |
| GET/POST | `/api/cron/process-screenings` | 🔒 (CRON_SECRET 또는 X-Vercel-Cron 또는 system_admin) | 분당 워커 호출 안전망 |

## Cron / 시스템 작업

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET/POST | `/api/cron/expire-interviews` | 🌐 (CRON_SECRET) 또는 👑 | 만료된 면접 세션 → `expired` 처리 + 미시작 분만 환불. Vercel Cron schedule = `0 * * * *` (시간당) |
| GET/POST | `/api/cron/purge-original` | 🌐 (CRON_SECRET) 또는 👑 | 평가 완료 + N일 경과 후보자의 `resume_text` 와 파일 삭제 (PIPA 가명처리). `?days=N` 으로 오버라이드. Vercel Cron schedule = `30 3 * * *` (매일 03:30). 디폴트 `PURGE_AFTER_DAYS=30` |
| GET/POST | `/api/cron/interview-reminders` | 🌐 (CRON_SECRET) 또는 👑 | 확정 면접(`status='selected'`) 24시간 전 면접관 전원에게 리마인더 메일 1회 발송 후 `interview_schedules.interviewer_reminder_sent_at` 기록(중복 방지). Vercel Cron schedule = `0 * * * *` (시간당) |

인증: `Authorization: Bearer ${CRON_SECRET}` 헤더 또는 system_admin 로그인. Vercel Cron은 `x-vercel-cron: 1` 헤더로 자동 호출.

## 시스템 관리자 전용

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/admin/orgs` | 👑 | 전체 법인 + 잔액/멤버수/공고수 |
| GET | `/api/admin/users?q=` | 👑 | 전 사용자 검색. **`SYSTEM_ADMIN_EMAIL` 로 지정된 보호 계정은 목록에서 제외** (사용자 관리 화면 비노출) |
| GET | `/api/admin/pricing` | 🔒 | 단가 조회 (전 로그인 사용자) |
| PATCH | `/api/admin/pricing` | 👑 | `{job_post?, resume_upload?, interview?}` 0 이상 정수 |
| POST | `/api/admin/orgs/[id]/grant-tokens` | 👑 | `{delta, memo?}` 수동 충전/조정 (admin_adjust ledger) |
| DELETE | `/api/admin/orgs/[id]` | 👑 🔐 | 법인 영구 삭제. **정지(suspended) 상태만**. `{reason(5자+), confirm=법인명}`. 멤버 계정도 함께 삭제(system_admin 멤버는 분리). 후보자 파일 폐기 + cascade. 감사 로그 보존 |
| DELETE | `/api/admin/candidates/[id]` | 👑 🔐 | 후보자 영구 삭제 (PIPA 권리요청). `{reason(5자+), confirm=이메일/이름}`. cross-org |
| DELETE | `/api/users/[id]` | 👑 🔐 | 계정 영구 삭제. 기본은 **비활성(disabled) 상태만**. `{reason(5자+), confirm=이메일, force?}` — **`force:true` 면 활성/대기 계정도 즉시 삭제**(사용자 관리 "강제 삭제" 버튼; 마지막 org_admin 정리용). 본인·system_admin·**`SYSTEM_ADMIN_EMAIL` 보호 계정** 불가 |

🔐 = step-up 인증(비밀번호 재입력) 필수.

## 응답 코드 컨벤션

| 코드 | 사용 |
|---|---|
| 200 | JSON 데이터 |
| 204 | 성공 + 본문 없음 |
| 302 | uploads → blob URL |
| 400 | 입력 검증 실패 |
| 401 | 미인증 |
| 403 | 권한 없음 / 공고 잠김 / pending 또는 disabled 계정 로그인 시도 |
| 404 | 리소스 없음 (다른 법인 리소스도 404로 위장) |
| 409 | 중복 / 마지막 관리자 박탈 시도 / 도메인 충돌 |
| 410 | deprecated 엔드포인트 (auth/signup) |
| 500 | LLM / SMTP / DB 오류 |

## proxy.ts (미들웨어) 매처

```
/((?!login|signup|verify|interview|api/auth|api/interview|api/uploads|api/orgs|api/cron|_next/static|_next/image|favicon.ico).*)
```

`api/orgs/**` 는 미들웨어 우회 (가입 흐름 공개). 인증은 각 라우트의 `getCurrentUser()` + `requireUser()` 에서 처리.

## 토큰 차감 / 환불 정책 요약

| 이벤트 | 시점 | 사유 키 | ref | 환불 트리거 |
|---|---|---|---|---|
| 공고 생성 | 200 직전 | `job_post` | `job:id` | 5분 내 DELETE |
| 이력서 업로드 | (차감 없음) | - | - | - |
| 서류 평가 / 재평가 | **평가 성공 시 (후차감)** | `resume_upload` | `screening_job:id` | 환불 없음 — 오류/재시도는 애초에 과금 안 됨. 재평가는 새 job 이라 성공마다 1건 |
| 면접 링크 발급 | 200 직전 | `interview` | `interview_session:id` | cron `/api/cron/expire-interviews` 가 시간당 호출 — 미시작 만료만 자동 환불 |
| 관리자 충전 | 즉시 | `admin_adjust` | - | 별도 PATCH 호출로 -delta |

`chargeFeature`/`refundFeature` 모두 `(org, reason, refType, refId)` 단위 멱등.

## 호출 예시 (curl)

```bash
# 이메일 중복확인
curl -X POST http://localhost:3003/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"new@example.com"}'

# 신규 법인 등록 + 첫 사용자
curl -c jar.txt -X POST http://localhost:3003/api/orgs \
  -H 'Content-Type: application/json' \
  -d '{"orgName":"ACME","email":"admin@acme.co.kr","password":"Test1234!","name":"홍길동"}'

# 단가 조회
curl -b jar.txt http://localhost:3003/api/admin/pricing

# 토큰 잔액
curl -b jar.txt http://localhost:3003/api/orgs/tokens
```

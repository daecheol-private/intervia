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
| POST | `/api/auth/password-reset/request` | 🌐 | `{email}` → 재설정 메일 발송 (토큰 1시간 유효, 사용자당 활성 토큰 1개). 존재 여부 노출 X — 항상 `{ok:true}`, active 사용자만 실제 발송. Rate limit IP 3분 3회 |
| GET | `/api/auth/password-reset/confirm?token=` | 🌐 | 토큰 유효성 사전 확인 → `{valid}` (재설정 페이지 진입용, 사용자 정보 노출 X) |
| POST | `/api/auth/password-reset/confirm` | 🌐 | `{token, newPassword}` → 새 비밀번호 설정 (10자+3종+HIBP 정책). 성공 시 `mustChangePassword` 해제 + **전체 세션 무효화** |
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
| POST | `/api/orgs` | 🌐 | 신규 법인 + 첫 사용자 동시 생성. 첫 사용자=org_admin. **세션 미발급** — `verificationRequired:true` 반환, 이메일 인증 후 로그인. 신규 법인은 **웰컴 보너스 500토큰** 자동 지급(`grantWelcomeBonus`, orgId 멱등). 공용 도메인 이메일은 400 차단 |
| GET | `/api/orgs/search?q=` | 🌐 | 회사명/사업자번호 LIKE 검색 (2자 이상) |
| POST | `/api/orgs/join-requests` | 🌐 | 비로그인 가입 + 합류 요청. user.status=pending |
| GET | `/api/orgs/join-requests?orgId=&status=` | 🛡️ | 자기 법인 합류 요청 목록 |
| PATCH | `/api/orgs/join-requests/[id]` | 🛡️ | `{action: 'approve'|'reject'}` |
| GET | `/api/orgs/members?orgId?` | 🛡️ | 자기 법인 멤버 (system_admin은 orgId 지정 가능) |
| GET | `/api/orgs/tokens?orgId?` | 🔒 | 자기 법인 잔액 + ledger + 현재 단가 |
| POST | `/api/orgs/tokens/checkout` | 🏢 (admin) | 토스 결제 시작 — `{amountKrw}`(허용 패키지만, `CHARGE_PACKAGES`). pending `payment_orders` 생성 후 `{orderId(=IV-{id}), amount, orderName, customerEmail, customerName}` 반환. 토큰 지급은 confirm 에서 |
| POST | `/api/orgs/tokens/confirm` | 🏢 (admin) | 결제 성공 리다이렉트 후 승인 — `{paymentKey, orderId, amount}`. 금액은 **DB값(권위)** 으로 토스 승인 → `applyChargePayment`(멱등) 로 토큰 지급. 금액 위변조 400 / 미존재·타법인 404 / 승인실패 402(주문 failed) / 이미 paid 면 멱등 성공 |
| GET | `/api/orgs/me/setup-progress` | 🔒 | 첫 실행 가이드 진행 상태 `{show, step1~4, firstJobId}` — 플로팅 위젯(`SetupGuideWidget`)용. 단계 판정은 대시보드 setup1~4 와 동일. `show`는 완료 여부와 무관 — 본인의 `users.setup_guide_dismissed_at` NULL 인 동안 true. system_admin/무소속은 `{show:false}` |
| POST | `/api/orgs/me/setup-progress` | 🔒 | 가이드 숨기기 — 본인 `users.setup_guide_dismissed_at` 기록 (**개인 단위** — 본인 화면의 hero/strip/플로팅만 사라짐, 다른 구성원엔 영향 없음. 멤버도 가능) |
| GET | `/api/orgs/me/tour-targets` | 🔒 | 인터랙티브 가이드(둘러보기) 대상 `{firstJobId, screenedCandidateId}` — 시작 가이드 단계(`guide-steps`) 런처용. 이력서 업로드 시나리오가 이동할 최신 공고 + AI 면접 시나리오 대상(`stage='screened'` 미종결 후보). 없으면 해당 시나리오 비활성. system_admin/무소속은 둘 다 null. **멤버는 접근 가능한 공고(PIN 없거나 본인이 면접관)로 한정** — 접근 불가 대상으로 안내해 따라하기→403→무한 리다이렉트 나던 것 방지 (`isAdmin`은 전체) |
| GET | `/api/orgs/me/member-guides` | 🔒 | 멤버(면접관)가 본 페이지 가이드 키 `{seen: string[]}` — 멤버 전용(그 외 빈 배열). 멤버는 순차 온보딩 대신 공고/후보 페이지 첫 진입 시 자동 가이드 1회, 본 뒤로는 안 뜸 |
| POST | `/api/orgs/me/member-guides` | 🔒 | 가이드 봤음 기록 — `{key}`(`job_page`/`candidate_page`)를 `users.seen_member_guides`에 누적(멱등). 멤버 전용 |
| GET/PUT | `/api/orgs/me/culture-fit` | 🔒 / 🛡️ | 컬처핏 프로필 조회·저장 (`CultureFitProfile` — 인재상 + 정성 항목 6종). Big Five 선호 특성은 공고 단위로 이동 (`job_postings.trait_profile`) — 법인 JSON 의 `traitProfile` 은 레거시·미사용 |

## 사용자

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| PATCH | `/api/users/[id]` | 🛡️ | `{role?, status?}`. system_admin 부여는 system_admin만. 마지막 org_admin 박탈/비활성화 차단. **`SYSTEM_ADMIN_EMAIL` 로 지정된 보호 계정은 변경 불가 (403)** — 운영 락아웃 방지 |

## 공고 (Jobs)

전부 🔒 🏢. PIN 잠금 가드 🔑 는 system_admin 우회.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/jobs` | 자기 법인 공고 + 통계. system_admin은 전체 |
| POST | `/api/jobs` | 공고 생성. **`job_post` 토큰 차감**. body `traitProfile?`(Big Five 선호 특성 — high 최대 3개, 초과 400) |
| GET | `/api/jobs/[id]` | 🔑 |
| PUT | `/api/jobs/[id]` | 🔑. `traitProfile` 키가 있을 때만 갱신 (high 최대 3개) |
| DELETE | `/api/jobs/[id]` | 🔑 + cascade. **생성 5분 내 삭제 시 자동 환불** |
| POST | `/api/jobs/[id]/unlock` | PIN 잠금 해제 쿠키 세팅 |

## 후보자 (Candidates)

전부 🔒 🏢.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/jobs/[id]/candidates` | 🔑 후보자 목록 + 최근 면접 세션 머지 + `round1ScheduleStatus`/`round2ScheduleStatus`(라운드별 최신 활성 스케줄 상태 — 응답 대기 vs 역제시 구분, 1차/2차 대기 그룹 분리용). 목록 페이지는 `?stage=counter_proposed` pseudo 필터로 역제시 건만 표시 가능 (대시보드 역제시 알림 딥링크) |
| GET | `/api/jobs/[id]/round1-schedule` | 🔑 확정 면접 일정(1·2차 통합) — `status=selected` + `outcome IS NULL` + (round1·`stage=round1_waiting` OR round2·`stage=round1_passed`) 조인 → 후보자별 `round`·선택 슬롯·온오프라인·주소, 시간 빠른 순. "면접 일정" 팝업용 (라우트 경로는 호환 위해 유지) |
| POST | `/api/jobs/[id]/schedule-propose` | 🔑 후보자 다수에게 면접 슬롯 제시 + 메일. `round`(round1/round2, 기본 round1) — **round2 는 `round1_passed` 후보만** 가드, stage 변경 없음(round1 은 round1_scheduling 으로 전환). 같은 시간대 다수 후보 확정 허용 — 더블부킹 검사 없음 (2026-06-12) |
| POST | `/api/candidates/[id]/schedule-manual` | 🔑 전화 등으로 협의된 1·2차 면접 시간을 제시 절차 없이 **즉시 확정 등록**(`status=selected`). body `{round?, slot, modeOnline?, address?, notifyCandidate?}`. round2 는 `round1_passed` 후보만, round1 은 stage→round1_waiting. `notifyCandidate` 시 후보자 확정 메일(줌 연동 시 자동 생성), 면접관 인앱 알림 fanout. 🪙 잔액 0 이하 402 |
| GET | `/api/org/funnel` | 🔒 🏢 (admin) 법인 채용 퍼널 — 진행 stage 분포(outcome NULL) + 결정 outcome 분포 + 총계·최근 N일·활성공고·진행중 평균 서류점수. `/org/dashboard` 용 |
| POST | `/api/jobs/[id]/candidates` | 🔑 multipart 또는 JSON manifest 업로드. **`applicantConsentConfirmed=true` 필수** — 미체크 시 400 + `{code:"applicant_consent_required"}`. 채용기업이 지원자 동의 취득 책임 확인. 업로드 후 자동 큐 enqueue (과금은 평가 성공 시 후차감). 감사 로그 `candidate.upload_with_consent` |
| POST | `/api/candidates/[id]/screen` | 수동 트리거 (신규 평가 + **재평가** + **재시도 대기 즉시 재시도** 공용). 백그라운드 LLM 평가. **과금은 평가 성공 시 후차감** (오류면 과금 X). 동작: `processing`→409, `queued`(백오프 포함)→새 job 안 만들고 백오프 해제 후 즉시 재시도, 그 외(done/failed/미시작)→새 job enqueue. **지원자 동의 확인 누락(2026-05-22 이후 row) 시 400** |
| GET | `/api/candidates/[id]` | 🔑 |
| DELETE | `/api/candidates/[id]` | 후보자 + 파일 삭제 |
| POST | `/api/candidates/[id]/interview-link` | 새 면접 세션 + 링크 발급 (**차감 없음**). 🪙 잔액 0 이하면 402. interview 과금은 발급·동의·시작이 아니라 **면접 평가(`complete`/`reevaluate`) 성공 시 후차감** |
| GET | `/api/candidates/[id]/attachments` | 첨부 목록 (메인 이력서 kind=resume 포함) |
| POST | `/api/candidates/[id]/attachments` | 첨부 추가 (multipart `file`, `kind?`=career_history/portfolio/cover_letter/other). 추가 시점에 파싱+마스킹 — 기존 평가엔 미반영, **재평가 시 포함**. 결정된 후보·원본 폐기 후보 409. 10MB 상한. 감사 `candidate.attachment_add` |
| DELETE | `/api/candidates/[id]/attachments/[aid]` | 첨부 삭제 (kind=resume 불가). 기존 평가에서 빼려면 재평가 필요. 감사 `candidate.attachment_delete` |
| GET | `/api/candidates/[id]/interview-questions?round=round1\|round2` | 저장된 해당 라운드 면접 질문지 + `scheduleConfirmed`(해당 라운드 일정 확정 여부) + `status`(`generating`/`ready`/`failed`/null) + `error` 반환. round 생략 시 round1. `sheet` 는 status=`ready` 일 때만(생성 중 placeholder 미노출). `generating` 이 stale(>5분)이면 `failed` 로 노출 |
| POST | `/api/candidates/[id]/interview-questions?round=round1\|round2` | 면접 질문지 **비동기 생성/재생성** — row 를 `status=generating` 으로 표시 후 즉시 **202** 반환, `after()` 가 백그라운드에서 LLM·저장·과금 수행(생성 중 새로고침/이탈해도 진행 유지, 완료 시 GET 폴링이 자동 반영, 실패 시 `status=failed`+`gen_error`). 이미 생성 중(stale 아님)이면 새 생성 안 띄우고 202. **`interview_question_gen` 토큰 차감(기본 5, 라운드 동일 단가, after 안에서 생성 성공 시 후차감 — 재생성·라운드 추가 생성도 매번 과금, `chargeRepeatable` 회차 refType `candidate`/`candidate_re{N}` 라운드 합산)**. 게이트: 해당 라운드 일정 `selected` 아니면 409. 입력: 이력서+서류평가+AI면접 평가+법인 컬쳐핏 기준(있으면) 종합 LLM(task=questionGen) — round1=실무, round2=임원(컬쳐핏·인재상 중심) 프롬프트 → 후보자당 라운드별 1건 upsert. 감사 `interview_questions.generate`(metadata.round) |

## 면접 (외부 — 후보자용)

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/interview/[token]` | 🎫 | 세션 + 후보자 + 공고. 미동의 시 `consentRequired:true` + `consentItems[]`. 법인 컬처핏 설정 시 `personality:{required, items:[{id,a,b}]}` (강제선택형 — 진술 쌍만, 특성 태그 비노출). 세션 응답에서 인성검사 원응답·프로필 제거 |
| POST | `/api/interview/[token]/consent` | 🎫 | 후보자 동의 기록. **차감 없음** — interview 과금은 여기가 아니라 `complete`/`reevaluate` 평가 성공 시 후차감(`chargeRepeatable`). 필수 항목 누락 시 400 `{code:"consent_missing", missing}`. IP/UA/version 자동 기록 |
| POST | `/api/interview/[token]/personality` | 🎫 | 인성검사 응답 제출. body: `{responses:[{itemId, value:1\|2}], elapsedMs?}` (강제선택 — 1=a, 2=b). 서버 결정적 채점(`lib/personality.ts`) 후 세션에 저장. 멱등(재제출 시 최초 결과 유지). 동의 없으면 403. Rate limit 토큰 5/분 |
| POST | `/api/interview/[token]/chat` | 🎫 | 스트리밍 응답. **동의 없으면 403 `{code:"consent_required"}`**. 법인 컬처핏 설정 + 검사 미완료 + 첫 턴이면 403 `{code:"personality_required"}` |
| POST | `/api/interview/[token]/complete` | 🎫 | 평가 LLM + 저장. **동의 없으면 403** |
| POST | `/api/interview/[token]/appeal` | 🎫 | 자동화 의사결정 이의제기. body: `{email, reason}`. 본인 이메일 매칭 + 사유 10~5000자. DPO 알림 메일 (실패해도 제출 성공). Rate limit IP 3/분 |
| POST | `/api/interview/[token]/inquiry` | 🎫 | 면접 중 문제 신고/문의. body: `{email, category, message}`. 본인 이메일 매칭 **불요**(막힌 후보자 차단 방지) + 내용 5~5000자. 지원 메일 통지 (실패해도 제출 성공). Rate limit IP 3/분 |
| POST | `/api/interview/[token]/me` | 🎫 | 후보자 본인 데이터 열람 (PIPA §35). body: `{email}` 본인 확인 후 보유 항목 요약 |
| DELETE | `/api/interview/[token]/me` | 🎫 | 후보자 본인 데이터 즉시 폐기 (PIPA §36). body: `{email}`. 이력서 본문·파일·전화 삭제, 평가 결과 보존 |
| GET | `/api/candidates/[id]/appeals` | 🔒 🏢 | 후보자별 이의제기 목록 |
| PATCH | `/api/candidates/[id]/appeals/[appealId]` | 🔒 🏢 | 상태/답변 업데이트. status: pending/reviewed/resolved/rejected. resolved/rejected 로 전환 시 후보자에게 답변 메일 자동 발송(§37의2 조치 결과 통지, 감사로그 `appeal.response_sent`/`response_send_failed`). 응답 `{ok, emailSent}` |
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
| GET | `/api/candidates/[id]/notes` | 🔒 🏢 | 면접관 메모 목록 (같은 법인 누구나 조회). **UI는 2026-06-21 토론 채팅(아래 `/comments`)으로 대체 — 라우트·데이터 보존** |
| POST | `/api/candidates/[id]/notes` | 🔒 🏢 | `{scores?, note?, interviewSessionId?}` 메모/스코어카드 작성. 본인 row 생성 |
| PATCH | `/api/candidates/[id]/notes/[noteId]` | 🔒 🏢 | 본인 작성 메모 수정 |
| DELETE | `/api/candidates/[id]/notes/[noteId]` | 🔒 🏢 | 본인 작성 메모 삭제 |
| GET | `/api/candidates/[id]/comments` | 🔒 🏢 | 이력서별 면접관 토론 코멘트 목록(id 오름차순). `?afterId=N` 이면 그 id 이후 새 코멘트만(폴링용). 같은 법인 누구나 조회 |
| POST | `/api/candidates/[id]/comments` | 🔒 🏢 | `{body}` 코멘트 작성(5000자 이내). 본인 row 생성, 작성자명 포함 반환 |
| DELETE | `/api/candidates/[id]/comments/[commentId]` | 🔒 🏢 | 본인 작성 코멘트 삭제 (수정 없음) |
| GET | `/api/jobs/[id]/funnel` | 🔒 🏢 | 공고 채용 깔때기 — `{stages, pendingByStage, hrActions, total, avgScreeningScore, countWithScreeningScore, decisionBreakdown, kpi}`. `hrActions` = 스케줄 row 기반 HR 액션 수(`counterProposed` 역제시 확정 대기, `round1PassedUndecided` 2차 진행 미결정 — "오늘 결정할 일" 용) |
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
| GET/POST | `/api/cron/expire-interviews` | 🌐 (CRON_SECRET) 또는 👑 | 만료된 면접 세션 → `expired` 처리. **환불 없음**(면접은 후차감이라 미시작/미평가는 과금된 적 없음 — `lib/expire-sessions.ts` `refundedCount=0`). `pending`(AI 미시작) 만료는 자동 불합격(`ai_link_expired`). Vercel Cron schedule = `0 * * * *` (시간당) |
| GET/POST | `/api/cron/purge-original` | 🌐 (CRON_SECRET) 또는 👑 | 평가 완료 + N일 경과 후보자의 `resume_text` 와 파일 삭제 (PIPA 가명처리). `?days=N` 으로 오버라이드. Vercel Cron schedule = `30 3 * * *` (매일 03:30). 디폴트 `PURGE_AFTER_DAYS=30` |
| GET/POST | `/api/cron/interview-reminders` | 🌐 (CRON_SECRET) 또는 👑 | ① 확정 대면 면접(`status='selected'`) D-1(24h 전): **면접관**(`interviewer_reminder_sent_at`) + **후보자**(`candidate_reminder_sent_at`) 에게 각 1회. round1/round2 모두. ② **AI 면접 미응답**(`pending`/`in_progress` + 미만료): 링크 발급 후 24h/48h 경과 시 후보자에게 넛지(`interview_sessions.reminder24_sent_at`/`reminder48_sent_at`, 48h 우선·24h skip). 응답 `{schedule, ai}`. Vercel Cron schedule = `0 * * * *` (시간당) |

인증: `Authorization: Bearer ${CRON_SECRET}` 헤더 또는 system_admin 로그인. Vercel Cron은 `x-vercel-cron: 1` 헤더로 자동 호출.

## 시스템 관리자 전용

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/admin/orgs` | 👑 | 전체 법인 + 잔액/멤버수/공고수 |
| GET | `/api/admin/users?q=` | 👑 | 전 사용자 검색 (이름/이메일/법인명). **`SYSTEM_ADMIN_EMAIL` 로 지정된 보호 계정은 목록에서 제외** (사용자 관리 화면 비노출) |
| GET | `/api/admin/pricing` | 🔒 | 단가 조회 (전 로그인 사용자) |
| PATCH | `/api/admin/pricing` | 👑 | `{job_post?, resume_upload?, interview?, interview_question_gen?}` 0 이상 정수 |
| POST | `/api/admin/orgs/[id]/grant-tokens` | 👑 | `{delta, memo?}` 수동 충전/조정 (admin_adjust ledger) |
| GET | `/api/admin/orgs/[id]/payments` | 👑 | 법인 결제(충전) 주문 내역 — 환불 대상 식별용 |
| POST | `/api/admin/payments/[id]/cancel` | 👑 🔐 | 결제 취소(전액 환불) — 토스 결제취소 API + 지급 토큰 회수(`reverseChargePayment`, 멱등). `paid` 만 가능(paid→cancelled 조건부 claim), `{reason(5자+)}`. 토스 실패 시 paid 복구, 이미 취소면 멱등 성공 |
| DELETE | `/api/admin/orgs/[id]` | 👑 🔐 | 법인 영구 삭제. **정지(suspended) 상태만**. `{reason(5자+), confirm=법인명}`. 멤버 계정도 함께 삭제(system_admin 멤버는 분리). 후보자 파일 폐기 + cascade. 감사 로그 보존 |
| DELETE | `/api/admin/candidates/[id]` | 👑 🔐 | 후보자 영구 삭제 (PIPA 권리요청). `{reason(5자+), confirm=이메일/이름}`. cross-org |
| DELETE | `/api/users/[id]` | 👑 🔐 | 계정 영구 삭제. 기본은 **비활성(disabled) 상태만**. `{reason(5자+), confirm=이메일, force?}` — **`force:true` 면 활성/대기 계정도 즉시 삭제**(사용자 관리 "강제 삭제" 버튼; 마지막 org_admin 정리용). 본인·system_admin·**`SYSTEM_ADMIN_EMAIL` 보호 계정** 불가 |
| POST | `/api/admin/users/[id]/password-reset` | 👑 | 대상 사용자에게 재설정 메일 강제 발송 (기존 토큰 무효화 + 새 토큰, 본인이 요청 못 하는 상황용). 메일 실패해도 200 + `{mailSent:false, error}` |

### 마케팅 메일 (`/admin/marketing`)

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| GET | `/api/admin/marketing` | 👑 | 수신자 전체 목록 |
| POST | `/api/admin/marketing` | 👑 | `{emails}` 일괄 등록 (줄바꿈/쉼표 구분, 최대 500, 중복·형식오류 자동 제외) |
| DELETE | `/api/admin/marketing` | 👑 | `{id}` 수신자 삭제 |
| POST | `/api/admin/marketing/send` | 👑 | `{ids?}` 브로셔 발송. 미지정 시 active 전원. 1회 50건 배치 — 응답의 `remaining` 만큼 재호출. 본문 템플릿: `lib/marketing-brochure.ts` |

공개 수신거부: `/unsubscribe/[token]` (페이지, 비로그인) — 버튼 클릭(서버 액션) 시 status=unsubscribed. 발송 메일 제목에 `(광고)` 자동 포함.

🔐 = step-up 인증(비밀번호 재입력) 필수.

## 대면 면접 평가 (녹취 업로드 / 준실시간)

녹취 동의 attestation 필수. 평가 성공 시 `offline_interview`(30토큰) 후차감 — **자동 첫 평가는 `chargeFeature`(멱등, 워커 재시도 이중과금 방지), 수동 재평가는 `chargeRepeatable`**. 상세: [LIVE_INTERVIEW_PLAN.md](LIVE_INTERVIEW_PLAN.md).

| 메서드 | 경로 | 권한 | 설명 |
|---|---|---|---|
| POST | `/api/candidates/[id]/recorded-interview` | 🔒🏢🔑 | 업로드 모드 — multipart `audio`+`round`+`consentConfirmed`. **오디오 임시저장 + `status='queued'` 적재 후 즉시 202 `{id,status:"queued"}`**. 전사·평가는 백그라운드 워커가 수행(업로드 후 화면 닫아도 됨). 잔액 가드·18MB 캡 |
| GET | `/api/candidates/[id]/recorded-interview` | 🔒🏢🔑 | 후보자의 대면 면접 평가 목록(리포트 + 전사 세그먼트). 상태(queued/processing) 폴링용 |
| PATCH | `/api/candidates/[id]/recorded-interview` | 🔒🏢🔑 | `{recordedInterviewId, action:"confirm"\|"reevaluate"}` — confirm: AI 초안 사람 확정 / reevaluate: 같은 전사로 재평가(매번 과금, maxDuration 300) |
| POST/GET | `/api/internal/process-recorded-interviews` | 🔒 (X-Internal-Secret 또는 X-Vercel-Cron 또는 system_admin) | 업로드 모드 백그라운드 워커 — claim→전사(세그먼트 없을 때만)→오디오 폐기→평가→과금. 한 건씩, 성공 시 self-chain. stuck 복구 포함. 매분 `cron/process-screenings` 가 함께 트리거 |
| POST | `/api/candidates/[id]/recorded-interview/live` | 🔒🏢🔑 | 준실시간 — `action`: `start`(consentConfirmed 필수) / `chunk`(audioBase64·baseMs·chunkIndex, 즉시 전사) / `finish`(finalize) |
| GET | `/api/candidates/[id]/recorded-interview/live?riId=` | 🔒🏢🔑 | 라이브 어시스턴트 — 누적 전사 기반 답변요약/긍정/확인/추천질문 |

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
| 공고 생성 | 200 직전 (선차감) | `job_post` | `job:id` | 5분 내 DELETE |
| 이력서 업로드 | (차감 없음) | - | - | - |
| 서류 평가 / 재평가 | **평가 성공 시 (후차감)** | `resume_upload` | `screening_job:id` | 환불 없음 — 오류/재시도는 애초에 과금 안 됨. 재평가는 새 job 이라 성공마다 1건 |
| AI 면접 | **평가 성공 시 (후차감)** `complete`/`reevaluate` | `interview` | `interview_session` / `interview_session_re{N}` | 환불 없음 — 발급·동의·만료 시점엔 과금 X |
| 면접 질문지 생성/재생성 (1·2차 공통) | **생성 성공 시 (후차감)** | `interview_question_gen` | `candidate` / `candidate_re{N}` (회차는 라운드 합산) | 환불 없음 — 재생성·라운드 추가 생성 매번 과금 |
| 관리자 충전 | 즉시 | `admin_adjust` | - | 별도 PATCH 호출로 -delta |

`chargeFeature`/`refundFeature` 는 `(org, reason, refType, refId)` 단위 멱등. **재평가/재생성 매번 과금**은 `chargeRepeatable` 이 회차별 refType(`{base}`/`{base}_re{N}`)으로 분리. **잔액이 0 이하면 유료 라우트는 402 차단**(`lib/wallet-guard.ts`, 공고 생성 포함).

## 호출 예시 (curl)

```bash
# 이메일 중복확인
curl -X POST http://localhost:3003/api/auth/check-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"new@example.com"}'

# 신규 법인 등록 + 첫 사용자
curl -c jar.txt -X POST http://localhost:3003/api/orgs \
  -H 'Content-Type: application/json' \
  -d '{"orgName":"ACME","email":"admin@acme.co.kr","password":"Test1234!aZ","name":"홍길동"}'

# 단가 조회
curl -b jar.txt http://localhost:3003/api/admin/pricing

# 토큰 잔액
curl -b jar.txt http://localhost:3003/api/orgs/tokens
```

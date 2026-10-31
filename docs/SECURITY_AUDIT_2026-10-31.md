# 보안 전수 감사 — 2026-10-31

읽기 전용 감사(코드 수정 없음). 6개 영역(인증·세션 / 법인 간 권한 / 공개 토큰 표면 / 파일·파서·XSS / 개인정보 수명주기 / 결제·악용) + 의존성(`npm audit`).
표기: ✔ = 메인 세션에서 코드·실행으로 직접 재확인, 나머지는 감사 에이전트가 코드 추적으로 확인.

## 요약

- **법인 간 직접 IDOR(다른 법인 id 로 조회)는 0건** — 161개 인증 API 중 ~140개 점검, 전부 `ownsOrg`/org 필터 선검사.
- 대신 **우회 경로**가 있다: Blob 주소 재사용(파일 가져오기), 법인 SMTP 로 재설정 메일 가로채기, 이메일 인증 전 법인 선점.
- 법인 **내부** 칸막이(공고 PIN)는 여러 경로로 뚫린다.
- 공개 지원·면접 링크는 비용 공격(지갑 소진·LLM 무제한)과 AI 평가 조작에 약하다.
- Next.js 16.2.6 에 공개된 RCE 포함 다수 취약점.

---

## 🔴 긴급 (지금 악용 가능 + 피해 큼)

| # | 문제 | 위치 | 공격 → 결과 | 수정 |
|---|---|---|---|---|
| C1 ✔ | Next.js 16.2.6 알려진 취약점 (RCE 3종, proxy 우회, SSRF, 캐시 혼동 등) | package.json | 공개 advisory 기반 자동화 공격 | 16.4.3+ 업그레이드 |
| C2 ✔ | 크론 `purge-original` 이 **GET + system_admin 세션**으로 실행되고 `?days=` 무검증 | `app/api/cron/purge-original/route.ts:13-29` | 시스템관리자가 `…/purge-original?days=0` 링크 클릭 1번 → **전 법인 이력서 원본·사진 영구 삭제** (Lax 쿠키라 외부 링크에서도 전송) | `days` 파라미터 제거, 크론은 `CRON_SECRET` 만, 세션 인증 제거 (전 cron/internal 공통) |
| C3 ✔ | 업로드 manifest 가 **아무 Blob 주소**나 받아 서버 권한으로 읽어 등록 | `apply/[token]/route.ts:122`, `jobs/[id]/candidates/route.ts:439`, `candidates/[id]/attachments/route.ts:129`, `recorded-interview/route.ts:113` | 퇴사자가 보던 이력서 주소(화면 데이터 `resumeFilePath` 에 노출)를 자기 법인 지원링크에 제출 → 타 법인 이력서·녹음 열람 | 업로드 토큰 발급 시 경로를 `apply/{jobId}/`·`org/{orgId}/` 로 강제 + manifest 에서 접두 검증. 화면 응답에서 전체 URL 제거(`hasResume` 만) |
| C4 ✔ | 비밀번호 재설정·인증 메일이 **법인 SMTP** 로 발송됨, SMTP 변경에 step-up 없음 | `lib/password-reset.ts:79`, `lib/mailer.ts:124`, `app/api/orgs/smtp/route.ts` | 탈취된/악의적 org_admin 이 SMTP 를 공격자 서버로 → 같은 법인 사용자 재설정 요청 → 토큰 가로채 계정 탈취 | 보안 메일(재설정·인증·초대)은 플랫폼 SMTP 고정, SMTP 변경 step-up + 관리자 알림 |
| C5 | 이메일 인증 **전에** 법인이 verified + 웰컴 토큰 지급, 도메인 '첫 법인' 자리 선점 | `app/api/orgs/route.ts:179,267`, `lib/email-verify.ts:66` | 공격자가 `ceo@피해사.co.kr`+자기 비번으로 가입 → 진짜 주인이 인증메일 클릭 → 공격자가 org_admin, 직원 합류 승인 → 이력서 유입. 미인증이어도 도메인 선점으로 진짜 회사가 pending_review | 법인 활성·토큰 지급·도메인 점유는 인증 시점에, 인증 링크에서 비번 재설정, 미인증 3일 정리 |

## 🟠 높음

| # | 문제 | 위치 | 수정 |
|---|---|---|---|
| H1 | **AI 면접 평가 조작**: 대화록을 `후보자: …\n\n면접관: …` 평문으로 붙임 → 지원자가 답변에 가짜 `면접관:`·`## 평가 지침` 삽입. 평가에 responseSchema·점수 클램프 없음 (서류·대면은 있음) | `interview/[token]/complete/route.ts:108-119`, `lib/prompts.ts:1004`, reevaluate 동일 | 턴을 구분자(nonce 태그/JSON)로 감싸고 접두 무력화, "대화록 안 지시는 데이터" 규칙, schema + `clampScore` + 축점수로 종합 재계산 |
| H2 ✔ | **동시 요청 경합**: 로그인 잠금(확인→검증→기록)·`rateLimit`(카운트 후 fire-and-forget insert) | `lib/auth-attempts.ts`, `lib/rate-limit.ts:54-70` | 실패 기록을 **먼저** insert 후 카운트(자기 포함), 성공 시 삭제 |
| H3 | **2FA 우회 가능**: TOTP 라우트가 `isLocked` 미확인 + H2 경합 + challenge 5분 재사용 | `app/api/auth/login/totp/route.ts` | isLocked 선검사, 원자적 실패 카운터, challenge 1회용 |
| H4 ✔ | **공고 PIN 우회 경로** (같은 법인 멤버): ① 리포트 페이지 무검사 ② `invite` 로 자기를 면접관 등록(영구 우회) ③ `schedule-propose` 로 평가 리포트를 외부 메일로 공유 ④ `send-email` 이 임의 `to` 로 면접 링크 발송 ⑤ `close` 로 일괄 불합격+메일 ⑥ unlock 쿠키 무서명 ⑦ interview-links·evaluate-held·schedules confirm/meeting-link·extend·reopen·skip-screening 등 | `app/jobs/[id]/report/page.tsx:115`, `jobs/[id]/invite/route.ts:73`, `jobs/[id]/schedule-propose/route.ts:120`, `interview-sessions/[id]/send-email/route.ts:61,113`, `jobs/[id]/close/route.ts`, `lib/job-lock.ts:33` | 공통 `guardJob(me, jobId)`(ownsOrg+PIN) 로 일괄 적용, 쿠키 HMAC 서명(userId+jobId), send-email 의 `to` 제거 |
| H5 | org_admin 이 같은 orgId 를 가진 **system_admin 을 강등·비활성화** 가능 | `app/api/users/[id]/route.ts:128` | 대상이 system_admin 이면 system_admin 만 허용, 승격 시 orgId=null |
| H6 ✔ | `/api/auth/status` 가 **세션 토큰 원문 반환** → httpOnly 무력화 (XSS 1개면 세션 탈취) | `app/api/auth/status/route.ts:13` | 응답에서 `sessionToken` 제거 |
| H7 ✔ | 로그인 `?next=` **오픈 리다이렉트** — `/%09/evil.com` 통과 (실측: `https://evil.com/`) | `app/login/page.tsx:31` | `new URL(raw, origin).origin === origin` 검사 |
| H8 | 오류 비콘이 **재설정·공유 토큰**(`p_`,`sr_`,`inv_`,`v_`,`np_`,`s_`)을 Sentry(미국)·Slack 으로 전송 | `app/error.tsx:26`, `lib/error-reporter.ts:24` | 비콘은 pathname 만, 토큰 정규식 일반화 `[a-z]{1,4}_[A-Za-z0-9_-]{16,}` |
| H9 | **파서 DoS (공개 지원자 가능)**: HWPX/ZIP `unzipSync` 가 다 푼 뒤 크기 검사 → 압축폭탄 OOM, HWPX 정규식 ReDoS(동기라 타임아웃 무효) | `lib/parsers.ts:96,111`, `lib/zip-extract.ts:142`, `lib/photo-extract.ts:139` | fflate `filter` 로 originalSize 합계 사전 차단, HWPX 선형 스캐너, DOCX 사전 크기검사 |
| H10 | 2FA 활성화에 재인증 없음 + 관리자 2FA 초기화 없음 → 세션 탈취자가 2FA 걸어 주인 잠금 | `app/api/account/2fa/setup`, `enable` | enable 에 step-up, system_admin 2FA 리셋(+감사), 활성화 시 타 세션 폐기 |

## 🟡 중간

| # | 문제 | 수정 |
|---|---|---|
| M1 | 면접 채팅이 종결·지원취소 후에도 동작(`status=expired` 지만 expiresAt 미래), 턴 상한·출력 상한 없음 → Intervia LLM 비용 무제한 (`interview/[token]/chat/route.ts:71`) | status·outcome·superseded 검사, 턴/글자/시간 상한, maxOutputTokens |
| M2 | 공개 지원링크 가짜 지원 대량 제출 → 법인 지갑 음수 소진(서류평가 과금), 남의 이메일 선등록으로 실제 지원 차단 | 공고별 일일 상한+급증 알림, 잔액≤0 이면 자동평가 보류, 봇 차단(Turnstile) 또는 이메일 OTP — **결정 필요** |
| M3 | `apply/precheck` 가 "이 사람이 이 회사에 지원했나" 조회기 (현 직장이 직원 이직 확인 가능) | 응답 통일 + 중복 안내는 메일로 — **결정 필요** |
| M4 | 공유 리포트 폐기 후에도 알림톡 staff-view 링크가 **새 링크 재발급** (`app/shared/view/[token]/page.tsx:140`) | 수동 폐기 이력 있으면 재발급 금지 |
| M5 | CSV 수식 인젝션 — 후보자 export·감사로그 export (`=HYPERLINK(...)` 이름) | `= + - @ \t \r` 시작 셀에 `'` 접두 |
| M6 | Drizzle 오류 `params:`(이름·평가문) 가 Sentry(미국)로 | `params:` 이후 잘라냄 |
| M7 | 삭제·파기 후 PII 잔존: 삭제 감사로그에 이름·이메일 **새로** 기록, 기존 감사로그 미redact, appeal_logs·inquiries·consent_logs 미삭제, 녹음 Blob 최대 37일 잔존 | lifecycle 의 purge 블록 공통화 → 수동삭제·파기 라우트 재사용, 감사에는 ID 만, `deleteCandidateFiles` 에 audio 포함 |
| M8 | PII 조회 감사 공백: sysadmin 전 법인 검색(`?q=` 가 URL 로그에도), 후보자 목록, 사진, 멤버의 상세 조회 / `logAudit` fire-and-forget | 조회·검색 감사 추가(검색어 해시, POST 로), `after()` 로 확실히 기록 |
| M9 | 보관기간 공백: 합격자 있는 미결 공고의 불합격자 무기한, 파싱 실패 후보 원본은 30일 파기 제외, 합격자 영구 | 절대 보존상한 + `resumeMaskedText` 조건 제거 — **처리방침과 함께 결정 필요** |
| M10 | 저장소에 cron Bearer 토큰 하드코딩(`scripts/process-now.ps1` 등). 현재 운영값과는 다름(과거값 가능) | env 에서 읽게 수정, 운영 CRON_SECRET 이 이 값이 아닌지 확인 |
| M11 | 세션·재설정·인증·초대 토큰 DB 평문 저장 → 읽기 전용 DB 유출이 곧 세션 탈취 | SHA-256 저장 (배포 시 전원 재로그인) |
| M12 | 메일 폭탄·쿼터 고갈: `request-charge` 무제한, 재설정·인증 재발송이 이메일 단위 쿨다운 없음 → 공유 SMTP 예산 소진 시 전 고객 메일 중단 | 사용자·이메일 단위 쿨다운 |
| M13 | 채팅 LLM 프롬프트에 서류평가 우려사항 원문 → 지원자가 우회 질문으로 추출 가능 | 주제 형태로 추상화, 출력 버퍼 검사 |
| M14 | step-up 누락: SMTP, transfer-admin, admin 비번재설정, 합류 승인, 계좌이체 신청, 대량 export. step-up 이 2FA 사용자에게 TOTP 미요구 | 추가 |
| M15 ✔ | 의존성: nodemailer 9.0.3(주소 파서 우회·DoS 다수), @xmldom 0.8.13(mammoth), undici 6/7(@vercel/blob·cheerio) | 업그레이드/overrides |
| M16 | cron/internal: `CRON_SECRET` 미설정 시 `x-vercel-cron` 헤더 위조로 통과(fail-open) | 운영에서 미설정이면 거부 |
| M17 | CSP 에 script-src 없음 — XSS 발생 시 완화 장치 부재 (현재 XSS 싱크는 0) | nonce 기반 script-src |

## 🟢 낮음 (묶어서 처리)

로그인 타이밍·check-email 계정 존재 노출 / `inputSignals` 무제한·위조 / 일정 역제시 반복 알림폭탄 / 서브도메인에서 타 법인 면접·공유 화면 렌더 / 클라이언트 지정 applyToken 10자 허용 / 다운로드 Content-Type 을 blob 메타로 결정 / manifest size·개수 클라이언트 신고값 신뢰, `kind:audio` 가드 우회 / 브로셔 미리보기 HTML 동일 오리진 / 메일 href 따옴표 미이스케이프 / 감사 export 파일명 헤더 주입 / 레거시 `/api/uploads/[file]` / 마스터키 용도 공유(HKDF) / 쿠키 `__Host-` 미사용 / `/api/auth/setup` 잔존 / `api/invites` CSRF matcher 제외 / 재설정·인증 토큰 1회용 경합 / bootstrap 비번 평문 로그·mustChangePassword 우회 / prompt-safety 한글 `\b` 정규식 무효 / Slack 에 수신 이메일 원문 / 백업 워크플로 Turso 플랫폼 토큰 범위 / 로컬 운영백업 JSON 평문 / 카드 confirm `promisedTokens` 누락 / admin 가격 PATCH step-up / 멤버가 공고 삭제·PIN 해제 가능(**정책 결정**) / `GET /api/jobs` 잠긴 공고 카운트 노출

## ✅ 잘 되어 있는 것 (유지)

비번 정책(10자·3종·HIBP) 전 경로 적용 · bcrypt 12 · 세션 192bit·httpOnly·secure·로그인마다 재발급 · 비번 변경/재설정 시 타 세션 폐기 · disabled/정지 즉시 반영 · TOTP replay 방지·AES-GCM · 공개 토큰 전부 128~192bit CSPRNG · 법인 간 ID 조회 전부 차단 · 다운로드 ownsOrg+PIN+감사+속도제한 · Blob private · SSRF(공고 URL 임포트) 사설대역·리다이렉트·DNS rebinding 차단 · zip slip 차단 · XXE 없음 · `dangerouslySetInnerHTML` 0 · 메일 템플릿 escape · SQL 전부 바인딩 · 결제 금액 서버 강제·멱등·Slack HMAC · 쿠폰 원자적 사용 · 이력서 원문 미저장·LLM 전 마스킹 · 백업 age 암호화 · 시크릿 미커밋(위 cron 토큰 제외)

---

## 실행 계획 (일괄 진행 시)

DB 변경은 **추가형만**(파괴적 0). 각 묶음 = 커밋 1개, 묶음마다 `tsc → eslint → test:critical`.

| 묶음 | 내용 | 운영 영향 |
|---|---|---|
| A 의존성 | Next 16.4.3+, nodemailer, mammoth/xmldom, undici overrides | 빌드·회귀 위험 → 단독 커밋 |
| B 긴급 차단 | C2 크론 세션인증 제거·days 제거, H6, H7, C4 | 없음 |
| C 파일·권한 | C3 경로 바인딩, H4 guardJob+쿠키서명, H5, 레거시 라우트 | 업로드 클라이언트 경로 변경 |
| D 인증 | H2·H3 원자적 카운트, H10, C5, M11 토큰 해시, M12, M14 | 토큰 해시 배포 시 전원 재로그인 |
| E 공개·LLM | H1, M1, M4, M13, 낮음 묶음 | 평가 프롬프트 변경 → 점수 분포 확인 필요 |
| F 파서 | H9 | 없음 |
| G 로그·개인정보 | H8, M6, M7, M8, M10, M16 | 없음 |
| H 결정 후 | M2 봇 차단, M3 precheck, M9 보존기한(처리방침 개정), 공고 삭제 권한, M17 CSP | 정책·고지 |

### 결정 기록
- 2026-10-31: 공고 삭제·PIN 변경/해제는 **org_admin 전용** (+step-up). 공고 생성 시 PIN 설정은 멤버도 가능.
- 확인: 불합격·지원취소 시 이력서·사진·첨부 파일은 이미 결정 즉시 폐기됨(`purgeOnDecision`). 남는 건 후보자 행(이름·연락처·평가·면접 대화)과 녹음 오디오.
- 2026-10-31 보존(M9): 불합격자 = 이력서 즉시 파기(현행), 나머지 정보는 현행대로(공고 종결 +14일). 합격자 = **1년 보관** 후 삭제(현재 "회사가 삭제할 때까지" → 처리방침 §3 개정 필요, 만료 30일 전 담당자 안내).
- 2026-10-31 중복 지원·명의도용(M2): 이력서 갱신 기능 없음. 같은 공고 내 **전화번호**(정규화) 일치 = 중복. 중복 시 그 번호로 **카카오 알림톡 6자리 인증번호**(알리고, 카톡 미사용자는 알리고 failover 문자 자동) + "본인이 제출하지 않음" 확인 → 기존 지원서 "명의도용 신고됨"(자동 진행 중단·서류평가 차감 환불), 새 이력서는 일반 신규 지원자로 등록 + "관련 지원서 1건" 링크, 이름 같으면 "동일인 의심" 표시. 번호당 공고별 신고 1회. 인증번호는 공통 모듈 `lib/phone-otp.ts`(5분 유효, 번호 60초·하루 5회 / IP 하루 10회 / 전체 하루 300회, 5회 오입력 폐기, 야간 예약 없이 즉시). 공통 템플릿 1종 2026-10-31 카카오 심사 신청(보안 템플릿) → 승인 후 `ALIGO_TPL_OTP` 입력. 미설정이면 중복은 지금처럼 차단만. 중복 안내 문구는 어느 항목이 겹쳤는지 밝히지 않음. DB는 컬럼 추가만.

### 운영 확인 필요 (읽기 전용)
- Vercel 운영 `CRON_SECRET` 이 `scripts/*.ps1` 하드코딩 값과 다른지
- orgId 를 가진 system_admin 계정 존재 여부 (H5)
- 로컬 `backup-prod-20260615-232750.json` 삭제/암호화 여부

# 전체 테스트 발견 버그·이슈 트래커

> 출처: [TEST_CASES.md](TEST_CASES.md) 전체 테스트 (섹션 0~23 완료, 2026-06-07~09).
> 방침: **전체 테스트를 끝까지 마친 뒤** 아래 항목을 위에서부터 하나씩 수정한다. (사용자 결정)
> 상태 범례: 🔴 미수정 / 🟢 수정완료 / ⏳ 재검증대기
>
> ## ▶️ 수정 작업 시작 가이드(파일·수정안·검증법 정리): [TEST_FIX_TODO.md](TEST_FIX_TODO.md)
> 우선순위·수정순서는 맨 아래 「진행 요약」 표 참조 (D-2 → A-1 → A-2 → D-5 → D-1 → D-4).

---

## A. 확정 버그 (코드 수정 필요)

### A-1. 🟢 중복 합류 이메일 → 500 (기대 409) — TC-1.3.6 — **수정완료(2026-06-09)**: `lib/db-errors.ts` `isUniqueViolation` 로 cause 체인 판정 → 409. 재검증 OK.
- **위치**: `app/api/orgs/join-requests/route.ts:123` (POST, catch 블록)
- **현상**: 이미 가입된 이메일로 합류 요청 시 `users` INSERT 가 UNIQUE 위반 → catch 가 `e.message` 에서 `/UNIQUE/` 를 찾지만 Drizzle 이 에러를 감싸 최상위 message 는 `"Failed query: insert into..."` 라 매칭 실패 → `throw e` → **500**.
- **루트원인**: `"UNIQUE constraint failed"` 문구는 `e.cause.message`(LibsqlError, code `SQLITE_CONSTRAINT_UNIQUE`)에만 존재. catch 가 cause 체인을 안 봄.
- **수정안**: catch 에서 `e.cause?.message` 까지 확인하거나 `(e as any).code === 'SQLITE_CONSTRAINT_UNIQUE'` / `(e as any).cause?.rawCode === 2067` 로 판정 → 409 반환.
- **영향/심각도**: 중. 실사용 UI 는 사전 `check-email` 로 중복을 먼저 걸러 드물지만, API 자체가 500 + 에러로그 오염. 환경 무관(운영에서도 재현).
- **추가 점검**: 동일 `.cause` 미탐색 catch 패턴이 다른 라우트에도 있는지 `grep "unique constraint"` 로 전수 점검.

### A-2. 🟢 공고 5분내 삭제 환불 미발동 (TZ 버그) — TC-7.2.2 — **수정완료(2026-06-09)**: `parseDbTimestamp`(UTC) export 후 jobs DELETE·bulk-screen·screen 에 적용. 재검증: 생성→즉시삭제 잔액 원복+refund ledger OK. (org/funnel 는 차이 계산이라 정상, 미변경)
- **위치**: `app/api/jobs/[id]/route.ts:191` (DELETE)
- **현상**: 공고 생성 직후 삭제해도 `refundFeature` 가 발동 안 함 → 토큰 환불 안 됨.
- **루트원인**: `new Date(existing.createdAt)` 가 SQLite UTC 타임스탬프(`"2026-06-07 15:00:00"`, `Z` 없음)를 **로컬 타임존으로 파싱**. KST(+9) 머신에서는 9시간 이른 값이 되어 `ageMs` 가 항상 ~9시간 → `ageMs <= 5분` 영영 false → 환불 미발동.
  - node 확인: `new Date('2026-06-07 15:00:00')` − UTC파싱 = **−32,400,000ms(−9h)**, TZ=Asia/Seoul.
- **수정안**: `lib/auth-attempts.ts` 의 `parseSqliteTimestamp`(문자열에 `Z` 부착 후 파싱)처럼 UTC 로 파싱. 또는 createdAt 비교를 UTC 기준으로 통일.
- **영향/심각도**: 중. ⚠️ **운영(Vercel)은 UTC 라 정상 동작 → 잠재버그**. 그러나 (a) 로컬/비UTC 서버에서 토큰 손실, (b) 로컬에서 환불 테스트 불가, (c) UTC 의존이라 fragile. 견고성 위해 수정 권장.
- **추가 점검**: `grep "new Date(" lib app | grep -i "createdAt\|created_at\|attemptedAt"` 로 동일 패턴(SQLite ts 를 Z 없이 `new Date`) 전수 점검. 환불·만료·기간 계산 등 시간 비교 로직 우선.

---

## B. 마스킹 robustness (lib/mask.ts — PII 보호 견고성)

### B-1. 🟢 짧은 후보 이름 → 과잉 마스킹으로 이력서 텍스트 파괴 — §10/§9.4.1 — **수정완료(2026-06-09)**: `applyKnown` 에서 known.name 길이<2 면 치환 스킵. 재검증: 이름 "a" → 본문 보존(`Name: [이름], Education at [학교]...`).
- **위치**: `lib/mask.ts` `maskText` (known.name 기반 치환)
- **현상**: 후보 이름이 1글자(테스트: 파일명 stem `"a"`)면, `maskText` 가 known.name 으로 문서 내 **모든 "a"** 를 `[이름]` 으로 치환 → 마스킹본이 `"N[이름]me"`, `"Educ[이름]tion"`, `"5 ye[이름]rs"` 처럼 파괴됨. 이 파괴된 텍스트가 AI 평가에 입력됨.
- **루트원인**: known-name 치환에 길이 하한·단어경계 가드가 없음. 1~2글자 이름/토큰이면 본문 단어 내부까지 매칭.
- **수정안**: known-name 길이 < 2 면 치환 스킵, 또는 한글/영문 단어경계(`\b` 또는 한글 경계 lookaround) 적용. 영문 단일 알파벳은 마스킹 대상에서 제외.
- **영향/심각도**: 중. 정상 한글 이름(2~3자)은 영향 적으나, 1글자 이름·이니셜·파일명 기반 이름에서 평가 입력 오염. 환경 무관.

### B-2. 🟢 라벨 마스킹이 이메일 TLD 조각 잔존 — TC-9.4.1 — **수정완료(2026-06-09)**: `maskText` 가 이메일·전화를 라벨 패스 전에 선마스킹(`RE_EMAIL`/`RE_PHONE`). 재검증: "전화 ... 이메일 test@example.com" → `전화: [전화]`(.com 잔존 없음). 주소/회사 정규식 순서는 유지(이름 지번 오매칭 회피).
- **위치**: `lib/mask.ts` `applyLabels`
- **현상**: `"이메일 test@example.com"` 입력 시 마스킹 결과에 `.com` 조각이 남음(`"...[전화].com"`). 이메일 로컬/도메인 핵심은 가려지나 TLD 조각 leak.
- **루트원인**: 라벨 기반 사전 마스킹의 값 경계 처리가 이메일 정규식과 어긋남(applyLabels 가 부분만 소비하고 applyBasic 의 이메일 정규식이 잔여 `.com` 을 재매칭 못함).
- **수정안**: applyLabels 값 경계를 이메일 전체 토큰까지 확장하거나, applyBasic(정규식 패스)을 라벨 패스보다 먼저 적용해 전체 이메일을 먼저 마스킹.
- **영향/심각도**: 낮음. 도메인 TLD 조각 leak(식별성 낮음). 그래도 PII 정책상 정리 권장.

> B-1/B-2 는 같은 파일(`lib/mask.ts`)이라 함께 손보는 게 효율적. 수정 후 `scripts/_mask.ts` 로 회귀 확인 가능.

---

## C. 시드/환경 정리 항목 (제품 버그 아님 — 테스트 품질·출시 위생)

### C-1. 🟢 시드 법인이 `pending_review` 상태 — **수정완료(2026-06-09)**
- **현상**: `npm run db:seed-test` 가 만든 법인이 `verification_status='pending_review'`. 실제 signup 은 `verified` 를 생성하므로 불일치 → 합류 happy-path 테스트가 막혀 우회 필요.
- **수정**: `scripts/seed-test.mjs` insertOrg 에 `verification_status='verified', verified_at=CURRENT_TIMESTAMP` 명시.

### C-2. 🟢 시드 비밀번호 `Test1234!` 가 9자 (정책 10자 미달) — **수정완료(2026-06-09)**
- **현상**: 로그인은 bcrypt 비교라 통과하지만, 비번 정책(10자+) 검증을 가림(예: TC-4.1.2 "동일 비번 거부" 가 정책 에러에 먼저 막힘).
- **수정**: 시드 비번을 `Test1234!aZ`(11자·4종, validatePassword 통과 확인)로 교체. 동기화한 파일: `seed-test.mjs`, `_api.mjs`, `_upload.mjs`, `test-e2e-cycle.mjs`, `test-consent-gate.mjs`, docs(TEST_RESUME/TEST_PLAN/TEST_CASES/USER_TODO/API). ⚠️ **루트 `D:\intervia\CLAUDE.md`(인코딩 깨진 파일) 의 "Test1234!" 표기는 미반영** — 깨진 파일이라 직접 편집 보류, 필요 시 재작성 권장.

### C-3. dev `MAIL_OVERRIDE_TO` 설정됨
- **현상**: dev `.env.local` 에 메일 가로채기 활성. 출시 전 제거 대상(LAUNCH_CHECKLIST 연계).

### C-4. (해결됨, 기록용) CSV export 404 → dev 서버 stale manifest
- 실행 중이던 dev 서버가 `/api/jobs/[id]/candidates/export` 라우트를 미등록 → 404. **서버 재시작 후 정상**(200, UTF-8 BOM). 제품 버그 아님. 운영(Vercel 빌드)은 영향 없음. → 라우트 추가/수정 후 stale 404 보이면 dev 서버 재시작.

---

## D. 섹션 12~23 전체 테스트 중 발견 (2026-06-09~)

### D-1. 🟢 동의(consent) 라우트는 무이메일 후보 본인확인 면제 — TC-12.2.4 — **수정완료(2026-06-09, 사용자결정=막기)**: interview-link 발급에 이메일 필수 가드(400 HR안내) + consent 무이메일 403 백스톱. 재검증 OK.
- **위치**: `app/api/interview/[token]/consent/route.ts:68` (`if (candidate?.email) { ... }`)
- **현상**: 후보자 컬럼에 `email` 이 등록돼 있으면 본인확인(입력 이메일 일치) 강제하나, **email 이 NULL 인 후보는 검증을 통째로 스킵** → 토큰만으로 동의 제출·면접 시작 가능(200). 실측: 무이메일 후보(179) consent 토큰-only → 200.
- **대비**: `/me`(route.ts:43)·`/withdraw`(route.ts:42)·`/appeal` 는 무이메일 → **403 fail-safe 정상**(코드 확인). 즉 PII 조회·삭제 등 고위험 self-service 는 fail-safe 가 걸려 있고, consent 만 "legacy 후보자 면제"(코드 주석) 로 빠져 있음.
- **평가**: TC-22.2.4 불변식("면접 토큰 본인확인은 이메일 없으면 403")의 **문구상 예외**.
- **✅ 사용자 결정(2026-06-09): 막기.** 무이메일 지원자는 AI 면접 불가 + HR 에게 "이력서 수정해 이메일 추가" 안내. → **interview-link 발급에 이메일 필수 가드(HR 안내)** + **consent 무이메일 403 백스톱**. 상세 수정안은 [TEST_FIX_TODO.md](TEST_FIX_TODO.md) ☐5.
- **참고**: TC-12.2.5 "동의 시점 차감(멱등)" 문구도 **구설계** — 현재는 complete 후차감(consent 는 과금 안 함). 코드/문서 정합 시 TEST_CASES 문구 갱신 필요(버그 아님).

### D-2. 🟢 AI 면접 complete 응답이 후보자 브라우저에 평가 전문 노출 — TC-12.5.4 — **수정완료(2026-06-09)**: complete 의 3개 평가 반환점 + 에러 노출점을 `DONE_RESPONSE`(감사 메시지)로 통일. 재검증: 토큰 complete→메시지만, DB엔 평가 보존(관리자 조회 OK).
- **위치**: `app/api/interview/[token]/complete/route.ts:132,183` (`Response.json(evaluation)`)
- **현상**: 후보자(무인증, 토큰 보유)가 호출하는 `POST /api/interview/[token]/complete` 가 **평가 JSON 전문**(overall_score·recommendation "비추천"·summary·scores·concerns)을 응답 본문으로 반환. 클라이언트 UI(`app/interview/[token]/page.tsx:217` `finalizeSilently`)는 본문을 읽지 않아 화면엔 안 뜨지만, **후보자가 브라우저 개발자도구 네트워크 탭으로 응답을 그대로 열람 가능**. 실측: 토큰만으로 complete 호출 → score 23·"비추천"·summary 전부 반환됨.
- **설계 의도 위반**: TC-12.5.4/§12.4 "후보자에게 평가 **미노출**(감사 메시지만)" + PIPA §37의2(자동화 의사결정은 인간 검토 후 통보). 인간 검토 전 "비추천"·concerns 가 후보자에게 새어 분쟁·악용 소지.
- **수정안**: 후보자 호출 경로(complete)는 평가 본문을 반환하지 말고 `{ status:"completed", message:"면접이 종료되었습니다. 결과는 채용 담당자가 검토 후 안내합니다." }` 같은 감사 메시지만 반환. 평가 조회는 인증된 관리자 라우트(`/api/candidates/[id]` 등)로만. (현재 멱등 분기 `session.status==="completed" && session.evaluation` 도 평가 반환 → 동일 처리 필요)
- **심각도**: 중상. UI 는 가렸으나 API 가 노출 — "감춰진 것처럼 보이나 실제 노출". 후보자=데이터주체라 자기평가 접근권 논쟁 여지 있으나, 제품 설계는 명시적으로 인간검토 전 미노출을 의도하므로 갭으로 판단.

### D-3. 🟢 면접 질문지 라우트 상단 docstring 과 실제 과금 코드 불일치 — TC-13.6 — **수정완료(2026-06-09)**: docstring 을 "chargeRepeatable 5토큰/회 후차감(재생성 매번)"으로 정정.
- **위치**: `app/api/candidates/[id]/interview-questions/route.ts:9-12` (상단 docstring)
- **현상**: 상단 docstring 은 "후보자당 **1회** interview_question_gen ... **chargeFeature** 가 (refType=candidate, refId=cid) 기준 **멱등**이라 **재생성 시 추가 차감 없음**" 이라 기재. **그러나 실제 코드(:234)는 `chargeRepeatable`** 로 생성 성공마다 과금(line 232 주석 "재생성도 LLM 비용 발생 → chargeRepeatable 회차 분리"). 실측: 2회 생성 → ledger interview_question_gen 2건(각 -5). `interview_question_gen` 단가는 시드에 없으나 `DEFAULT_PRICING=5`(tokens.ts:26) 폴백 → **무료 아님, 5토큰/회**.
- **영향**: 제품 동작 자체는 합리적(LLM 재생성 비용 과금). 단 **같은 파일 내 docstring 이 정반대로 기술** → 향후 개발자가 멱등/무료로 오해할 위험. 문서(주석)만 수정하면 됨.
- **수정안**: 상단 docstring 을 "chargeRepeatable 로 생성마다 5토큰 후차감(재생성도 매번)" 으로 정정. TEST_CASES TC-13.6 도 "무료" 표현 정리.

### D-4. 🟢 일정 슬롯 검증에 중복 제거 없음 — TC-14.1.3 — **수정완료(2026-06-09)**: `validateSlots` 에 (start|end) dedup + 전부 중복 시 빈 결과 가드. 재검증: 동일 슬롯 2개→저장 1개.
- **위치**: `lib/schedules.ts` `validateSlots` (line 40-59)
- **현상**: 슬롯 검증이 개수(1~10)·미래·end>start·60일은 막으나 **동일 슬롯 중복 입력은 그대로 통과**(실측: 같은 {start,end} 2개 → 200). TC-14.1.3 "미중복" 기대 미충족.
- **영향**: 매우 낮음(경미). 후보자에게 같은 시간이 두 번 표시되는 UI 잡음뿐, 보안/정합 문제 없음. select 시 인덱스로 고르므로 동작엔 무해.
- **수정안(선택)**: validateSlots 에서 `start|end` 키로 dedup, 또는 프런트에서 중복 입력 차단. 또는 TEST_CASES TC-14.1.3 의 "미중복" 표현을 제거(현 동작 수용).

### D-5. 🟢 일정 제시(schedule-propose)에 종결 후보·종결/만료 공고 가드 누락 — TC-23.2.1 / TC-23.2.2 — **수정완료(2026-06-09)**: job closed→409·expired→409 가드 + 루프에서 종결 후보 skip. 재검증: rejected→skip, closed/expired→409. (round2 동일 적용. confirm/meeting-link 후속 가드는 미적용 — 이미 확정된 면접이라 보류, 아래 참고)
- **위치**: `app/api/jobs/[id]/schedule-propose/route.ts` (POST, round1 경로)
- **현상**: 형제 라우트(`candidates/[id]/interview-link`, `interview-sessions/[id]/send-email`)는 모두 **(a) candidate.outcome 종결 → 409, (b) job.status==='closed' → 409, (c) isJobExpired → 409** 가드를 갖는데, **schedule-propose 는 이 셋 모두 없음**. 실측:
  - rejected/withdrawn(종결) 후보 → schedule-propose round1 → **200 sent** (기대: 차단). 종결 후보에게 새 면접 일정 메일 발송 + stage=round1_scheduling 로 덮어씀 → outcome=rejected 인데 pending 일정이 공존하는 모순 상태.
  - status='closed' 공고 → **200 sent** (기대 409 job_closed).
  - closes_at 과거(만료) 공고 → **200 sent** (기대 409 job_expired).
  - grep `outcome|status.*closed|isJobExpired` on route → 무결과(가드 부재 확인).
- **영향/심각도**: 중. 토큰 과금은 없음(round1 일정은 무과금)이라 회계 누수는 아니나, (1) **종결(불합격/취소/합격)된 지원자에게 면접 초대 메일 발송** — 채용 신뢰도·혼란, (2) 종결/만료 공고가 계속 일정 제시 가능 — 라이프사이클 불변식 깨짐, (3) outcome 과 stage/schedule 의 상태 불일치. 운영/로컬 무관(환경 독립).
- **수정안**: schedule-propose POST 에서 대상 후보 루프 전(또는 각 후보별로) `candidate.outcome` 종결 후보 skip/거부, job 로드 직후 `job.status==='closed'` → 409, `isJobExpired(job)` → 409 추가. interview-link 라우트(:37-85)의 가드 패턴 그대로 이식하면 됨. round2 도 동일 적용.
- **추가 점검**: round2 경로(round1_passed 게이트는 있음)도 job closed/expired 미체크. `/api/schedules/[id]/confirm`·`meeting-link` 등 후속 일정 액션도 job 종결 가드 있는지 전수 점검 권장.

---

## 진행 요약 (2026-06-09 기준) — 전체 테스트 완료 + 확정버그 6종 수정완료

**확정 버그 6종 — ✅ 전부 수정·재검증 완료 (2026-06-09):**
| # | 심각도 | 요약 | 상태 |
|---|---|---|---|
| **D-2** | 🟠 중상 | AI 면접 complete 응답이 후보자에 평가 전문 노출 | 🟢 수정완료 |
| **A-1** | 🔴 중 | 중복 합류 이메일 500↔409 (e.cause 미탐색) | 🟢 수정완료 |
| **A-2** | 🔴 중 | 공고 5분내 삭제 환불 TZ 버그 | 🟢 수정완료 |
| **D-5** | 🟠 중 | schedule-propose 종결후보·종결/만료공고 가드 누락 | 🟢 수정완료 |
| **D-1** | 🟡 낮음 | 무이메일 면접 차단(사용자결정=막기) | 🟢 수정완료 |
| **D-4** | 🟡 매우낮음 | 일정 슬롯 중복 미차단 | 🟢 수정완료 |
| **D-3** | 문서 | 질문지 docstring 과 과금 코드 불일치 | 🟢 수정완료 |

**추가 수정완료 (2026-06-09):**
- **B-1** 🟢 마스킹: 1글자 이름 과잉마스킹 → `applyKnown` 이름 길이<2 스킵. 재검증: 이름 "a" 본문 보존.
- **B-2** 🟢 마스킹: 이메일 TLD 조각 잔존 → 이메일/전화 라벨 패스 전 선마스킹. 재검증: `.com` 잔존 없음.
- **C-1** 🟢 시드 법인 `verification_status='verified'` 명시.
- **C-2** 🟢 시드 비번 → `Test1234!aZ`(10자+ 정책 통과), 전 스크립트·문서 동기화.

**아직 미수정:**
- **C-3** ⚠️ dev `MAIL_OVERRIDE_TO` — **출시 직전** 제거 항목(지금은 dev 테스트 편의상 유지). LAUNCH_CHECKLIST 연계.
- **C-4** ✅ 이미 해결(기록용, dev stale manifest).

- 전체 테스트(섹션 0~23) 완료. **확정버그 6종 + B-1/B-2 + C-1/C-2 전부 수정·재검증 완료**, `npx tsc --noEmit` 0건. 상세는 [TEST_FIX_TODO.md](TEST_FIX_TODO.md).
- **남은 것**: C-3(출시 직전 메일설정 제거)뿐. 배포 전 §23 회귀 전체 재실행 권장.

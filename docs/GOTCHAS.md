# 함정 모음 (Gotchas)

작업 전 한 번 훑으면 시간 낭비 큰 폭으로 줄어듭니다.

## 0-C. 워크트리 제거가 main 의 node_modules 를 지운다 (2026-06-12, 2026-07-21 **두 번** 발생)

`.claude/worktrees/*/node_modules` 는 main 을 가리키는 **junction(심볼릭 링크)** 이다.
`git worktree remove` 가 실패하거나(`failed to delete … Invalid argument`) `rm -rf` 로 지우면
**링크를 따라가 main 의 실제 패키지를 삭제**한다. 2026-07-21 에는 `@libsql/client` 와
`@google/genai` 가 통째로 사라져 빌드가 불가능해졌다(같은 사고 두 번째).

**안전한 절차** — 순서를 지킬 것:

```powershell
# 1) junction 먼저 끊는다 (rmdir 은 링크만 제거, 대상은 안 건드림)
node -e "const{rmdirSync,lstatSync}=require('fs');const p='.claude/worktrees/<이름>/node_modules';if(lstatSync(p).isSymbolicLink())rmdirSync(p)"
# 2) main 무결성 확인 — 여기서 깨졌으면 이미 사고다
node -e "for(const p of ['@libsql/client','@google/genai','next'])require.resolve(p)"
# 3) 그 다음에야 디렉토리 삭제
rm -rf .claude/worktrees/<이름>
git worktree prune
# 4) 삭제 후 무결성 재확인 + 빈 패키지 스캔
```

복구는 `npm install` 이지만 **dev 서버(3003)를 먼저 내려야 한다** — 실행 중이면 Windows
파일잠금으로 exit 0 인데 패키지가 누락된다(§ dev 서버 중 npm install 금지).

## 0-B. node 스크립트의 env 기본값은 운영 — DB 스크립트는 반드시 `LOCAL_DB=1`

**증상**: `npm run db:seed-test` 등을 로컬 작업이라 생각하고 실행했는데 운영 Turso 가 wipe 됨 (2026-06-12 실사고).

**원인**: `scripts/_load-env.mjs` 가 `LOCAL_DB=1` 없으면 **production 모드**로 로드 → `.env.production.local` 의 `TURSO_DATABASE_URL` 이 잡힘. Next dev 서버(로컬 `data.db`)와 node 스크립트의 대상 DB 가 다르다.

**해결**:
- 로컬 대상 스크립트는 항상 `$env:LOCAL_DB="1"; node scripts/...` 또는 `$env:LOCAL_DB="1"; npm run db:seed-test`
- destructive 스크립트는 실행 직후 출력되는 `DB:` URL 부터 확인
- `seed-test.mjs` 는 원격 URL 이면 거부하는 가드 내장 (`SEED_REMOTE=1` 로만 해제)
- 새 wipe/시드 스크립트를 만들면 같은 가드를 넣을 것

## 0-A. 후보자 서브상태는 컬럼이 아니라 파생 — `lib/candidate-state.ts` 만 수정

**증상**: "지원자 응답 대기"인데 실제론 HR 차례 등 목록/대시보드 상태 불일치.

**원인**: 누가 액션할 차례인지(서브상태)를 stage 나 별도 컬럼으로 직접 판정/저장하려 함. 서브상태는 큐(`screening_jobs`)/세션(`interview_sessions`)/스케줄(`interview_schedules`)에서 **파생**되는 값이라, 복제 저장하면 전환 지점마다 갱신이 누락돼 드리프트한다.

**해결**:
- 판정 로직 추가/변경은 `lib/candidate-state.ts` `deriveCandidateState()` 한 곳에만
- UI 는 `WaitBadge`/`GROUP_META`/`matchesWaiterFilter` 등 모듈 export 만 소비
- 대시보드 알림(`app/page.tsx`)은 같은 판정의 SQL 재현 — 모듈 조건 바꾸면 **SQL 도 같이** 수정
- 새 stage/스케줄 전이를 추가하면 `StateKey` 매트릭스에 빠지는 상태가 없는지 확인 (특히 "만료/시간경과" 류 — `ai_link_expired`, `r1_result_due` 가 과거에 빠져 있던 사각지대)

## 0. 멀티테넌트 — `org_id` 필터 누락이 가장 위험

**증상**: 다른 법인 사용자가 우리 공고/후보자를 보게 됨.

**원인**: 모든 jobs/candidates 쿼리에 `org_id` 필터 빠뜨림.

**해결**:
- 목록 쿼리: `lib/tenant.ts` 의 `jobOrgFilter(me)` / `candidateOrgFilter(me)` 를 `where(and(...))` 에 항상 끼움
- 단일 row 조회: 로드 후 `ownsOrg(me, row.orgId)` 체크. 실패 시 **404** 로 응답 (존재 여부 위장)
- POST/INSERT: body의 `orgId` 무시하고 서버측 `me.orgId` 사용. system_admin만 명시 허용
- system_admin은 모든 법인 통과 — 필터 함수가 `undefined` 반환

## 0-1. 후보자 하위 라우트 권한은 `guardCandidate` 만 사용

**증상**: PIN 잠긴 공고인데 같은 법인 멤버가 `/notes`(면접관 평가 열람), `/stage`(합·불 확정+메일) 등 하위 라우트로 우회 접근.

**원인**: 라우트마다 candidate 로드 + `ownsOrg` 만 직접 구현하고 공고 PIN 잠금(`isJobUnlocked`) 검사를 빠뜨림.

**해결**: `app/api/candidates/[id]/**` 신규 라우트는 반드시 `lib/candidate-guard.ts` 의 `guardCandidate(me, cid)` 사용 — 존재(404)/법인 소유(404)/PIN 잠금(403 `{locked:true}`)을 한 번에 처리하고 `candidate`·`job` row 를 돌려준다. 개별 구현 금지.

## 0-2. 토큰 ledger 멱등 가드 — 에러 메시지는 cause 체인에서 검사

drizzle 가 모든 쿼리 에러를 감싸므로 최상위 `e.message` 는 `"Failed query: ..."` 뿐. UNIQUE 위반 판별은 반드시 `lib/db-errors.ts` `isUniqueViolation(e)` 사용 (`String(e)` 정규식 검사 금지 — 과거 join-requests·token ledger 두 곳에서 동일 버그 재발).

## 0-0-2. Rate limit 위치

민감한 라우트 새로 만들면 반드시:
```ts
import { rateLimit } from "@/lib/rate-limit";
const limited = await rateLimit(req, "my-scope", { limit: 5, windowSec: 60 }, me?.id);
if (limited) return limited;
```

기본 한도 표 (분당):
| Scope | Limit | 비고 |
|---|---|---|
| `signup` | 5 | IP 기준 |
| `setup` | 5 | IP 기준 |
| `change-password` | 5 | userId 기준 |
| `resend-verification` | 3 | IP 기준 (계정 enum 방지) |
| `check-email` | 10 | IP 기준 (가입 전 계정·법인·담당자 정찰 방지) |
| `org-search` | 20 | IP 기준 (법인 디렉토리·사업자번호 대량 스크래핑 방지) |
| `org-admins` | 5 | IP 기준 (담당자 enumeration 방지) |
| `send-email` | 5 | userId 기준 |
| `self-view` / `self-delete` | 5 / 3 | 면접 토큰 기준 (후보자 본인열람/삭제) |
| `llm-screen` | 30 | userId 기준 (단건) |
| `attachment-modify` | 20 | userId 기준 (후보자 첨부 추가/삭제) |
| `llm-bulk-screen` | 5 | userId 기준 (1회당 ≤500건) |
| `job-create` | 10/10분 | userId 기준 (생성 직후 LLM 체크리스트 호출 — 비용 공격 차단) |
| `job-unlock` | 5/5분 | userId+jobId 기준 (4자리 PIN 대입 차단) |
| `interview-reevaluate` | 10 | userId 기준 |

login 은 `auth_attempts` 잠금이 더 강력 — rate-limit 별도 적용 X.
고트래픽 streaming endpoint (`/api/interview/[token]/chat`) 는 매 호출 DB 접근 비용 우려로 미적용 (필요 시 in-memory 카운터 검토).

## 0-0-1-2. 감사 로깅 위치

민감 액션 (조회/삭제/평가/메일/권한 변경 등) 에는 항상 `logAudit` 호출:
```ts
import { logAudit } from "@/lib/audit";
logAudit(req, {
  actor: me!,
  action: "candidate.delete",
  resourceType: "candidate",
  resourceId: cid,
  orgId: row.orgId,
  metadata: { name: row.name },
});
```

- fire-and-forget — `await` 불필요
- system_admin 이 본인 org 아닌 candidate 조회 시 자동으로 `metadata.cross_org=true` 마킹 (`/api/candidates/[id]` GET 참고)
- `/admin/audit` 페이지에서 cross_org 행은 amber 강조

새 민감 라우트 만들 때 logAudit 빠뜨리면 컴플라이언스 위반. PR 리뷰 체크포인트.

## 0-0-1-3. env 파일 분리 정책

| 파일 | 누가 읽나 | 들어가는 것 |
|---|---|---|
| `.env.local` | `npm run dev` (dev 모드) | **dev 전용** — `file:./data.db` / 로컬 ./uploads / dev Google key |
| `.env.production.local` | `npm run build && npm run start` (prod 모드) + 마이그레이션 스크립트 | **운영용** — Turso / Blob / 유료 Google key / 운영 SMTP |
| Vercel 대시보드 | Vercel 배포 환경 | `.env.production.local` 의 모든 값 수동 동기화 |

규칙:
- `.env.local` 에 **`TURSO_*` / `BLOB_*` 절대 X** — dev 가 운영 DB 건드림
- `lib/db.ts` 가 dev+TURSO 동시 감지 시 경고 + file fallback (`ALLOW_PROD_DB_IN_DEV=1` 우회 가능)
- `lib/storage.ts` 도 동일 가드 (`ALLOW_PROD_BLOB_IN_DEV=1`)
- 마이그레이션 스크립트: 기본 `.env.production.local` 로드 → 운영 DB. 로컬 마이그레이션은 `LOCAL_DB=1 node scripts/x.mjs`
- 운영 시크릿(CRON/INTERNAL/MASTER)은 dev 와 별도 발급 권장. **MASTER 키 변경 시 기존 enc 데이터 복호화 불가** — 운영 DB 비어 있는 지금이 교체 적기

## 0-0-1-1. 민감 정보 암호화 위치

DB 에 저장하는 운영자 입력 민감 정보 (SMTP 비번 등) 는 항상 `lib/crypto.ts` 사용:
```ts
import { encrypt, decrypt } from "@/lib/crypto";
// 저장:  dbRow.field = encrypt(plain);
// 조회:  const plain = decrypt(dbRow.field);
```

- 포맷: `enc:v1:` + base64(iv12 + tag16 + ciphertext) — AES-256-GCM
- 키: 환경변수 `MASTER_ENCRYPTION_KEY` (64 hex). 로테이션 시 `v1` 외 새 prefix 추가
- `decrypt` 는 prefix 없는 입력을 그대로 반환 (legacy 평문 passthrough → 마이그레이션 안전)
- GCM authTag 자동 검증 — 변조 시 throw

새 라우트에서 API 응답에 암호값을 노출하지 말 것. `maskPass()` 같은 헬퍼로 마스킹.

## 0-0-1. 비밀번호 정책 위치

새 라우트에서 비밀번호 받는다면 반드시:
```ts
import { validatePassword } from "@/lib/password-policy";
const r = await validatePassword(plain);
if (!r.ok) return new Response(r.errors.join("\n"), { status: 400 });
```

직접 `password.length < 6` 같이 검증 X. 정책 (10자 + 3종 + HIBP) 일관성 위해 헬퍼 강제.

오프라인 dev 환경에서 HIBP 가 timeout → 비치명적 (통과). 명시적 off: `SKIP_HIBP=1`.

UI 쪽은 `app/password-strength.tsx` 의 `<PasswordStrength>` 컴포넌트 사용.

## 0-0-3. 보안 컨벤션 (2026-06-03 보안 점검 반영)

회귀 방지용 — 새 코드 작성 시 아래 패턴을 반드시 따를 것.

### (a) 메일 HTML 에 사용자 입력 → `escapeHtml` 필수
메일 빌더에서 후보자명·공고명·가입자명·법인명 등 사용자 제어 값을 템플릿 리터럴로 보간할 땐
반드시 `import { escapeHtml } from "@/lib/mailer"` 후 `${escapeHtml(value)}`. 누락 시 이력서
파일명/이름에 심은 `<a href>` 가 법인 SMTP 발신 메일로 렌더 → 피싱. (text 버전은 비-HTML 이라 제외)

### (b) 외부 URL fetch → SSRF 가드
사용자가 준 URL 을 서버가 fetch 하면 안 됨(내부망·메타데이터 169.254.169.254 도달). 패턴:
- 채용 포털 등 임의 URL: `lib/job-url-import.ts` 의 `assertPublicUrl()`(사설/루프백/링크로컬 IP 차단
  + 수동 리다이렉트 hop 재검증)을 거치는 `fetchWithTimeout` 만 사용.
- Vercel Blob URL: `blob.vercel-storage.com`(+`BLOB_ALLOWED_HOSTS`) 호스트 화이트리스트 검증
  후 fetch (`app/api/uploads/candidate/[id]` 와 manifest 업로드 경로 참고).

### (c) 보안 응답 헤더
`next.config.ts` 의 `headers()` 가 전역 적용 — CSP `frame-ancestors`(클릭재킹), X-Frame-Options,
nosniff, Referrer-Policy(면접 토큰 Referer 유출 차단), HSTS, Permissions-Policy. **microphone 은
막지 않음**(면접 음성입력). 스크립트/스타일 CSP 는 미적용(별도 작업 필요).

### (d) TOTP 검증 → replay 방어 필수
TOTP 코드 검증은 `verifyCode` 직접 호출 금지. `import { verifyAndConsumeTotp } from "@/lib/totp-verify"`
사용 — 검증 성공한 timestep 을 `users.last_totp_counter` 에 기록하고 같은/과거 코드 재사용을 거부.

### (e) 토큰 차감/적립 멱등성
`chargeFeature`/`refundFeature`/`grantWelcomeBonus`/`applyChargePayment`/`reverseChargePayment`(결제취소
토큰회수, refType=`payment_cancel`) 는 `writeLedgerIdempotent`(INSERT 먼저 → `token_ledger_idem_uq`
부분 유니크 인덱스 위반 시 지갑 미변경)로 동시 중복 요청의 이중 차감/적립을 차단. 새 멱등 차감 추가 시
동일 패턴(non-null refType + refId) 사용. 반복 허용 항목(admin_adjust refType=null)은 인덱스 예외라
`writeLedger`(adjustTokens) 그대로. (manual_refund 는 옛 refundTokens 잔재 — 2026-06-22 제거됨.)

### (f) 비밀번호 변경 → 세션 회전
`change-password` 는 변경 후 **다른 기기 세션 전체 무효화 + 현재 토큰 회전**(탈취 세션 차단).
`password-reset/confirm` 과 동일 수준 유지.

### (g) cron/internal 인증 — fail-open 금지
cron/internal 라우트 `authorize` 는 `x-vercel-cron` 헤더 우회를 반드시 `&& !secret` 로 묶을 것
(시크릿 설정 시 헤더 위조 차단). Vercel cron 은 `Authorization: Bearer ${CRON_SECRET}` 로 인증.

### (h) 로그인 next 리다이렉트 → 상대경로만
`?next=` 같은 리다이렉트 파라미터는 내부 상대경로만 허용: `/^\/(?![/\\])/.test(next)`.
외부 절대 URL(`//evil`·`https://evil`) 차단(오픈 리다이렉트 피싱).

### (i) 사회공학 하드닝 (2026-06-03 사회공학 점검 반영)
사람의 신뢰를 악용하는 표면. 회귀 방지용 — 새 코드에서 동일 패턴 유지.

- **인증 전 정보 최소화**: 가입 전(비로그인) 응답에 정찰용 데이터를 넘기지 말 것.
  - 접속 시각(`lastSeenAt`)은 가입 전 응답에 **절대 노출 금지** — 관리자 활동 시간대 정찰·표적 공격 단서. (`check-email`, `orgs/[id]/admins`)
  - 사업자번호는 전체 노출 X — `maskBizNo()`(`lib/email-domain.ts`, `XXX-XX-*****`)로 마스킹. 식별 점수 계산엔 원본, 출력만 마스킹.
  - 담당자 이메일·이름은 `maskEmail`/`maskName` 으로만.
  - 비로그인 정찰 라우트(`check-email`/`org-search`/`org-admins`)는 **rate limit 필수**(위 표).
- **후보자 메일 = 피싱 방어 신호 포함**: 후보자(외부·미인증)에게 가는 메일(`buildInterviewEmail`)은 반드시
  ① **발신 법인명**을 본문에 노출(어느 회사인지 확인 가능), ② "비밀번호·결제·금융정보·주민번호·신분증을 요구하지 않는다 + 링크 본인 전용" 안전 안내. 발송 라우트는 법인명을 조회해 `orgName` 으로 전달.
- **법인 SMTP 발신주소 정합성**: `orgs/smtp` PUT 은 `fromEmail` 도메인이 인증된 SMTP 계정 도메인 또는
  가입 시 검증된 회사 도메인(`organizations.emailDomain`)과 일치하는지 검증. 불일치 시 400 — 타사(유명기업) 도메인 사칭 발송 차단.
- **합류 요청 = 메일함 소유 통지**: `orgs/join-requests` POST 는 인증 메일을 발송해 실제 메일함 주인에게
  합류 시도를 통지(사칭 조기 발견). 승인 화면(`/org/members` — 멤버 목록 상단의 승인대기 행)에 `emailVerifiedAt` 기반 "메일 소유 미확인" 경고를 승인 버튼 옆에 인라인으로 띄움. 최종 승인은 여전히 org_admin 이 결정.
- **토큰-only 본인확인 금지**: 면접 토큰 기반 후보자 본인 라우트(`interview/[token]/me`)는 등록 이메일이
  없으면 토큰만으로 통과시키지 말 것(링크 전달·유출 시 제3자 열람). 이메일 미보유면 403(fail-safe).

## 0-0-4. 동시 쓰기 트랜잭션 SQLITE_BUSY → 차감 누락 (WAL + 재시도 필수) (2026-06-11 QA)

**증상**: 같은 법인 평가 2~N건이 수 ms 차로 동시 완료되면 일부 토큰 차감 ledger 가 **조용히 누락**(매출 누락). 평가 결과는 정상 저장돼 알아채기 어려움.

**원인**: SQLite 단일 writer. 동시 `db.transaction()`(BEGIN IMMEDIATE)이 겹치면 즉시 `SQLITE_BUSY`. `lib/db.ts` 에 busy_timeout 미설정 + 과금 catch 가 로깅만 하고 재시도 없음(`app/api/internal/process-screenings/route.ts`). QA 재현: delete 저널 = 12동시 중 1건만 성공.

**해결** (2026-06-11):
1. **WAL 모드** — `lib/db.ts` 가 file 백엔드일 때 `PRAGMA journal_mode=WAL`(파일 헤더 영속, 모든 연결 적용). delete 저널은 락을 오래 잡아 재시도해도 실패하지만, WAL 은 빠른 락 해제로 재시도가 성공.
2. **트랜잭션 재시도** — `lib/tokens.ts` `writeLedgerIdempotent` 가 `isTransientDbError`(SQLITE_BUSY) 면 jitter 백오프로 재시도. 멱등 인덱스가 이중 차감 차단. 검증: WAL+재시도 = 20동시 모두 누락 0.

⚠️ Turso(운영)는 서버가 쓰기를 직렬화해 빈도가 낮지만, 재시도는 백엔드 무관 안전망. 새 멱등 차감/중요 쓰기는 같은 패턴 유지. 로컬 dev DB 가 delete 저널이면 `PRAGMA journal_mode=WAL` 1회 적용(서버 재시작 시 `lib/db.ts` 가 자동 설정).

## 0-0-5. 성능 컨벤션 (2026-06-11 성능 점검 반영)

회귀 방지용 — 새 코드 작성 시 아래 패턴 유지. (운영 DB 는 원격 Turso 라 쿼리 1회 = RTT 30~50ms.
순차 await 쿼리 수가 곧 응답 지연이다.)

- **`getCurrentUser` 는 React cache() 래핑** — RSC 렌더(layout+page) 중복 호출은 자동 dedupe.
  route handler 에서는 dedupe 안 되므로 헬퍼에 `me` 를 직접 전달: `isJobUnlocked(jobId, me)`
  (me 생략 시 내부에서 세션 조인 쿼리 재실행). 공고 N건 일괄 판정은 `getUnlockChecker` 사용
  (대시보드 — 면접관 집합 + 쿠키 기반 동기 판정, 공고당 DB 0쿼리).
- **독립 쿼리는 `Promise.all`** — 대시보드(`app/page.tsx`)·후보자 목록/상세 API·채팅 라우트가
  적용 예. 채팅 라우트는 후보자/공고/법인을 JOIN 1쿼리로 + 첫 턴 상태 UPDATE 를 LLM 스트림
  시작과 병렬.
- **목록/핫패스에서 `interview_sessions` 전체 `select()` 금지** — `messages`(면접 대화록 전문,
  세션당 수십 KB)가 끌려온다. 필요한 컬럼만 명시 (`status`/`evaluation` 등). `candidates`
  전체 select 도 동일 문제 (`resume_text`/`resume_masked_text`).
- **Gemini 클라이언트는 모듈 싱글톤** — `lib/gemini.ts` `vertexClient()` 가 캐시. 호출마다
  `new GoogleGenAI()` 생성 금지 (GoogleAuth 토큰 캐시가 인스턴스 단위 → 매번 JWT 서명+토큰 교환).
- **클라이언트 폴링 3원칙** — ① `document.visibilityState === "visible"` 일 때만 fetch
  (백그라운드 탭 무한 폴링 방지, 복귀는 visibilitychange/focus 로 1회 갱신), ② 응답 원문이
  직전과 같으면 setState 생략 (`app/jobs/[id]/page.tsx` `lastCandidatesJsonRef` 패턴 — 4초
  폴링이 매번 전체 리렌더+펀널 refetch 하던 문제), ③ 같은 엔드포인트 폴링 루프는 1개만
  (후보 상세에서 useEffect + setTimeout 체인 2중 폴링 사례).
- **스트리밍 UI 는 setState 스로틀** — 면접 채팅이 청크마다 setMessages 하면 메시지 누적 시
  전체 버블 리렌더 폭주. 80ms 묶음 + 종료 후 최종 1회 (`app/interview/[token]/page.tsx`).

## 0-0. SQLite CURRENT_TIMESTAMP 와 JS toISOString() 포맷 불일치

**증상**: timestamp 컬럼을 `gte/lte` 로 비교했을 때 모든 row 가 false 또는 true 로 일관되게 잘못 나옴.

**원인**:
- SQLite `CURRENT_TIMESTAMP`: `'2026-05-15 17:55:22'` (공백 separator)
- JS `new Date().toISOString()`: `'2026-05-15T17:55:22.000Z'` (T separator + ms + Z)

두 문자열이 lexicographic 으로 다르게 정렬됨 (`' '` < `'T'`). `gte` 비교 깨짐.

**해결**: `lib/auth-attempts.ts` 의 `sqliteTimestamp(date)` / `parseSqliteTimestamp(str)` 헬퍼처럼 변환 후 비교. UTC 유지.

```ts
function sqliteTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}
function parseSqliteTimestamp(s: string): Date {
  return new Date(s.replace(" ", "T") + "Z");
}
```

## 0-1. 서류 평가는 큐로 처리 — fire-and-forget 금지

**증상**: 100건 한꺼번에 평가 시작 → 대부분 429 / 일부 좀비 (status=screening 영구 머무름).

**원인**:
- Gemini 무료 티어 ~15 RPM. 동시 호출 폭주 → quota 거부.
- Vercel 서버리스가 응답 후 함수를 죽임 → fire-and-forget LLM 호출이 중간에 잘림.

**해결**: `screening_jobs` 큐 + `/api/internal/process-screenings` 워커.
- 단건/일괄 모두 enqueue 후 워커가 동시성 3 으로 처리.
- transient 실패는 backoff 후 자동 재시도 (최대 3회), permanent 실패는 즉시 환불.
- Vercel 함수 사망 대비 cron (`/api/cron/process-screenings`) 매분 안전망.

새 LLM 호출 로직 추가할 때도 같은 패턴 적용 (직접 `void someAsyncLLM(...)` 금지).

**예외 — `after()` 는 허용**: 0-1 이 금지하는 건 응답 후 잘리는 naked `void asyncLLM()` 다.
Next 16 의 `after(async () => ...)` (from `next/server`) 는 Vercel 이 응답 후에도 함수를
의도적으로 살려두는 공식 후크라 잘리지 않는다. 단, **단건·best-effort·폴백 있는** 경우만.
배치/필수 LLM 은 여전히 큐로.

- 적용 예: 공고 등록·수정(`/api/jobs`, `/api/jobs/[id]` PUT) 의 JD 요건 체크리스트 생성.
  공고는 즉시 저장·응답하고(체크리스트는 `""` 또는 기존 값 유지), `after()` 가 백그라운드에서
  생성해 행을 업데이트. 그 사이 평가는 즉석 분해 폴백으로 정상 동작 → 잘려도 치명적이지 않음.

**알림 메일도 같은 함정**: `void notifyOrgAdmins(..., {email:true})` 는 인앱 fanout(첫 await)까지만
끝나고 그 뒤 SMTP 발송이 함수 suspend 로 잘린다. 인앱 알림은 남는데 메일만 안 온다.

운영 실측 (2026-07-29, `mail_send_events` 로 합류요청 4건 전수 대조):

| 접수 | 기대 | 실제 | 발송 시점 |
|---|---|---|---|
| 7/21 | 3건 | 0건 | — |
| 7/23 | 3건 | 2건 | +20초, +181초 |
| 7/27 | 4건 | 3건 | +1초, +292초, +294초 |
| 7/29 | 4건 | 0건 | — |

**접수 직후 전량 발송이 4/4 모두 없었다.** 늦게 나간 건들은 승인 조작 시각과 겹치는데,
승인 PATCH 는 메일을 전혀 보내지 않는다 — 동결된 함수가 다음 요청에 깨어나 남은 발송을
마저 실행한 것. 즉 **유실되거나 수 분 뒤 도착**하며, 지연 발송 cron 같은 건 존재하지 않는다.
같은 요청 안에서 인증메일(`await`)은 +1초, 담당자 메일(`void`)은 +292초로 갈렸고,
일정 확정 메일(`await sendScheduleConfirmationEmails`)은 9건이 3초 안에 전량 나갔다.

**`notify*` 를 `{email:true}` 로 호출하는 새 코드는 반드시 `after()` 로 감쌀 것.**
메일이 걸린 경로는 2026-07-30 기준 전부 정리됐다 — 합류요청 3경로(`orgs/join-requests`,
`auth/signup-via-invite`, `invites/[token]/accept`), 이의제기(`interview/[token]/appeal`),
도메인 신고(`orgs/domain-review`), 신규 법인·동일 도메인 통지(`orgs`).
남은 `void notify*` 는 `skipEmail`/`email:false` 라 메일이 없는 인앱·Slack 전용 호출뿐이다
(`complete:192·253`, `stage:169`, `admin-request:76`) — 인앱 fanout 은 첫 await 라 대체로
살아남지만, Slack 통지는 같은 이유로 유실될 수 있다.
⚠️ 로컬 dev 는 함수가 죽지 않아 이 버그가 **재현되지 않는다** — 로컬 통과 ≠ 운영 정상.

## 0-2. 이력서 업로드 → **자동 평가 enqueue** (과금은 평가 성공 시 후차감)

⚠️ 과거 "자동 평가 안 함 — 사용자 검토 게이트" 서술은 **stale**. 현재 코드는 업로드 직후 자동으로 큐에 넣고 워커를 깨운다.

**동작**: `POST /api/jobs/[id]/candidates` 가 후보자 insert 후 `enqueueScreening`(`app/api/jobs/[id]/candidates/route.ts:780`) + `triggerWorker`(:603) 를 호출 → 사용자 클릭 없이 평가 시작. **차감은 업로드/enqueue 시점이 아니라 워커가 평가 성공한 시점에 후차감**(`chargeScreeningSuccess`, refType=`screening_job`). enqueue 실패해도 업로드 자체는 성공 — 후보자 상세에서 재시도 가능.

**수동 재평가/재시도**: `POST /api/candidates/[id]/screen`(단건) / `bulk-screen`(일괄). 잔액이 0 이하면 402 차단(`lib/wallet-guard.ts`).

## 0-2-2. 이력서 업로드는 지원자 동의 확인 게이트가 있음

**증상**: 업로드 API 호출 시 400 + `{code:"applicant_consent_required"}`.

**원인**: 의도된 동작. 채용기업이 지원자로부터 AI 평가 적용·처리위탁(국외 인프라 포함)에 대한 동의를 받았음을 체크박스로 확인해야 업로드 가능. PIPA §15·§26·§28의8·§37의2 책임을 채용기업으로 전가하는 메커니즘.

**해결**: 업로드 페이지의 "지원자 동의 확인" 체크박스 체크. API 직접 호출 시 `applicantConsentConfirmed: true` (JSON) 또는 `applicantConsentConfirmed=true` (multipart) 첨부. 표준 동의 문구는 `/legal/applicant-consent-template`. 이용약관 §5 와 연동.

**legacy row**: 2026-05-22 이전 createdAt 후보자는 동의 컬럼 NULL 허용 — screen API 가 면제.

## 0-3. resume_text / 파일이 비어있는 후보자

**증상**: 오래된 후보자의 resume_text 가 빈 문자열, 파일 다운로드 안 됨.

**원인**: `/api/cron/purge-original` 가 평가 완료 후 30일(`PURGE_AFTER_DAYS`) 경과분 자동 삭제. PIPA 가명처리.

**해결**: 정상 동작. 평가 결과(screeningReport, evaluation)는 보존되어 점수/추천은 그대로 조회 가능. 원본이 필요하면 재업로드.

## 0-4. 폴더/ZIP 업로드 응시자 그룹화 (`lib/file-classify.ts`)

**증상**: 여러 명의 이력서가 든 폴더(또는 ZIP)를 올렸는데 후보자 1명으로만 등록됨.

**원인**: 파일명이 `직무_이름_날짜_번호.pdf` (예: `기술지원_임채주_20260530_0100001.pdf`) 형태일 때, 모든 파일이 공유하는 직무 prefix(`기술지원`)를 사람 이름으로 오인해 전원 한 그룹으로 묶임. (폴더명에 "이력서"가 들어가면 폴더 fallback도 한 그룹으로 뭉침.)

**해결**: `groupFiles` 가 **배치 인지(2-패스)** 로 동작. 1패스에서 파일별 이름 토큰(`nameTokens`)의 배치 빈도를 세어 60%+(2개 이상)에 등장하는 토큰을 "공통(직무/카테고리) 토큰"으로 분류 → 제거하고, 파일마다 달라지는 토큰을 사람 이름으로 분리. 공통 토큰이 곧 이름인 "한 명 다(多)문서" 케이스는 토큰이 다 지워지면 원래 토큰으로 복귀해 1명으로 유지.

**한계**: 파일명에 이름 신호가 전혀 없는 플랫 폴더(`이력서_0001.pdf`, `이력서_0002.pdf` …)는 파일명만으로 사람 구분 불가 → 폴더명으로 묶여 1명+첨부로 등록됨 (파싱 전 단계라 내용 기반 분리는 안 함). 이 경우는 개별 파일로 다시 업로드 권장.

**튜닝 포인트**: 공통 토큰 임계(`Math.ceil(N * 0.6)`), 직무어 사전(`NON_PERSON_TOKENS`), 노이즈(`NAME_NOISE`).

**메인 이력서 선정 (동점 시 큰 파일, 2026-06-08)**: 한 그룹에 `이력서_홍길동.pdf`·`이력서_홍길동2.pdf` 처럼 **둘 다 "이력서" 명시**된 파일이 있으면 `resumeScore` 가 동점이 된다. 예전엔 stable sort 라 입력 순서가 갈라(작은 파일이 먼저 오면 메인이 되어, 진짜 메인 이력서가 첨부로 밀림). 이제 `groupFiles`·`mergeGroupsByName` 둘 다 동점이면 `buf.length` 내림차순(파일 크기 큰 쪽)을 메인으로 채택 — 내용이 많은 파일이 진짜 이력서일 확률이 높다는 가정.

## 0-5. 중복 이력서가 별개로 등록 + 같은 이력서 점수가 매번 다름 (2026-06-03)

**증상**: 같은 사람 이력서를 ZIP A·B 로 두 번 올렸더니 후보자 2명으로 생성되고, 점수도 크게 다름(예 52 vs 68).

**원인 1 (중복)**: 업로드 dedup 은 **파일 바이트** SHA-256(`resume_hash`)만 본다. 재저장·재export·다른 ZIP 으로 만든 동일 이력서는 바이트가 달라 통과한다.

**원인 2 (점수)**: 후보자 2명 = **독립 평가 2회**. Gemini 는 비결정적이고, `recomputeScore` 의 spread(×1.4)·절벽형 캡들이 작은 차이를 증폭한다. 범주 판정 1개만 뒤집혀도 12점+ 점프.

**해결** (2026-06-03):
1. **2차 dedup (내용 해시)** — 워커가 파싱 후 `resume_content_hash`(본문 정규화 SHA-256) 비교. 같은 공고에 동일 내용이 *먼저*(작은 id) 있으면 평가 없이 자동 삭제 (`lib/screening.ts runScreeningOnce`). 바이트가 달라도 본문 같으면 잡힘.
2. **점수 일관성** — screening `temperature: 0` + `screening_cache`(prompt_hash 캐싱). 같은 입력은 LLM 재호출 없이 같은 결과 재사용.

⚠️ **내용이 진짜로 다르면(다른 버전)** 여전히 별개 후보자 + 다른 점수가 정상. "동일한데 다르다" 면 운영 DB 에서 `resume_content_hash` 가 실제로 같은지 먼저 확인.
⚠️ recomputeScore 의 spread(×1.4)는 **변별력용 의도된 설계** — 함부로 끄지 말 것. 점수 흔들림(동일 입력)은 temp+캐시로 해결. 단, 미스매치 보정은 §0-6 참고(cap 방식).

## 0-6. 6축은 30~50인데 종합 점수가 한 자릿수로 폭락 (2026-06-18)

**증상**: 서류 리포트의 6축 점수는 30~50인데 종합 총점이 4점처럼 폭락. 화면의 감점(오버스펙 −5)만으로는 설명이 안 됨.

**원인**: `recomputeScore` 가 `spread` 로 압축한 점수(예 32→21)에 **additive 감점**(focus fail −12, 직급 −5, confidence −10)을 또 빼서 누적 폭락. spread 압축과 focus 감점은 UI 에 안 보여 "축은 30~50인데 총점 4"가 모순처럼 보였다. 결과적으로 "부적합하지만 실재하는 경력자"와 "백지 이력서"가 둘 다 한 자릿수로 뭉개져 변별 불가.

**해결** (2026-06-18):
1. **감점을 cap 으로 통일** — focus fail→`FOCUS_FAIL_CAP`(68), 직급 over/under→`LEVEL_OVER_CAP`(95)/`LEVEL_UNDER_CAP`(90), confidence→`LOW_CONF_CAP`(84). cap 은 이미 낮은 점수엔 무영향이라 폭락이 멎고, 고득점만 끌어내린다(=나머지 6개 게이트와 동일 방식). strong_pass 가점(+12)만 additive 유지. 직급 보정은 코드 주석/프롬프트가 줄곧 "오버스펙 ≤95"라 적어온 의도와도 일치.
2. **`SCREENING_SCORING_VERSION` 캐시 버스트** — `screening_cache` 는 `report`(=recomputeScore 까지 반영된 최종 결과)를 캐싱하는데 키에 채점 버전이 없어, 산식을 고쳐도 옛 점수를 그대로 돌려줬다("패치했는데 그대로"의 진범). 이제 prompt_hash 에 `v{버전}` 포함.
3. **백필** — 이미 평가된 후보는 `scripts/backfill-screening-scores.ts` 로 저장 리포트에 새 산식을 재적용(LLM 재호출 없음 = 과금 0, 기본 dry-run).

🚨 **`recomputeScore` 의 산식/상수를 바꾸면 반드시 `SCREENING_SCORING_VERSION` +1.** 안 하면 캐시가 옛 점수를 계속 돌려줘 수정이 반영 안 된다 (재평가해도 동일).

## 0-7. "나이 1993년생" → 19세로 추출 (2026-07-17)

**증상**: 1993년생 후보자(candidate 29)의 나이가 **19세**로 표시. 이력서 원문 헤더는 `이름 송명수 영문 Song Myung Su 나이 1993년생`.

**원인**: 이력서가 **나이 칸에 나이가 아니라 생년을 적는 표기**(한국 이력서에 흔함)를 쓰는데, `lib/pii-extract.ts` `RE_AGE_LABEL` 의 `(\d{1,2})` 에 **끝 경계 가드가 없었다**. `[세歳]?` 도 옵션이라 `나이 1993년생` 에서 `19` 만 떼어가고, 19 는 유효 범위(14~90)라 정상값으로 확정. 게다가 나이가 한번 잡히면 `if (result.age == null)` 때문에 DOB 폴백을 건너뛰어, **생년월일이 멀쩡히 있어도 잘못된 값이 이겼다** (`나이 1993년 5월 15일` → age=19, dobYear=1993). 연도만 적는 `1993년생` 은 `RE_DOB_YEAR`(완전한 날짜만 인식)가 못 잡아 33 을 계산할 경로 자체가 없었다.

같은 패턴이 `lib/mask.ts` 나이 라벨 규칙에도 있어 **마스킹이 생년을 반쪽만 가렸다** — `나이 1993년생` → `[나이]93년생`, `나이 1993년 5월 15일` → `[나이]93년 5월 15일`(생년월일 통째로 잔존). LABELS(나이) 가 `applyBasic`(RE_DOB) 보다 **먼저** 돌아 `1993` 을 깨뜨리는 바람에 뒤이은 RE_DOB 도 못 잡는 구조였다.

**해결**:
1. `RE_AGE_LABEL` / mask 나이 라벨에 **끝 가드 `(?!\d)`** — 숫자가 더 붙으면 나이가 아니라 연도로 보고 넘긴다. (이것만으로 DOB 폴백이 되살아나 `나이 1993년 5월 15일` 도 자동 해결)
2. `RE_BIRTH_YEAR` 신설(`pii-extract` + `mask` 양쪽) — `1993년생` / `93년생` 연도 단독 표기를 생년으로 인식. 2자리는 19xx/20xx 중 만 나이가 유효 범위에 드는 쪽(둘은 100년 차이라 77년 폭 범위에 동시에 못 듦).

🚨 **나이/연도 정규식에 `\d{1,2}` 를 쓸 땐 끝 가드 `(?!\d)` 필수.** 없으면 4자리 연도의 앞 두 자리를 조용히 나이로 읽는다. `lib/mask.ts` `RE_PHONE` 주석의 시작 가드 정책과 같은 계열의 함정.

⚠️ **이미 저장된 나이는 재평가로 안 고쳐진다** — `lib/screening.ts` 가 `age: c.age ?? pii.age` 라, 값이 이미 있으면 재파싱해도 유지된다. 잘못 저장된 행은 `age` 를 null 로 비우고 재평가하거나 직접 UPDATE.

## 1. Gemini 모델 선택 (paid tier, 2026-05-26 통합)

**현재 셋업**: paid tier. 모든 task 가 Vertex AI 서울 + flash 로 단일화.

| Task | 모델 | 엔드포인트 | 위치 |
|---|---|---|---|
| `screening` | `gemini-2.5-flash` | Vertex AI (asia-northeast3) | 🇰🇷 |
| `interview` | `gemini-2.5-flash` | Vertex AI (asia-northeast3) | 🇰🇷 |
| `interviewEval` | `gemini-2.5-flash` | Vertex AI (asia-northeast3) | 🇰🇷 |

호출 시 `task` 파라미터만 넘기면 됨:
```ts
createChat({ task: "interview", systemInstruction, history });
generateJSON<X>(prompt, { task: "screening" });
generateJSON<X>(prompt, { task: "interviewEval" });
```

SDK: **`@google/genai`** 단일 (vertexai: true 고정).

**구조화 출력(responseSchema) — 서류평가는 필수**: `responseMimeType: "application/json"` *만* 쓰면 Gemini 가 긴 한국어 자유서술 필드(summary·reason 등)에서 **간헐적으로 깨진 JSON**(이스케이프 누락)을 뱉어 `parseJsonResponse` 가 실패 → UI 에 "AI 응답 형식 오류"(`shortenError`). `finishReason=STOP`(정상완료)인데도 파싱 실패하면 이 케이스다. screening 은 `generateJSON(prompt, { task, responseSchema: SCREENING_SCHEMA })` 로 스키마를 넘겨 유효 JSON 을 보장한다(`lib/screening.ts` SCREENING_SCHEMA — prompts.ts 출력 형식과 1:1 일치 유지). 큰 자유서술 JSON 을 새로 추가하면 동일하게 responseSchema 를 권장.

**Vertex AI 서울 응답 시간**: 13K char 프롬프트 기준 30~40초. 비동기 task (screening / interviewEval) 는 큐 처리라 UX 영향 X. interview 는 thinkingBudget=128 로 3~4초 응답 유지.

**환경변수** (모두 Vertex 용):
- `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (기본 `asia-northeast3`)
- 로컬: `GOOGLE_APPLICATION_CREDENTIALS` (서비스계정 JSON 파일 경로)
- Vercel: `GOOGLE_APPLICATION_CREDENTIALS_JSON` (JSON 통문자열)

**왜 flash 통일인가**: asia-northeast3 데이터 레지던시는 Flash 만 보장됨 (Pro 미지원, 2026-05 기준). Pro 사용 시 직접 API (US) 경유 → §28의8 동의 항목 부활. UX 단순화를 위해 flash 선택.

**과거 메모** (참고): 2026-04 무료 티어 daily limit=0 으로 flash-lite 고정 → 2026-05 paid 전환 → 2026-05-26 모든 task Vertex 서울+flash 로 통합.

## 1-1. LLM 응답은 재현되지 않는다 — 점수 안정성은 캐시가 전부 (2026-07-27)

**증상**: 서류평가 프롬프트를 한 줄 고쳤더니 후보 점수가 46 → 56 → 47 로 널뛴다.

**실측** (candidate 291, gemini-2.5-flash, `temperature: 0`, responseSchema 적용):

| 조건 | 결과 |
|---|---|
| 동일 프롬프트 2회 | 66점 / 56점 (6축 tech 85↔75, exp 50↔30) |
| `seed: 7` 고정 3회 | 54 / 44 / 50점 |

`temperature: 0` 도 `seed` 도 재현성을 주지 못한다. Vertex 의 seed 는 best-effort 이고
thinking 모델(thinkingBudget)에서는 사실상 무효다. **종합 점수가 호출마다 ±10점 흔들린다.**

**그런데 왜 평소엔 안정적인가**: `screening.ts` 의 `screening_cache` 가 `promptHash`
(= scoring version + jobId + 프롬프트 전문) 로 결과를 캐시하기 때문. 같은 이력서·공고·프롬프트면
첫 계산 결과를 계속 재사용한다. **이 캐시가 점수 안정성의 유일한 장치다.**

**따라서**:
- `lib/prompts.ts` / `lib/screening.ts` 의 프롬프트를 고치면 cache miss → **이후 재평가되는 모든
  후보의 점수가 재추첨**된다. 오탈자 수정도 평가 결과를 바꾸는 변경으로 취급할 것.
- 프롬프트 A/B 를 단발 호출로 비교하지 마라. 노이즈(±10)가 웬만한 실제 차이보다 크다 —
  실제로 후보 6명 1회씩 비교해 나온 "평균 5점 차" 는 노이즈와 구분되지 않았다.
  유의미하게 재려면 조건당 N회 반복 평균이 필요하고, 그만큼 호출 비용이 든다.

## 2. Google AI Studio 키 발급

**증상**: 발급한 키도 `limit: 0`

**원인**: GCP 결제가 연동된 프로젝트에서 발급하면 무료 티어가 자동 비활성화됨.

**해결**: aistudio.google.com → "Create API key in new project" (결제 미연동 프로젝트). 또는 한 번도 결제 연동된 적 없는 새 Google 계정 사용.

## 3. Next.js 16

**핵심 차이점**:
- middleware → **`proxy.ts`** (파일명 변경)
- `params`는 Promise: `{ params }: { params: Promise<{ id: string }> }` → `const { id } = await params;`
- API route 인자 시그니처 변경됨

**확인**: `node_modules/next/dist/docs/01-app/` 안의 마크다운 문서 직접 읽기. 학습 데이터 기반 추측 금지.

## 3-1. instrumentation.ts — import 체인은 반드시 Edge-safe

**증상**: dev/build 로그에 `A Node.js module is loaded ('node:crypto' ...) which is not supported in the Edge Runtime` + `Import trace: Edge Instrumentation: ./lib/logger.ts → ./lib/error-reporter.ts → ./instrumentation.ts`. Node 런타임은 정상 동작해 헬스체크는 200 이라 놓치기 쉽지만, **onRequestError 가 Edge 런타임(proxy 등)에서 작동 안 하고 운영 빌드 경고**.

**원인**: `instrumentation.ts` 의 `onRequestError` 는 **Node + Edge 양쪽 런타임 모두에 번들**된다. 거기서 (직·간접으로) import 하는 모듈이 `node:*` (예: `node:crypto`) 를 쓰면 Edge Instrumentation 번들이 깨진다. `instrumentation → error-reporter → logger` 체인이 대표적.

**해결**: 이 체인의 모듈은 `node:*` import 금지. 글로벌 Web Crypto 만 사용 (`crypto.randomUUID()` 는 Node 22·Edge 양쪽 글로벌). 현재 `lib/logger.ts`·`lib/error-reporter.ts` 는 `randomBytes` 대신 `crypto.randomUUID().replace(/-/g,"")` 사용. 새 코드를 이 체인에 끌어들일 때 동일 규칙 유지. **검증은 dev 재시작 필수** (instrumentation 은 boot-time 로드라 HMR 안 됨 — proxy.ts 와 동일, §7 참고).

## 4. pdf-parse v1

**증상**: 업로드 시 `ENOENT: no such file or directory, open '.../test/data/05-versions-space.pdf'`

**원인**: pdf-parse v1.x의 `index.js`에 디버그 코드가 있어서 모듈 import 시 테스트 파일 읽으려고 시도함.

**해결**: 서브경로 import 사용
```ts
const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
```
`lib/pdf-parse.d.ts`에 타입 선언 있음. v2로 업그레이드는 Turbopack worker 이슈로 실패함 (이미 시도해봄).

### 스캔 PDF(텍스트 레이어 없음) → Gemini 멀티모달 OCR fallback

**증상**: 정상 PDF인데 서류 평가가 "이력서 텍스트 추출 실패 (스캔 PDF 또는 빈 파일)."로 실패.

**원인**: 글자가 이미지로 들어간 스캔/캡처 PDF는 pdf-parse 가 빈 텍스트(줄바꿈만)를 반환 → 30자 미만 → 영구 실패.

**해결**: `lib/screening.ts` `ensureParsed()` 에서 PDF 텍스트가 30자 미만이면 `ocrPdfToText()` 가 PDF 원본을 `generateJSONMultimodal`(Vertex 서울 리전 flash)에 직접 넘겨 OCR. 별도 OCR 인프라 없음 → 데이터 국외이전(§28의8) 회피 유지. 14MB 초과 PDF·OCR 빈 결과는 기존 에러로 폴백. 비용 절감 위해 **스캔 PDF일 때만** 타는 경로(정상 텍스트 PDF는 영향 없음). OCR 자체는 ~50초 소요(7페이지 기준)라 worker maxDuration(120s) 안에서 처리됨.

**⚠️ 개인정보 게이트 — `organizations.allowScanOcr` (기본 OFF)**: OCR 은 정상 PDF 의 "로컬 마스킹 후 전송" 원칙과 달리 **마스킹 전 원본** 이력서를 AI 수탁자(Vertex)로 보낸다. 그래서 법인이 명시적으로 토글을 켠 경우(`allowScanOcr=true`)만 OCR 이 돌고, 꺼져 있으면 스캔 PDF 는 평가 실패. 이때 `ensureParsed()` 는 PDF+OCR미허용 케이스를 구분해 **"스캔 PDF OCR을 활성화하면 평가할 수 있습니다"** 라는 안내성 `lastError` 를 남긴다 → 공고 카드는 "스캔 PDF — OCR 활성화 필요"(`shortenError`), 후보 상세는 amber 배너로 OCR 활성화/재업로드 안내. (OCR 허용인데도 빈 결과면 이미 시도한 것이라 generic "텍스트 추출 실패" 메시지.) 토글은 `app/org/settings` 법인 설정 페이지(org_admin/system_admin 전용, 경고문 포함) + `PUT /api/orgs/me/scan-ocr`. OCR 전송 시 `candidate.scan_ocr` 감사 로그(critical) 기록. 켜기 전 **처리방침·후보자 동의 범위 정비 선행 필요**. 추출 직후 마스킹되므로 *평가*에 쓰는 텍스트·DB 저장본은 여전히 마스킹본(블라인드 유지).

## 5. Drizzle 상관 서브쿼리 + libSQL

**증상**: `(SELECT ... FROM ${interviewSessions} WHERE candidate_id = ${candidates.id} ...)` 같은 상관 서브쿼리가 모든 행에 같은 값 반환.

**원인**: 정확히 모르겠지만 Drizzle/libsql 조합에서 outer column 참조가 깨지는 케이스 있음.

**해결**: 별도 쿼리로 가져와서 JS에서 merge. 실제 사례: `app/api/jobs/[id]/candidates/route.ts`의 GET에서 후보자 목록 + 면접 세션 분리 조회 후 Map으로 매칭.

### 5-1. JOIN 없는 단일 FROM 쿼리는 `sql` 템플릿 안의 `${table.col}` 이 접두어를 잃는다 (2026-06-26)

**증상**: `sql\`SUM(CASE WHEN ... AND (SELECT s.status FROM interview_sessions s WHERE s.candidate_id = ${candidates.id} ...) ...)\`` 같은 상관 서브쿼리 집계가 **항상 0/상수**. 같은 SQL 을 raw 로 직접 실행하면 정상.

**원인**: Drizzle 은 **JOIN 이 없는 단일 테이블 쿼리**(`.from(candidates)` 만)에서 컬럼을 접두어 없이 렌더한다 — `${candidates.id}` → `"id"` (NOT `"candidates"."id"`). 그 `"id"` 가 서브쿼리 안에서 `interview_sessions s` 의 `id` 컬럼으로 오결합되어 `s.candidate_id = s.id` 가 되고, 거의 항상 false → 0. (대시보드의 `jobsRaw`·`myInterviewerJobs` 가 같은 패턴인데도 멀쩡한 건 **JOIN 이 있어** Drizzle 이 `"candidates"."id"` 로 정규화하기 때문.)

**해결**: 서브쿼리의 외부 컬럼 참조는 `${candidates.id}` 대신 **리터럴 `candidates.id`** 로 쓴다(`sql` 템플릿에 테이블명을 직접 박음 → SQLite 가 외부 테이블로 정확히 상관). `app/page.tsx` 의 `awaitingAgg`(지원자 응답 대기 집계)가 실제 적용 사례. 진단법: `query.toSQL().sql` 을 찍어 `WHERE s.x = "id"` 처럼 접두어 없는 외부 참조가 있는지 확인.

## 6. Edge runtime 제약

**걸리는 것**:
- bcryptjs (Node crypto 의존 — 그래도 bcryptjs는 됨, bcrypt는 안 됨)
- `@libsql/client` 일부 기능
- nodemailer

**해결**: 모든 API 라우트에 `export const runtime = "nodejs"` 명시. middleware(`proxy.ts`)는 Edge에서 돌지만 DB 호출 안 함 (쿠키 존재만 체크).

## 7. proxy.ts (미들웨어) 변경

**증상**: matcher / 코드 바꿔도 동작 안 함

**원인**: Turbopack은 코드 변경은 핫리로드하지만 middleware는 dev 서버 재시작 필요.

**해결**:
```powershell
Get-NetTCPConnection -LocalPort 3003 | Select-Object -First 1 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
npm run dev
```

## 8. drizzle-kit push가 "DATA LOSS" 경고로 막힐 때

**증상**: NOT NULL + DEFAULT 컬럼 추가 시도가 "data loss" 경고로 중단.

**원인**: drizzle-kit이 안전하게 보수적으로 판단함. CI/non-TTY 환경에서 프롬프트 못 띄워서 그냥 에러.

**해결**: 직접 ALTER 실행
```javascript
// node -e "..." 또는 임시 스크립트
const Database = require('better-sqlite3'); // 또는 libsql
db.prepare('ALTER TABLE x ADD COLUMN y INTEGER NOT NULL DEFAULT 0').run();
```
※ 현재 codebase에서 better-sqlite3는 제거됨. libsql client로 같은 작업 가능.

## 8-1. FK/인덱스 드리프트 — `ALTER ADD COLUMN` 의 `REFERENCES` 에 ON DELETE 누락 주의 (2026-06-13)

**증상**: 멤버 계정/법인 삭제가 FK 제약 위반 500 으로 실패 (스키마는 `onDelete: "set null"` 인데 실제 DB 는 `NO ACTION`). 또는 스키마에 있는 FK·unique 인덱스가 운영 DB 에만 없음.

**원인** (두 갈래):
1. SQLite 의 `ALTER TABLE ADD COLUMN x REFERENCES t(id)` 는 ON DELETE 절을 안 쓰면 NO ACTION 으로 생성된다. drizzle 스냅샷은 schema.ts 기준(`set null`)으로 기록되므로 **`db:generate` 가 드리프트를 영영 감지 못 한다** (0017 이 실제 사례 — `interview_sessions.created_by_user_id`).
2. 운영 Turso 는 초기 테이블이 `db:push`(setup-fresh-db) 로 선생성된 이력이 있어, 베이스라인 마이그레이션(0000)의 FK·인덱스 일부가 실제로는 적용된 적이 없다 (`meeting_link_sent_by_user_id`/`applicant_consent_confirmed_by_user_id` FK, 토큰 unique 인덱스 3종, `idx_org_email_domain` UNIQUE 잔존이 실제 사례 — 0025 에서 일괄 복구).

**해결**:
- 점검: `node scripts/check-fk-drift.mjs` (기본 운영 / `$env:LOCAL_DB="1"` 로컬) — 최신 스냅샷 vs 실제 DB 의 FK ON DELETE·인덱스 비교. 읽기 전용.
- 복구: SQLite 는 FK 절 변경에 ALTER 미지원 → 테이블 재생성 마이그레이션 (`drizzle-kit generate --custom`, 스냅샷이 이미 올바르므로 일반 generate 는 빈 diff).
- 예방: 마이그레이션 SQL 의 `ADD COLUMN ... REFERENCES` 에 ON DELETE 절이 schema.ts 와 일치하는지 `db:generate` 후 눈으로 확인.

### ⚠️ 2026-06-13 사고: 테이블 재생성이 운영 데이터를 연쇄 삭제 — "FK OFF 가드" 는 불충분

`drizzle/0025_fix_fk_index_drift.sql` 이 운영(vercel-build)에서 실행될 때, 첫머리의 `PRAGMA foreign_keys=OFF` + FK 가드(존재 불가 user_id INSERT)는 **통과**했지만, Turso(hrana-over-HTTP)는 연결 재수립 시 세션 PRAGMA 가 기본값(ON)으로 리셋된다. 후반의 `DROP TABLE job_postings` 시점엔 FK 가 다시 ON → 암묵 DELETE 가 `candidates.job_id CASCADE` 를 발동 → candidates·screening_jobs·interview_sessions·interview_schedules·interviewer_notes·job_interviewers 전부 소실. **로컬(file:) 연결은 PRAGMA 가 유지되므로 로컬 리허설 통과가 운영 안전을 보장하지 않는다.**

이후 규칙 (CLAUDE.md 최상단 "운영 데이터 보호 절대 규칙"과 한 몸):
1. **자식이 CASCADE 로 참조하는 부모 테이블의 재생성(DROP 포함)은 vercel-build 자동 적용 금지.** 자식 없는 테이블(예: interview_sessions)만 재생성 마이그레이션 허용.
2. 부모 테이블 재생성이 꼭 필요하면 수동 절차: 사용자 승인 → `turso db dump` 백업 + PITR 시점 기록 → 트래픽 없는 시점에 단일 세션(`turso db shell`)에서 적용 → 행수·`PRAGMA foreign_key_check` 검증.
3. `scripts/db-migrate.ts` 가 이중 방어: destructive statement(DROP TABLE/DELETE FROM/DROP COLUMN, `__` 접두 임시 테이블 제외)는 `ALLOW_DESTRUCTIVE_MIGRATION=1` 없이 거부 + **모든 DROP TABLE 직전 `PRAGMA foreign_keys` 재확인, ON 이면 즉시 중단**. 이 가드 우회·완화·삭제 금지.
4. 0025 의 SQL 을 재생성 "패턴" 으로 참고하지 말 것 — 부모 테이블에 한해 안티패턴이다.

## 9. 한국어 인코딩 / Windows PowerShell

**증상**: `bash`의 `cat`, `dir` 명령이 한국어 깨짐, 또는 Windows에서 동작 안 함.

**해결**:
- 파일 읽기는 Read 도구 사용
- 디렉토리 리스팅은 Glob 도구 사용
- PowerShell 직접 호출 시 한국어 출력은 깨질 수 있음 — Bash로 ls (Git Bash 포함)

## 10. Vercel Blob vs 로컬 파일

**저장 키 컨벤션**:
- 로컬: 파일명 (`1700000000_abcd.pdf`)
- Blob: 전체 URL (`https://xxx.private.blob.vercel-storage.com/...`)

**Blob 은 private 스토어** (2026-07-12 전환): URL 을 알아도 인증 없이는 403. 읽기는 반드시 `fetchBlobFile()`(내부에서 `get()` + 토큰) 또는 `readStoredFile()` 경유 — 일반 `fetch(url)` 는 403 난다. 호스트에 `.public.` 이 있으면 legacy 키(전환 전 잔존 — 마이그레이션 완료로 운영엔 없음)로 간주해 일반 fetch 로 분기한다.

⚠️ **파일 키를 저장하는 새 DB 컬럼을 추가하면 `app/api/cron/blob-orphans` 의 `collectKnownKeys` 에도 반드시 등록** — 월간 스위퍼가 30일+ 미참조 blob 을 자동 삭제하므로, 등록을 빠뜨리면 그 컬럼의 정상 파일이 고아로 오판된다 (양수 방어는 "삭제 대상 > max(50, 전체 10%) 면 중단" 브레이커뿐).

**`resumeFilePath` 컬럼은 둘 중 어느 것이든 저장 가능**. 다운로드 시 **항상 `/api/uploads/candidate/[id]` 사용** (2026-05-16 부터). 이 라우트가:
- 세션 + ownsOrg + 부모 공고 PIN 잠금 검증
- Blob URL 이어도 server-side 로 읽어 stream proxy → Blob URL 외부 노출 X

⚠️ `lib/storage.ts` 의 `getDownloadUrl` 은 제거됨 (2026-07-03, 인증 우회 footgun). 다운로드 URL 을 직접 만들지 말고 항상 위 프록시 라우트 사용.

⚠️ **content-type 필수 — octet-stream 으로 저장하면 PDF 가 inline 대신 다운로드됨** (2026-06-03):
- 다운로드 라우트는 `Content-Disposition: inline` 을 보내지만, `Content-Type: application/octet-stream` 이면 브라우저는 inline 무시하고 무조건 다운로드한다.
- 다운로드 프록시는 Blob 이 저장한 content-type 을 그대로 흘려보낸다 → **업로드 시점에 정확한 타입을 박아야 함**.
- `saveFile()` 은 `contentType` 미지정 시 `contentTypeFromName(originalName)` (확장자 기반)으로 도출한다. 새 업로드 경로 추가 시 **확장자가 살아있는 파일명을 넘길 것**.
- 클라이언트 직접 Blob 업로드(`@vercel/blob/client` `upload()`)는 pathname 확장자에서 자동 도출되므로 OK. 단 **ZIP 추출 항목은 `saveFile` 을 거치므로** 위 규칙 적용 대상.

## 11. 이메일 발송 환경변수

**필수 4개**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (없으면 mailer가 에러 throw)
**선택**: `SMTP_FROM` (없으면 `SMTP_USER`로 fallback), `MAIL_RATE_PER_SEC` (기본 2)

⚠️ **`SMTP_USER` 는 전체 이메일 주소**여야 하는 서버가 많다 — 로컬파트만 넣으면 `535 인증 실패`
(2026-07-25 회사 SMTP 전환 때 실제로 겪음). 실패 메시지가 "인증 실패"면 이걸 가장 먼저 볼 것.

**포트 판정**: 코드가 `port === 465` 일 때만 `secure: true`. 587 서버는 STARTTLS 로 붙는다.

### 동시 발송 rate limit (2026-06-11 사고)

발신 서버가 **초당 발송률을 제한**하면 동시 발송이 몰릴 때 일부가 4xx 로 조용히 거부된다
(일괄 불합격 통보 6건 중 4건 누락 — 당시 발신 SaaS 의 5rps 팀 한도). 발신 경로를
회사 SMTP 로 옮긴 뒤에도 서버마다 한도가 있으니 전제는 그대로다. 대응은 `lib/mailer.ts` 에 내장:

- 모든 transporter 가 **pooled** + `rateLimit`(`MAIL_RATE_PER_SEC`, 기본 2/s) 로 발송 페이싱.
- 일시 오류(SMTP 421/429/45x, 소켓 오류)는 **지수 백오프로 3회 재시도**.
- 법인 SMTP transporter 는 orgId 별 캐시 (설정 변경 시 fingerprint 로 자동 재생성).

→ 대량 발송 경로를 새로 만들 때 `sendMail` 만 쓰면 페이싱이 자동 적용된다. 단 **페이싱은
프로세스 단위** — 서버리스 다중 인스턴스 합산이 서버 한도를 넘기면 재시도가 흡수한다.
발신 서버 한도가 넉넉해지면 `MAIL_RATE_PER_SEC` 만 올리면 됨.

**대량 발송 라우트 컨벤션** (2026-06-12): 페이싱 때문에 발송 시간 = 통수 ÷ 2/s. 그래서
① N 이 사용자 선택(≤50)인 라우트는 `maxDuration 120` (interview-links·schedule-propose),
② N 이 무제한인 경로(closeJob 통보)는 **검증·DB 작업만 동기로 하고 발송은 `after()` 백그라운드**
+ 호출 라우트 `maxDuration 300` (after 도 maxDuration 안에 끝나야 함 — 2/s × 300s ≈ 600통 상한),
③ 메일 보내는 cron(expire-interviews·interview-reminders)도 `maxDuration 120` 명시.
④ after() 발송은 성공 건만 카운터(`decisionEmailCount` 등) 증가 — 함수가 죽어 유실돼도
후보 상세 "재발송" 으로 복구 가능 (프로세스 내 큐의 유실 보완책). 발송 보장이 필수가 되면
DB 아웃박스 테이블로 승격.

## 12. proxy.ts에서 보호 안 되는 경로

| 경로 | 이유 |
|---|---|
| `/login`, `/signup` | 인증 흐름 |
| `/interview/*` | 후보자가 토큰만으로 접근 |
| `/api/auth/*` | 인증 API 자체 |
| `/api/interview/*` | 후보자 면접 API |
| `/api/uploads/*` | 미들웨어 단계 면제이지만 **라우트 자체가 인증/권한 검증함** (2026-05-16 패치) |

## 13. 관리자 우회 로직 위치

| 위치 | 우회 방법 |
|---|---|
| API 서버 | `lib/job-lock.ts` `isJobUnlocked()` 안에서 `getCurrentUser().isAdmin` 체크 |
| 클라이언트 (대시보드 공고 행) | `app/components/JobRowLink.tsx` — 잠긴 공고면 `JobPinModal` 팝업, 우회 여부는 server 가 `locked` prop 으로 판정해 전달 |
| 클라이언트 ('공고' 메뉴 /jobs) | `app/jobs-list-all.tsx`의 `handleClick`에서 `if (job.blinded)` 체크 — server(`app/jobs/page.tsx`)가 `getUnlockChecker` 로 공고별 `blinded`(잠금+우회불가) 를 판정해 전달하고, 블라인드 공고는 지원 현황 수치를 아예 미전송 |

새 페이지에서 잠금 체크 추가 시 양쪽 다 챙길 것.

## 14. 한국 환경 특이사항

- Gmail SMTP 사용 가능 (다른 국가에서 차단되는 경우는 없음)
- Gemini 무료 티어 사용 가능 (단, 결제 미연동 프로젝트로 발급)
- 결제 수단 한국 카드 OK (단, Vercel은 한국 카드 거부 사례 있음 — PayPal 우회 필요할 수 있음)

## 15. 토큰·결제 법무 트리거

- 토큰을 자사 기능 외 결제(제휴사 사용·법인 간 양도)에 쓰게 하는 변경 = 전자금융거래법 선불전자지급수단 등록 검토 트리거. 현행(자사 4개 기능 전용 — `lib/tokens.ts` `FeatureKey`)은 비대상.
- 사업자등록·통신판매업 신고 완료 전에는 유상 충전 대금을 어떤 형태(계좌이체 포함)로도 받지 말 것 — 받는 순간 미신고 통신판매업(전자상거래법 §12). 수동 충전은 무상 지급·테스트 한정.

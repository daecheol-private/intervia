# 배포 가이드 (Vercel + Turso + Vercel Blob)

전부 무료 티어로 배포 가능. 예상 소요 시간 약 20분.

---

## 1. Turso (DB) 설정

```bash
# 가입: https://turso.tech
npm install -g turso
turso auth signup
turso db create interviewer-db
turso db show interviewer-db --url      # → libsql://xxx.turso.io
turso db tokens create interviewer-db   # → eyJhbGc... (auth token)
```

### 스키마 푸시 (신규 DB 셋업)

```bash
# .env.production.local 파일 생성 (.env.local 은 로컬 dev 용 — 거기 넣지 말 것!)
# 다음 두 줄만 작성:
# TURSO_DATABASE_URL=libsql://...
# TURSO_AUTH_TOKEN=...

npm run db:migrate
```

→ `drizzle/` 의 모든 migration 적용 (멱등 — 이미 적용된 건 skip).
→ 토큰 가격 시드는 별도 (필요 시 `node scripts/setup-fresh-db.mjs` — 멱등).

### 운영 배포 후 자동 migration

매 배포마다 Vercel `vercel-build` 가 `npm run db:migrate && npm run build` 를 실행.
새 schema 변경은 main push만 하면 운영 Turso 에 자동 적용된다. 수동 작업 불필요.

### 워크플로우 (변경 시)

1. 로컬 `lib/schema.ts` 수정
2. `npm run db:generate` → `drizzle/NNNN_*.sql` 생성
3. 생성 SQL 검토 (특히 DROP/RENAME 은 데이터 손실 위험 — 별도 결정)
4. `npm run db:migrate` → 로컬 적용 + 동작 확인
5. 커밋 (`git add drizzle/`) + main push
6. Vercel `vercel-build` 가 Turso 에 자동 적용

### 드리프트 점검

운영 DB 가 schema.ts 와 어긋났는지 의심되면:

```bash
npm run db:sync-check
```

→ 누락 컬럼·인덱스·테이블 보고 + 자동 ADD COLUMN/CREATE INDEX (ADDITIVE 만).

### 관리자 계정 시드
Turso DB는 비어 있으니 관리자 계정 1개 생성:

```bash
turso db shell interviewer-db
```

```sql
-- bcrypt hash 는 로컬에서 생성한 값 사용 (예: `node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"`)
INSERT INTO users (email, password_hash, name, is_admin)
VALUES ('admin', '<bcrypt hash 값>', '시스템관리자', 1);
```

또는 처음 사용자가 회원가입 → Turso shell에서 `UPDATE users SET is_admin=1 WHERE email='<your-email>'`.

---

## 2. Vercel Blob 설정

1. **GitHub에 코드 푸시**
2. **Vercel 가입 + 프로젝트 import** (https://vercel.com/new)
3. **Storage 탭 → Create Database → Blob 선택** → **Access: Private** + **Region: Seoul(icn1)** 로 생성
   - ⚠️ Access·Region 은 **생성 후 변경 불가**. 코드(`saveFile`)가 `access: "private"` 고정이라 public 스토어면 업로드가 거부된다 (2026-07-12 전환 — 이력서 PII 가 URL 만으로 노출되지 않도록)
4. **Connect Project** 시 **"Add a read-write token env var" 체크 필수** → `BLOB_READ_WRITE_TOKEN` 생성 (미체크 시 OIDC 변수만 생겨서 SDK 2.x 코드가 스토어를 못 씀)

---

## 2-1. Vertex AI 서울 리전 설정 (서류평가용 — PIPA §28의8 회피)

서류평가는 Vertex AI 서울 리전(asia-northeast3)에서 처리되어 국외이전이 발생하지 않습니다. 운영 배포 전 다음 절차를 마쳐야 합니다.

### 2-1-1. Google Cloud 프로젝트 + 서비스 계정 준비

(이미 로컬 dev 단계에서 마쳤다면 같은 프로젝트·서비스 계정 재사용 가능)

1. **Google Cloud Console** 로그인 (https://console.cloud.google.com)
2. 프로젝트 선택 또는 신규 생성 → **Project ID 메모**
3. 상단 검색 → **"Vertex AI API"** → **"사용 설정"** 클릭 (또는 `aiplatform.googleapis.com` 활성화)
4. **IAM 및 관리자 → 서비스 계정 → "+ 서비스 계정 만들기"**
   - 이름: `intervia-vertex-ai` (자유)
   - 역할: **"Agent Platform 사용자"** (= Vertex AI User) 1개만
5. 만들어진 서비스 계정 → **"키"** 탭 → **"키 추가" → "새 키 만들기" → JSON** → 자동 다운로드
6. ⚠️ 다운로드된 JSON 파일은 **비밀번호와 동일한 수준의 보안** — git 절대 X

### 2-1-2. Vercel 환경변수 등록 (3개)

| 변수명 | 값 | Sensitive |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | Project ID (예: `gen-lang-client-0667386019`) | ❌ |
| `GOOGLE_CLOUD_LOCATION` | `asia-northeast3` (절대 변경 X — 서울 리전 고정이 §28의8 회피의 핵심) | ❌ |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | 다운로드한 JSON 파일을 **메모장 등으로 열어 전체 내용 통째로 복사**해서 붙여넣기 | ✅ **Sensitive 체크** |

> ⚠️ **`GOOGLE_APPLICATION_CREDENTIALS` 는 등록하지 말 것** — 로컬 dev 전용 (파일 경로). Vercel은 파일 시스템에 키 파일이 없음.

### 2-1-3. 동작 확인

배포 후 첫 후보자 이력서 업로드 → AI 서류평가 정상 진행되는지 Vercel Logs (Deployments → Logs) 에서 확인:

| 로그 패턴 | 의미 |
|---|---|
| 정상 (에러 없음) | 서울 리전 호출 성공 |
| `GOOGLE_CLOUD_PROJECT가 설정되지 않았습니다` | 환경변수 미등록 또는 오타 |
| `Could not load the default credentials` | `GOOGLE_APPLICATION_CREDENTIALS_JSON` JSON 형식 오류 (파싱 실패) |
| `Permission denied` 또는 403 | 서비스 계정에 "Agent Platform 사용자" 역할 미부여 또는 Vertex AI API 미활성화 |

### 2-1-4. 응답 시간 참고

Vertex AI 서울 리전은 직접 API 대비 4~5배 느림 (13K char 프롬프트 기준 30~40초).
서류평가는 비동기 큐 처리라 UX 영향 없음. 다만 동시 평가가 많을 때 처리량 영향 모니터링 필요.

---

## 3. Vercel 환경변수 설정

프로젝트 Settings → Environment Variables 에서:

| 변수 | 값 |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | GCP 프로젝트 ID (예: `gen-lang-client-0667386019`) — 모든 task Vertex AI 서울 |
| `GOOGLE_CLOUD_LOCATION` | `asia-northeast3` (서울 리전 고정 — AI 단계 §28의8 회피의 핵심) |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | **`.gcp-key.json` 파일 전체 내용을 통째로** (JSON 통문자열). Sensitive 체크 필수. ⚠️ `GOOGLE_APPLICATION_CREDENTIALS` 는 Vercel에 등록하지 말 것 (파일 시스템 경로 미지원) |
| ~~`GOOGLE_API_KEY`~~ | **더 이상 사용 안 함** (직접 Gemini API 제거, 2026-05-26). 기존 등록값은 제거해도 무방. |
| `SYSTEM_ADMIN_EMAIL` | **설정 시 첫 요청에서 이 이메일로 `system_admin` 계정 자동 생성** (`lib/bootstrap-admin.ts`). 운영 전 반드시 설정 |
| `SYSTEM_ADMIN_NAME` | (선택) 부트스트랩 관리자 표시 이름. 기본 `시스템 관리자` |
| `SYSTEM_ADMIN_INITIAL_PASSWORD` | (선택) 부트스트랩 관리자 초기 비밀번호. **미설정 시 144bit 랜덤 비번 자동 생성 → 배포 로그(warn `system_admin_bootstrapped` 의 `generatedInitialPassword`)에 1회 노출** (약한 공통 기본값 제거). 운영은 직접 지정 권장. ⚠️ 로그인 직후 변경 **강제** (정책: 10자·3종·HIBP) |
| `TURSO_DATABASE_URL` | `libsql://xxx.turso.io` |
| `TURSO_AUTH_TOKEN` | `eyJhbGc...` |
| `BLOB_READ_WRITE_TOKEN` | (Blob 생성 시 자동) |
| `APP_BASE_URL` | `https://intervia.kr` |
| `SMTP_HOST` | `smtp.resend.com` (운영 권장) 또는 `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `resend` (Resend 사용 시 문자 그대로) / Gmail 주소 |
| `SMTP_PASS` | Resend API 키 (`re_...`) / Gmail App Password |
| `SMTP_FROM` | `Intervia <noreply@your-domain.com>` (검증된 도메인) |
| `MAIL_OVERRIDE_TO` | **Preview/Staging 환경에만 등록** (예: `admin.intervia@gmail.com`). 등록 시 지원자(candidate) 메일만 이 주소로 리다이렉트 — HR/면접관 메일은 그대로 실제 발송됨. Production 에는 절대 등록 X. |
| `BUSINESS_REGISTRY_API_KEY` | data.go.kr 국세청 사업자등록정보 API **운영키** (가입 페이지 진위확인) |
| `CRON_SECRET` | 32바이트 hex (`.env.local` 값 재사용 또는 신규 생성) |
| `INTERNAL_API_SECRET` | 32바이트 hex |
| `MASTER_ENCRYPTION_KEY` | 32바이트 hex (SMTP 비밀번호 등 암호화 키) |
| `SCREENING_WORKER_CONCURRENCY` | `16` (LLM 대기는 논블로킹 I/O — CPU 코어 수 무관. 코드 기본값도 16. Vertex 쿼터 여유 시 상향 가능) |
| `SCREENING_WORKER_MAX_JOBS` | **미설정 권장**(= concurrency 와 동일, 1실행 1라운드). 동시성보다 크게 잡으면(예: 100) 1실행이 maxDuration(120s)을 넘겨 함수가 self-chain 전에 죽고 큐가 cron(매분)까지 정체된다. 워커에 70s 벽시계 가드가 있어 이제 멈추진 않지만, 동시성과 어긋난 큰 값은 self-chain 횟수만 늘릴 뿐 이득 없음 → 비워두거나 `SCREENING_WORKER_CONCURRENCY` 와 같은 값으로. |
| `NEXT_PUBLIC_BLOB_CLIENT_UPLOAD` | `1` (이력서 100MB 직접 업로드 활성화 — 프로덕션에서만 `1`) |
| `SENTRY_DSN` | (선택) 오류 추적. 설정 시 instrumentation 이 전 라우트 미처리 예외를 Sentry 로 자동 전송 |
| `SLACK_WEBHOOK_URL` | (선택) 운영자 Slack 통지 채널(Incoming Webhook URL). critical 에러 + 운영 알림(ops-alerts) + **메일 발송 실패(Resend 쿼터 초과 등, 10분당 1회 스로틀)** + **시스템 관리자 알림 전반**(신규 법인·담당자 승격 요청·도메인 신고·고객 문의·이의제기 — PII 없는 유형 라벨만). 미설정 시 전부 조용히 skip |
| `OPS_ALERT_EMAIL` | (선택) 운영 알림 수신 메일. 미설정 시 회사 이메일(`site-info` COMPANY_INFO.email)로 발송 |
| `OPS_QUEUE_BACKLOG` / `OPS_FAILED_LAST_HOUR` / `OPS_STUCK` / `OPS_BALANCE_FLOOR` | (선택) 운영 알림 임계값. 기본 50 / 20 / 5 / (잔액 알림 비활성). `OPS_BALANCE_FLOOR` 설정 시 최저 잔액이 그 값 이하면 알림 |
| `HEALTH_TOKEN` | (선택) `/api/health` 상세 모드(큐 통계·env 진단) 토큰. 미설정 시 공개 ping 만 |
| `ALIGO_API_KEY` / `ALIGO_USER_ID` / `ALIGO_SENDER_KEY` / `ALIGO_SENDER` / `ALIGO_TPL_*` | (선택) 카카오 알림톡 병행 발송(알리고). **미설정 시 이메일만** 발송(게이트). 활성화 절차·템플릿 본문: [docs/ALIMTALK.md](docs/ALIMTALK.md). `ALIGO_TEST_MODE=1` 로 무과금 테스트 |

---

## 3-1. 운영 배포 전 외부 서비스 업그레이드 체크리스트

dev/MVP에서는 무료 티어 + 테스트용 키로 동작하지만, **실고객 트래픽 받기 전 반드시 업그레이드해야 하는 항목들**입니다.

### ✉️ 이메일 (Resend)

| 항목 | dev 상태 | 운영 전 필요 작업 |
|---|---|---|
| 발신 도메인 | `onboarding@resend.dev` (본인 메일에만 발송 가능) | **본인 도메인 등록 + DNS DKIM/SPF/Return-Path 레코드 추가** → 모든 수신자에게 발송 가능 |
| 요금제 | Free (월 3,000통, 일 100통) | 트래픽 예상: 후보자 1명 가입 시 인증·면접안내·결정통보 약 3통 → **Pro $20/월 (월 5만통)** 부터 검토 |
| 도메인 verify | X | Resend 대시보드 → Domains → Add Domain → 발급되는 TXT/CNAME 레코드를 도메인 등록사(가비아 등) DNS 패널에 추가 → Verify |
| `SMTP_FROM` 변경 | `Intervia <onboarding@resend.dev>` | `Intervia <noreply@your-domain.com>` |
| Reply-To | 없음 | 고객 문의 받을 메일 (`support@your-domain.com`) 별도 설정 권장 |

> **트리거:** 본인 외 다른 이메일로 가입 시도 → 발송 실패. 이게 보이면 운영 도메인 등록이 안 된 상태.

### 🏢 법인명 자동완성 (DART OpenAPI)

| 항목 | dev 상태 | 운영 전 필요 작업 |
|---|---|---|
| API 키 | 무료 (가입 즉시 발급, 일 10,000건) | 동일 — 키 재발급 불필요 |
| 데이터 파일 | `lib/dart-corps.json` (`npm run dart:fetch` 로 생성) | **분기 1회 재실행** 권장 (신규 상장사 반영). 빌드 파이프라인에 cron 또는 수동 |
| 커버리지 | 상장사·외감법인 약 3,500개 | 비상장 중소기업은 항상 수동 입력 — 안내 카피 노출 |

### 📋 사업자등록정보 (data.go.kr)

| 항목 | dev 상태 | 운영 전 필요 작업 |
|---|---|---|
| 활용신청 구분 | "개발용" (일 1,000건) | **"운영용" 별도 신청** (활용신청 폼에서 "운영" 체크). 사람 검토 1-3 영업일 |
| 활용 사유 | "개발/테스트" | 운영용은 "AI 채용 SaaS Intervia 회원가입 시 사업자번호 진위확인" 명시 |
| API 키 발급 시점 | 자동 (즉시) | 운영 키도 자동 발급되지만 활용신청 승인 완료 후 |
| Vercel 적용 | `BUSINESS_REGISTRY_API_KEY` 에 dev 키 | **운영 키로 교체** |

> data.go.kr 운영 키는 1일 호출량이 더 높습니다 (기관별 상이). 운영 시점에 한도 다시 확인.

### 💸 기타 무료 → 유료 전환 시점

| 서비스 | 무료 한도 | 유료 전환 시점 |
|---|---|---|
| **Turso** | 9GB / 1억 row read/월 | DB 5GB 또는 read 8천만 도달 시 |
| **Vercel** | Hobby (100GB bandwidth, daily cron만) | 1) **상업적 트래픽 발생 즉시 Pro $20/월 의무** 2) 분당 cron 필요 시 (현재 cron-job.org 외부 사용 중 → cron-job.org 무료 한도면 우회 가능) |
| **Vercel Blob** | 무료 1GB / 월 5GB 다운로드 | 이력서 누적 5천 건 (= 약 1GB) 도달 시 |
| **Google AI Studio (Gemini)** | 무료 티어 RPM 15 / 일 1,500요청 | 동시 면접 5건 이상 + 면접 1건 약 20요청 → **유료 결제 등록 후 키 재발급** |
| **cron-job.org** | 1분 간격 30개 job | 무료로 충분 |

### 🔐 시크릿 재발급 (운영 전 1회)

dev 와 동일 시크릿 사용 중 → 운영 출시 직전 모두 새로 발급해서 교체:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `CRON_SECRET`
- `INTERNAL_API_SECRET`
- `MASTER_ENCRYPTION_KEY` (⚠️ 변경 시 dev DB 의 enc 데이터 복호화 불가 — 운영 DB 가 비어있을 때 교체)

---

---

## 4. 배포

`Deploy` 버튼 → 빌드 완료 후 `https://intervia.kr` 접속.

---

## 4-1. 법인 서브도메인 지원 페이지 활성화 (`{sub}.intervia.kr` — 와일드카드)

코드는 배포돼 있어도 `SUBDOMAIN_APPLY_ENABLED` 미설정이면 **완전 휴면**(기존 apex 링크 그대로).
활성화는 아래 순서 — Vercel 와일드카드는 **네임서버 방식 검증이 필수**라 DNS 를 Cloudflare → Vercel 로 이관해야 한다.

1. **레코드 인벤토리**: Cloudflare 대시보드 → intervia.kr → DNS Records 전체 캡처
   (Resend 인증 TXT/`resend._domainkey`·send 서브도메인 MX 등. MX 없음·프록시 미사용 확인됨 2026-07-09).
2. **Vercel DNS 에 동일 레코드 미리 생성**: Vercel → Domains → intervia.kr → DNS Records.
   ⚠️ 이 단계 전에 네임서버부터 바꾸면 그 레코드들이 조회 불가 → **Resend 발신(DKIM) 깨짐**.
3. **레지스트라에서 네임서버 변경**: Cloudflare NS → Vercel 이 안내하는 `ns1/ns2.vercel-dns.com`.
   Cloudflare 쪽 레코드는 지우지 말 것(롤백 = NS 되돌리기 한 번).
4. **전파 후 검증**: `Resolve-DnsName intervia.kr -Type NS` 가 vercel-dns 를 반환하는지,
   `resend._domainkey.intervia.kr` TXT 조회, Resend 대시보드 도메인 상태 Verified, 테스트 메일 발송.
5. **와일드카드 도메인 추가**: Vercel 프로젝트 → Settings → Domains → `*.intervia.kr` 추가.
6. **기능 ON**: Vercel 환경변수 `SUBDOMAIN_APPLY_ENABLED=1` (Production) → Redeploy.
   이후 지원 링크가 `https://{회사}.intervia.kr/apply/...` 로 발급되고, 기존 apex 링크는
   지원 페이지 진입 시 자동으로 브랜드 주소로 리다이렉트된다. 문제 시 env 를 지우고 Redeploy 하면 즉시 원상복구.

서브도메인 라벨은 법인 email_domain 첫 라벨에서 자동 유도(사칭 방지 — 자유 입력 없음), 발급 로직은 `lib/subdomain.ts` + apply-link 라우트.

---

## 5. 외부 Cron 설정 (cron-job.org — 무료)

Vercel Hobby 는 daily cron 만 지원하므로, 분당/시간당 cron 은 외부 서비스 사용.

### 가입 & 등록
1. https://cron-job.org 가입
2. **Cronjobs → Create cronjob**
3. 아래 3개 등록:

#### 5-1. 큐 워커 (1분 간격)
| 항목 | 값 |
|---|---|
| Title | Intervia — Screening Queue Worker |
| URL | `https://intervia.kr/api/cron/process-screenings` |
| Schedule | Every 1 minute |
| Method | POST |
| Auth Header | `Authorization: Bearer ${CRON_SECRET}` |

#### 5-2. 면접 만료 처리 (1시간 간격)
| 항목 | 값 |
|---|---|
| Title | Intervia — Expire Interviews |
| URL | `https://intervia.kr/api/cron/expire-interviews` |
| Schedule | Every 1 hour |
| Method | POST |
| Auth Header | `Authorization: Bearer ${CRON_SECRET}` |

#### 5-3. 운영 알림 (1시간 간격)
| 항목 | 값 |
|---|---|
| Title | Intervia — Ops Alerts |
| URL | `https://intervia.kr/api/cron/ops-alerts` |
| Schedule | Every 1 hour |
| Method | POST |
| Auth Header | `Authorization: Bearer ${CRON_SECRET}` |

> 큐 적체·평가 실패율 급증·워커 멈춤·비정상 마이너스 잔액을 점검해 임계 초과 시
> `SLACK_WEBHOOK_URL` + `OPS_ALERT_EMAIL`(미설정 시 회사 이메일)로 통지. 임계값은
> `OPS_QUEUE_BACKLOG`/`OPS_FAILED_LAST_HOUR`/`OPS_STUCK`/`OPS_BALANCE_FLOOR` env 로 조정.

#### 5-4. (선택) 원본 폐기 — Vercel cron 이 daily 로 동작하므로 중복이라 추천 X.

### Vercel 자체 cron (Pro)
`vercel.json` cron — Pro 전환 후 분당 cron 가능:
- `purge-original` — 매일 03:30 (데이터 폐기, PIPA). **`expireInterviewSessions` 안전망도 여기 fold** (외부 cron 누락 대비, 멱등).
- `process-screenings` — **매분 (`* * * * *`)** 큐 워커 안전망. self-chain 이
  끊겨도 1분 내 복구. (과거 `0 4 * * *` 하루 1회였으나, 큐 정체 시 다음날까지
  멈추는 문제로 매분으로 변경 — 2026-05-31)
- `interview-reminders` — 매시간 (`0 * * * *`)
- `ops-alerts` — 매시간 (`0 * * * *`) 운영 알림(큐 적체·실패율·stuck·잔액 점검 → Slack/메일)
- `expire-interviews` — 매시간 (`0 * * * *`) 만료 세션 자동불합격·만료 PII 폐기. (+ `purge-original`
  일일 안전망에도 멱등 fold — 둘 다 돌아도 무해)

> **Pro 사용 시 cron-job.org 불필요** — 위 vercel.json cron 5개가 네이티브로 실행된다. §5(cron-job.org)는
> Hobby(분당/시간당 cron 미지원) 일 때의 대안 가이드이므로 Pro 면 무시.

### 검증
- cron-job.org 대시보드에서 각 cronjob 의 history → 200 응답 확인
- Vercel 함수 로그에서 `x-vercel-cron=1` 또는 `Authorization: Bearer ...` 헤더로 호출됐는지 확인

---

## 무료 티어 한도

| 서비스 | 한도 | 50명 면접 시 |
|---|---|---|
| Vercel | 100GB 대역폭/월 | 충분 |
| Turso | 500MB DB / 10억 reads | 충분 |
| Vercel Blob | 1GB 저장 | PDF 평균 1MB → 50MB |
| Gemini 2.5 Flash-Lite | 1500 RPD | 면접 1건당 약 25 호출 → 60건/일 가능 |
| Gmail SMTP | 500 메일/일 | 충분 |

---

## 로컬 개발 (배포 후에도 그대로 동작)

`.env.local`에서 Turso/Blob 환경변수를 빼면 자동으로 다시 SQLite + 로컬 디스크 사용.

```
# 로컬 모드 (이게 기본)
GOOGLE_CLOUD_PROJECT=...
GOOGLE_CLOUD_LOCATION=asia-northeast3
GOOGLE_APPLICATION_CREDENTIALS=./.gcp-key.json
# Turso/Blob 토큰 없음 → 자동으로 file:./data.db + ./uploads/
```

---

## 트러블슈팅

- **Vercel 빌드 실패**: `better-sqlite3`가 남아있으면 native build 실패. 이미 제거된 상태.
- **Turso 연결 실패**: URL 끝에 슬래시 없는지, 토큰 띄어쓰기 없는지 확인.
- **Blob 업로드 실패**: `BLOB_READ_WRITE_TOKEN`이 프로젝트에 연결됐는지 Settings에서 확인.
- **이메일 링크가 localhost**: `APP_BASE_URL`을 배포 도메인으로 변경 필요.

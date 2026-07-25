# 운영 오픈 직전 체크리스트

베타 ~ 출시 전 단계에서는 **Production 환경을 테스트 용도로 병행 사용** 중이다.
출시 = 실제 고객사/지원자에게 도메인 공개 시점. 그 전에 아래를 모두 처리해야 한다.

> ⚠️ 가장 큰 위험: `MAIL_OVERRIDE_TO` 제거를 잊으면 실제 지원자에게 메일이 안 가고
> HR 은 "이미 보냈는데?" 상태가 되어 첫인상이 크게 깨진다.

---

## 🚨 필수 (출시 전 반드시)

### 1. `MAIL_OVERRIDE_TO` 제거
- **Vercel → Settings → Environment Variables → `MAIL_OVERRIDE_TO`** 삭제
- Production Redeploy
- 검증: 본인 외 다른 이메일로 가입 시도 → 그 이메일로 인증 메일 도착 확인
- UI 안전장치(빨간 배너)가 사라지는지도 같이 확인

### 2. 테스트 데이터 청소 (Turso)

```sql
-- 가짜 후보자
DELETE FROM candidate_attachments WHERE candidate_id IN (SELECT id FROM candidates WHERE /* 테스트 조건 */);
DELETE FROM screening_jobs WHERE candidate_id IN (SELECT id FROM candidates WHERE /* 테스트 조건 */);
DELETE FROM interview_sessions WHERE candidate_id IN (SELECT id FROM candidates WHERE /* 테스트 조건 */);
DELETE FROM interview_schedules WHERE candidate_id IN (SELECT id FROM candidates WHERE /* 테스트 조건 */);
DELETE FROM candidates WHERE /* 테스트 조건 */;

-- 가짜 공고
DELETE FROM job_postings WHERE /* 테스트 조건 */;

-- 가짜 조직 (필요시)
DELETE FROM organizations WHERE /* 테스트 조건 */;
```

> 테스트 조건은 시점에 따라 다름. `created_at < '실제 첫 고객 가입일'` 또는 특정 org_id 기준.
> `turso db shell intervia-db` 로 접속해서 실행.

### 3. ✅ 시크릿 재발급 — dev/prod 분리 완료 (2026-06-07)

`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 로 새 값 생성 후 Vercel + `.env.production.local` 교체.

| 키 | 상태 | 비고 |
|---|---|---|
| `CRON_SECRET` | ✅ 분리 완료 | Pro 네이티브 cron이라 Vercel이 헤더 자동 주입 — 외부 동기화 불필요 |
| `INTERNAL_API_SECRET` | ✅ 분리 완료 | — |
| `MASTER_ENCRYPTION_KEY` | ✅ 분리 완료 (64 hex) | 2FA 미사용 + 실데이터 없음 시점에 교체 → 깨진 enc 데이터 없음 |
| `HEALTH_TOKEN` | (선택) | 분리하려면 동일 절차 + 모니터링 도구 헤더 갱신 |

> dev(`.env.local`) ≠ prod(Vercel/`.env.production.local`) 확인 완료. Vercel env 교체 후 **Redeploy 필요**(아래 §D-0 배포로 반영).

### 4. 테스트 계정 정리
- 가짜 멤버/관리자 계정 비번 변경 또는 삭제
- system_admin 계정은 유지 (`SYSTEM_ADMIN_EMAIL` 로 식별)
- 잔여 테스트 계정의 세션 쿠키 무효화 (필요시 `sessions` 테이블 비우기)

---

## 🟡 권장 (출시 직후)

### 5. ✅ Vercel Pro 전환 완료 (2026-06-07)
상업 트래픽 = Pro 의무 충족. cron 5개 모두 `vercel.json` 네이티브 실행 → **cron-job.org 불필요**:
```json
"crons": [
  { "path": "/api/cron/process-screenings", "schedule": "* * * * *" },
  { "path": "/api/cron/interview-reminders", "schedule": "0 * * * *" },
  { "path": "/api/cron/ops-alerts",         "schedule": "0 * * * *" },
  { "path": "/api/cron/expire-interviews",  "schedule": "0 * * * *" },
  { "path": "/api/cron/purge-original",     "schedule": "30 3 * * *" }
]
```
→ Vercel cron 인증을 위해 `CRON_SECRET` 이 Vercel 환경변수에 있어야 함. 수동 트리거 스크립트(`scripts/process-now.ps1`)는 비상용으로 유지.

### 6. 메일 발송 한도 · 발신 IP 워밍업 (회사 SMTP · 2026-07-25 전환)
- 후보자 1명 ≈ 3통 (인증·면접·결정) — 일 30명 유입이면 하루 약 90통
- 발신 서버 정책 한도를 확인하고 `MAIL_DAILY_BUDGET` / `MAIL_MONTHLY_CAP` 을 그에 맞춰 설정
- **새 발신 IP 는 워밍업 필요** — 예산을 낮게 시작해 단계적으로 올린다(첫날부터 최대치 X)
- 발송률은 `MAIL_RATE_PER_SEC`(기본 2/s). 대량 발송 시간 = 통수 ÷ 초당 발송률
- 루트 도메인 SPF 에 발신 서버가 인가돼 있어야 함 — 현재 `intervia.kr TXT: v=spf1 a:mail.expernet.co.kr ~all`
  (DKIM 은 회사 서버가 서명을 지원하면 추가 권장. 없으면 DMARC 정렬이 SPF 단독이라 **포워딩 시 실패**할 수 있어 `p=none` 유지가 안전)
- 대체 경로(Resend)용 레코드는 `send` 서브도메인(SPF·feedback MX)+`resend._domainkey`(DKIM) 에 분리돼 있어 **루트와 충돌하지 않는다** — 지우지 말 것
- ⚠️ **대체 경로로 전환하면 한도가 일 100·월 3,000통으로 급감** — 전환 시 예산 env 를 함께 낮출 것 (RUNBOOK §5. DNS 변경은 불필요)

### 7. data.go.kr 사업자등록 API 운영 키 발급
- dev/MVP는 "개발용" 키 (일 1,000건)
- 운영은 별도 신청 → "운영용" 키 (사람 검토 1~3 영업일)
- `BUSINESS_REGISTRY_API_KEY` 교체

### 8. Sentry/Slack 알림 임계 설정
- Sentry 가입 완료 상태 (DEPLOY.md 참조)
- Slack webhook 연동 (선택)

---

## ✅ 출시 D-0 최종 검증

배포 직후 1회씩 실행:

1. `curl.exe -I https://intervia.kr` → HTTP 200/307
2. 가입 → 인증 메일 도착 (테스트 계정으로)
3. 사업자번호 진위확인 동작
4. 이력서 업로드 → 자동 평가 → 결과 표시 (5분 이내)
5. AI 면접 링크 생성 → 후보자 메일 도착 → 면접 진행
6. 1차 면접 일정 제시 → 후보자 응답 흐름
7. 합/불 결정 → 통보 메일

---

## 운영 중 정기 점검

| 주기 | 항목 |
|---|---|
| 매일 | Vercel Logs 에러 0건 확인, Sentry 알림 |
| 주 1회 | Turso DB 용량 / Vercel Blob 사용량 |
| 월 1회 | 메일 발송량(`/api/cron/quota-alerts` `metrics.mail`) / Vertex AI 사용량 vs 한도 |
| 분기 1회 | `lib/dart-corps.json` 재생성 (`npm run dart:fetch`) — 신규 상장사 반영 |

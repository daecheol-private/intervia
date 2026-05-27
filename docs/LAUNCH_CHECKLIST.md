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

### 3. 시크릿 재발급 (DEPLOY.md §3-1 권장)

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

위 명령으로 새 키 발급 후 다음 환경변수 교체:

| 키 | Vercel 업데이트 | 추가 작업 |
|---|---|---|
| `CRON_SECRET` | ✅ | cron-job.org 헤더도 동시 갱신 (Pro 가입 전이라면) |
| `INTERNAL_API_SECRET` | ✅ | 없음 |
| `HEALTH_TOKEN` | ✅ | 모니터링 도구 헤더 갱신 |
| `MASTER_ENCRYPTION_KEY` | ⚠️ **DB 비어있을 때만** | 기존 enc 데이터(SMTP 비번 등) 모두 복호화 불가됨. 테스트 청소 직후 시점에 교체. |

### 4. 테스트 계정 정리
- 가짜 멤버/관리자 계정 비번 변경 또는 삭제
- system_admin 계정은 유지 (`SYSTEM_ADMIN_EMAIL` 로 식별)
- 잔여 테스트 계정의 세션 쿠키 무효화 (필요시 `sessions` 테이블 비우기)

---

## 🟡 권장 (출시 직후)

### 5. Vercel Pro 가입 + cron 분 단위 전환
[DEPLOY.md §3-1] 참조 — 상업 트래픽 발생 = Pro 의무.

전환 후 `vercel.json` 수정:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/process-screenings", "schedule": "* * * * *" },
    { "path": "/api/cron/expire-interviews", "schedule": "0 * * * *" },
    { "path": "/api/cron/purge-original", "schedule": "30 3 * * *" }
  ]
}
```

→ cron-job.org 가입했었다면 jobs 비활성화. 수동 트리거 스크립트(`scripts/process-now.ps1`)는 비상용으로 남겨둘 수 있음.

### 6. Resend Pro 검토
- Free: 일 100통, 월 3,000통
- 후보자 1명 ≈ 3통 (인증·면접·결정)
- 일 30명 유입 = 한도 도달
- 트래픽 예측되면 사전에 Pro $20/월 업그레이드

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
| 월 1회 | Resend / Vertex AI 사용량 vs 한도 |
| 분기 1회 | `lib/dart-corps.json` 재생성 (`npm run dart:fetch`) — 신규 상장사 반영 |

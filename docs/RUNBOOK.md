# 장애 대응 런북 (Incident Runbook)

> 문제가 터졌을 때 **무엇을 보고, 무엇을 누르고, 어떻게 복구하는지**. 평상시 한 번 읽어두고, 사고 시 해당 섹션만 펼쳐 본다.
> 개인정보 침해(유출·탈취)는 별도 — [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) §침해 72시간 대응 우선.

---

## 0. 사고 시 30초 체크리스트

1. **범위 확인** — 전체 다운인가, 특정 기능만인가? → `https<APP>/api/health` (200/503)
2. **로그 보기** — Vercel → Deployments → Logs / Sentry(설정 시) Issues
3. **운영 대시보드** — `/admin/dashboard`(KPI·큐·최근 critical 액션), `/admin/metrics`
4. **최근 배포 의심** — 직전 배포 후 발생이면 **즉시 롤백**(§3) 먼저, 분석은 그 다음
5. **고객 영향 크면** — 먼저 멈추고(롤백/정지) 원인 분석은 나중. MTTR > 근본분석.

## 0-1. 어디를 보나 (관측 지점)

| 신호 | 위치 | 무엇 |
|---|---|---|
| 살아있나 | `GET /api/health` | DB liveness (200/503). `Authorization: Bearer $HEALTH_TOKEN` 시 큐 통계·env 진단 |
| 예외(에러) | Sentry (SENTRY_DSN) / Vercel Logs | instrumentation 이 전 라우트 미처리 예외 자동 전송 |
| 느린 장애 | Slack(SLACK_WEBHOOK_URL)·운영메일(OPS_ALERT_EMAIL) | `ops-alerts` cron 이 큐적체·실패율·stuck·잔액 임계 통지 |
| 운영 현황 | `/admin/dashboard` `/admin/metrics` | 법인/사용자/공고/후보자·큐 상태·마이너스 잔액 톱·최근 critical |
| 감사 추적 | `/admin/audit` | 민감 액션 이력 (cross-org amber 강조), CSV export |
| 계정 잠금 | `/admin/locks` | 로그인 실패 잠금 현황 + 해제 |
| 문의·신고 | `/admin/inquiries` | 고객/후보자 신고 인박스 |

## 0-2. 비상 운영 도구 (system_admin)

| 작업 | 경로 | 비고 |
|---|---|---|
| 전체 강제 로그아웃 | `POST /api/admin/sessions/all` | body `confirm:"FORCE-LOGOUT-ALL"` + 사유. 세션 탈취·키 유출 시 |
| 특정 사용자 로그아웃 | `DELETE /api/admin/users/[id]/sessions` | |
| 법인 정지/재개 | `POST`/`DELETE /api/admin/orgs/[id]/suspend` | 정지 시 해당 법인 전 세션 즉시 만료 + 로그인 차단 (system_admin 우회) |
| 토큰 가감(충전/조정) | `POST /api/admin/orgs/[id]/grant-tokens` (step-up) | 수동 +/− 조정, 감사 로그 |
| 결제 취소(카드 환불) | `POST /api/admin/payments/[id]/cancel` (step-up) | 토스 결제취소 + 지급 토큰 회수, `paid`만, 감사 로그. 조회: `GET /api/admin/orgs/[id]/payments` 또는 `/admin/orgs/[id]/payments` |
| 계정 잠금 해제 | `/admin/locks` → `POST /api/admin/locks/unlock` | 락아웃 DoS 대응 |
| 큐 수동 가동 | `POST /api/cron/process-screenings` (Bearer CRON_SECRET) | 큐 멈춤 시 강제 1회 |
| 비밀번호 리셋 메일 | `POST /api/admin/users/[id]/password-reset` | |

---

## 1. 사이트 전체 다운

**증상**: 접속 불가 / `/api/health` 503 또는 무응답 / 전 페이지 5xx.

1. **헬스** `curl -I $APP/api/health` — 503 이면 DB(§2) 의심, 무응답이면 Vercel/배포 의심.
2. **Vercel 상태** — vercel.com/dashboard 배포 상태, status.vercel.com 점검.
3. **직전 배포 후면 → 롤백**(§3). 빌드 실패로 새 배포가 안 떴으면 마지막 정상 배포가 서빙 중일 수 있음.
4. **env 누락 의심** — 배포 직후 전면 500 이면 환경변수 누락 흔함. `/api/health` 상세 모드(HEALTH_TOKEN)로 env 체크, `lib/config.ts` 필수키(GOOGLE_CLOUD_PROJECT·MASTER_ENCRYPTION_KEY) 확인.
5. 복구 후 Sentry/로그로 근본 원인 기록.

## 2. DB (Turso) 장애

**증상**: `/api/health` 503(`checks.db.ok=false`), 전면 "DB" 에러, 로그인·조회 실패.

1. **Turso 상태** — turso.tech 대시보드 / `turso db show <db>`. 리전 장애·쿼터 초과·토큰 만료 확인.
2. **연결 문제** — `TURSO_DATABASE_URL`(끝 슬래시 X)·`TURSO_AUTH_TOKEN`(공백 X) 점검. 토큰 만료면 `turso db tokens create` 재발급 → Vercel env 교체 → redeploy.
3. **용량 초과** — 무료 9GB/1억 read. `turso db inspect <db>`. 초과면 유료 전환 또는 오래된 데이터 정리(폐기 cron 동작 확인).
4. **데이터 손상·삭제 사고** → **§4 백업 복구**.
5. 복구 불가·장기화 시: 점검 페이지 안내 + 고객 공지.

## 3. LLM (Vertex AI / Gemini) 장애 — 평가·면접 실패

**증상**: 서류평가가 계속 실패(`failed`), AI 면접 응답 안 옴, `ops-alerts` 가 "최근 1시간 실패 N건" 통지.

1. **원인 분류** — Vercel 로그에서 에러 메시지:
   - `429/RESOURCE_EXHAUSTED/quota` → **쿼터 초과**. GCP 콘솔 → Vertex AI 할당량 확인, 결제 한도 점검.
   - `403/Permission denied` → 서비스계정 권한(Vertex AI User) 또는 API 비활성. (DEPLOY.md §2-1-3)
   - `Could not load default credentials` → `GOOGLE_APPLICATION_CREDENTIALS_JSON` 파싱 실패(env 오타).
   - `503/UNAVAILABLE/timeout` → 일시 장애. `withRetry`(lib/gemini.ts)가 2회 자동 재시도, 큐는 backoff 재시도 → **대개 자동 회복**.
2. **자동 안전망 신뢰** — 서류평가는 큐(transient 실패 backoff 3회). 일시 장애면 손 안 대도 회복. 영구 실패만 누적되면(파싱 불가 등) 후보 개별 이슈.
3. **지속 장애** — 쿼터/권한 문제면 위 env·GCP 수정 후, 실패한 `failed` 잡은 후보 상세에서 "재평가"로 재시도(과금은 성공 시만).
4. **리전 고정 주의** — `GOOGLE_CLOUD_LOCATION=asia-northeast3` 절대 변경 금지(§28의8 국외이전 회피 핵심). 다른 리전으로 우회하지 말 것.

## 4. 평가 큐 정체 / 멈춤

**증상**: `ops-alerts` "큐 적체 queued=N" 또는 "stuck N건", 후보 평가가 안 끝남.

1. **현황** — `/admin/metrics` 큐 상태 또는 `GET /api/health`(HEALTH_TOKEN) `checks.queue`(queued/processing/failed).
2. **워커 수동 가동** — `POST /api/cron/process-screenings` (Bearer CRON_SECRET). self-chain 이 끊겼으면 이걸로 재개.
3. **cron 확인** — cron-job.org 의 process-screenings(매분) 가 200 받는지 history 확인. 죽었으면 재활성/재등록.
4. **stuck 누적** — `cleanupStuck`(매분 cron 내) 가 5분+ lock 을 복구. stuck 이 계속 쌓이면 워커가 maxDuration(120s) 초과로 반복 사망 의심 → `SCREENING_WORKER_MAX_JOBS` 가 동시성보다 크게 박혀있지 않은지(env) 확인, 비우거나 동시성과 동일하게(DEPLOY.md §3).
5. **잔액 0 법인** — 잔액 ≤0 법인 잡은 `paused`(정상, 타 법인 안 굶김). 충전되면 ~1분 내 자동 재개. 큐 적체가 특정 법인 paused 때문이면 정상.

## 5. 메일 발송 실패 (회사 SMTP / 법인 SMTP)

**증상**: 면접 안내·인증·결과 통보 메일 미도착. Slack 에 `📪 메일 발송 실패 감지`.

1. **가장 흔한 원인** — `MAIL_OVERRIDE_TO` 가 production 에 남아있음(지원자 메일이 그쪽으로 감). → LAUNCH_CHECKLIST §1.
2. **인증 실패(535)** — `SMTP_USER` 가 **전체 이메일 주소**인지 확인(로컬파트만 넣으면 실패). 비밀번호 변경·만료도 확인.
3. **수신 거부(550/SPF)** — 발신 도메인 루트 SPF 에 발신 서버가 인가돼 있는지(`nslookup -type=txt intervia.kr`).
4. **일부만 도달** — 발송률·일일 한도. `MAIL_RATE_PER_SEC`(기본 2) / `MAIL_DAILY_BUDGET` 확인, `/api/cron/quota-alerts` 응답의 `metrics.mail` 로 오늘·이번달 발송량 확인.
5. **법인 SMTP** — 법인이 자체 SMTP 등록한 경우 그 계정 문제일 수 있음. `/api/orgs/smtp` 의 verify 로 재확인.
6. **부분 실패는 비치명적** — 자동불합격 알림·리마인더 등은 best-effort(실패해도 cron 흐름 안 막음). 핵심은 면접 링크·결과 통보.
7. **지속 장애 → Resend 로 수동 전환** — 회사 메일 서버 점검·장애면 법인 SMTP 미등록 법인의 메일이 전부 멈춘다. 대체 경로(Resend)를 보존해 두었으니 아래 순서로 되돌린다.
   1. **Vercel 환경변수 교체** — `SMTP_HOST=smtp.resend.com` / `SMTP_PORT=465` / `SMTP_USER=resend` / `SMTP_PASS=<Resend API 키>` / `SMTP_FROM` 유지 → **Redeploy**(env 변경은 재배포 전까지 반영 안 됨).
   2. **DNS 는 손대지 않는다.** Resend 는 Return-Path 를 `send.intervia.kr` 로 쓰므로 SPF 는 그 서브도메인의 `v=spf1 include:amazonses.com ~all` 로 통과하고, `From: noreply@intervia.kr` 의 DMARC 정렬은 `resend._domainkey` DKIM 이 맡는다. **루트 SPF(회사 서버 단독)는 Resend 발송에 관여하지 않는다** — 2026-06~07 Resend 운영 기간에 루트 SPF 가 회사 서버 값이 아니었는데도 정상 발송된 것으로 실증됨. (반대로 루트에 `include:amazonses.com` 을 넣으면 인가 범위만 넓어지고 SPF lookup 도 늘어난다.)
   3. **발송 한도 되돌리기** — Resend 무료 티어는 일 100·월 3,000통. `MAIL_DAILY_BUDGET`·`REJECTION_DAYTIME_SOFT_CAP` 을 그 범위로 낮춰야 대량 통보가 캡에 걸려 유실되지 않는다(저녁 드레인이 며칠에 걸쳐 분산).
   4. **복귀** — 회사 서버가 복구되면 env 를 되돌리고 Redeploy + 한도 원복. `.env.local`·`.env.production.local` 에 두 블록이 주석으로 함께 있어 값 참조용으로 쓸 수 있다.
   5. ⚠️ **처리방침 정합** — Resend 로 발송하는 동안은 지원자 개인정보가 미국을 경유한다. 고지(수탁자·국외이전)에 Resend 가 기재된 상태를 유지할 것(§26·§28의8).

## 6. 파일 저장소 (Vercel Blob) 장애 / 용량

**증상**: 이력서 업로드 실패, 다운로드 404/오류, `ops`/로그에 Blob 에러.

1. **토큰** — `BLOB_READ_WRITE_TOKEN` 유효한지(Vercel Storage). 프로젝트 내 Blob 이면 deploy 시 자동 주입.
2. **용량** — 무료 1GB. 이력서 ~1MB → 약 5천건. 초과 시 유료 전환 또는 폐기 cron(+30일/종결+7일) 동작 확인.
3. **다운로드만 깨짐** — `Content-Type` octet-stream 으로 저장된 케이스(inline 안 됨)는 GOTCHAS §10. 업로드 시점 content-type 문제.
4. SSRF 가드(blob host 화이트리스트)로 외부 URL 거부는 정상 동작.

## 7. 인증 / 대량 로그인 실패 / 잠금 폭주

**증상**: 로그인 안 됨, 정상 사용자가 잠김, 잠금 폭주.

1. **잠금 현황·해제** — `/admin/locks` → 해당 계정 unlock.
2. **무차별 대입 의심** — `auth_attempts`(IP 15분 20회 / email 5회 잠금). 특정 IP 폭주면 패턴 확인(감사 로그).
3. **세션 탈취 의심** — 해당 사용자/법인 강제 로그아웃(§0-2). 광범위하면 전체 강제 로그아웃 + 시크릿 회전.

## 8. 보안 사고 (계정 탈취 · 데이터 유출 의심)

> 개인정보 유출 확정·의심 시 **[COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) 72시간 신고** 동시 착수.

1. **즉시 격리** — 탈취 계정/법인 강제 로그아웃·정지(§0-2). system_admin 키 의심 시 전체 강제 로그아웃 + 시크릿(CRON/INTERNAL/MASTER) 회전(⚠️ MASTER 변경 시 기존 enc 데이터 복호화 불가 — GOTCHAS §0-0-1-3).
2. **범위 파악** — `/admin/audit` 에서 해당 actor 의 액션, cross-org(amber) 접근 추적, CSV export 로 증거 보전.
3. **차단** — 노출 토큰/세션 무효화, 필요 시 비번 리셋 메일 강제.
4. **사후** — 원인·범위·조치 기록(블레임리스), 재발 방지(권한·rate limit·가드 보강).

## 9. 비용 / 쿼터 초과

| 서비스 | 한도(무료) | 신호 | 조치 |
|---|---|---|---|
| Gemini/Vertex | GCP 결제 한도 | 429/quota | GCP 할당량·결제 한도 상향 |
| Turso | 9GB / 1억 read | `turso db inspect` | 유료 전환 / 데이터 정리 |
| Vercel Blob | 1GB | 업로드 실패 | 유료 / 폐기 cron 확인 |
| 메일 발송 (회사 SMTP) | 서버 정책 한도 (env `MAIL_DAILY_BUDGET`·`MAIL_MONTHLY_CAP`) | 발송 실패·Slack 경보 | 한도 상향 요청 / 발송 페이싱 조정 / 장애 시 Resend 전환(§5) |
| Vercel | Hobby 대역폭 | — | Pro(상업 트래픽 시 의무) |

`ops-alerts` 의 잔액 알림(`OPS_BALANCE_FLOOR`)으로 특정 법인 비정상 마이너스(과금 버그·악용) 조기 포착.

---

## 3. 배포 롤백 (가장 빠른 복구)

직전 배포 후 장애면 **분석보다 롤백 먼저**.

1. Vercel → 프로젝트 → **Deployments** → 마지막 정상 배포 → **⋯ → Promote to Production** (Instant Rollback, 빌드 없이 즉시).
2. 롤백 후 정상 확인(`/api/health`, 핵심 플로우 1회).
3. **DB 마이그레이션 주의** — 새 배포가 `vercel-build`(`db:migrate`)로 스키마를 바꿨다면 코드만 롤백해도 DB 는 새 스키마. ADD COLUMN 류는 구코드와 호환(무해)되지만, DROP/RENAME 이 있었다면 롤백이 깨질 수 있음 → 그 경우 forward-fix(새 핫픽스 배포) 가 안전.
4. 원인 파악·핫픽스 후 재배포.

---

## 4. 백업 & 복구

**정책 (C-2 결정 2026-06-07, 갱신 2026-06-14): Turso PITR(주) + 일간 오프사이트 dump(부, 14일 보존).**

별도 serverless export cron 은 두지 않는다 — Turso 의 PITR(시점 복구)와 공식 dump(`turso db shell <db> .dump`) 가
자체 구현보다 견고하고, 서버리스에서의 전체 dump 는 함수 타임아웃·부분실패 위험이 크다.

### 4-1. 1차 — Turso PITR (자동, 플랜별 보존: Free 24h / Developer 10일 / Scaler 30일 / Pro 90일)
- Turso 가 시점 복구를 제공. 실수 삭제·손상 시 특정 시각으로 복구. **자기 플랜 보존 한도를 넘은 시점은 PITR 불가 → §4-2 오프사이트 dump 로만 복구.**
- ⚠️ PITR 은 **CLI/Platform API 전용 — 대시보드 UI 없음** (2026-06 Turso 문서 확인). 기존 DB 를 시점 떠서 *새 DB* 로 생성한다:
  ```bash
  turso db create <새DB> --from-db <운영DB> --timestamp 2026-06-21T00:00:00Z   # ISO8601(UTC)
  ```
  → 행수·핵심 테이블 검증 → 앱의 `TURSO_DATABASE_URL`/토큰을 새 DB 로 교체·redeploy → 구 DB 폐기. (시점 데이터는 timestamp 직전 최대 15초 갭 가능.)

### 4-2. 2차 — 일간 오프사이트 dump (자동, GitHub Actions)
PITR 은 Turso 계정·DB 가 살아있을 때만 유효 → 계정 손실/오삭제 대비 **off-Turso 사본**을 둔다.
**자동화됨**: [`.github/workflows/db-backup.yml`](../.github/workflows/db-backup.yml) — 매일 03:00 KST(18:00 UTC) +
`workflow_dispatch` 수동 실행. `turso db shell <db> .dump` → **age 공개키로 암호화** → GitHub 아티팩트(14일 보존).
읽기 전용(dump)만 하며 운영 DB 에 쓰지 않는다. 덤프는 후보자 PII 포함 → **평문/공개 저장 금지**(워크플로우가 암호화 후 평문 즉시 삭제).

**1회 설정** (GitHub repo → Settings):
| 종류 | 키 | 값 | 비고 |
|---|---|---|---|
| Variable | `TURSO_DB_NAME` | 운영 DB 이름 | `turso db list` 또는 Turso 대시보드 |
| Secret | `TURSO_API_TOKEN` | 플랫폼 API 토큰 | 대시보드 Account → API Tokens(또는 `turso auth api-tokens mint backup-ci`). DB auth token 과 **다름** |
| Secret | `BACKUP_AGE_PUBLIC_KEY` | `age1...` 공개키 | 아래 키페어 생성 |

```powershell
# age 키페어 생성 (로컬, 1회) — age-keygen.exe 는 github.com/FiloSottile/age releases
age-keygen -o intervia-backup-key.txt
# 출력된 "Public key: age1..." → BACKUP_AGE_PUBLIC_KEY secret 에 등록
# ⚠️ intervia-backup-key.txt(private key)는 비밀번호 관리자에 보관 — 이게 없으면 백업 복호화 불가
```
> 비대칭(age 공개키) 채택 이유: 러너·아티팩트엔 **공개키만** 올라가 복호화 비밀이 GitHub 에 일절 없다.
> GitHub 계정이 통째로 털려도 private key(오프라인) 없이는 PII 를 못 읽는다. 대신 **private key 분실 = 백업 영구 복호화 불가**이므로 반드시 durable 보관.

### 4-3. 복구 절차

**공통 0~2단계 — 백업을 스크래치 DB 로 복원** (운영 아님, 안전):
```bash
# 0) 아티팩트 내려받기: GitHub → Actions → Weekly DB Backup → 해당 run → Artifacts → intervia-db-YYYYMMDD
# 1) 복호화 (오프라인 보관한 private key 로만 가능)
age -d -i intervia-backup-key.txt -o dump.sql dump.sql.age
# 2) 스크래치 DB 로 복원
turso db create intervia-restore
turso db shell intervia-restore < dump.sql
```

**(A) 전체 복구** — 운영 DB 자체가 손상/소실:
```bash
# 검증(행 수·핵심 테이블 스팟체크) 후 앱의 TURSO_DATABASE_URL/TOKEN 을
# intervia-restore 로 교체 → redeploy.  (시점 단위면 PITR 가 더 정밀 — §4-1)
```

**(B) 법인 단위 복구** — 한 법인만 잘못 삭제/손상 (다른 법인 활동은 보존):
전체 스왑/PITR 은 *다른 법인들의 그동안 정상 활동까지* 되돌리므로 부적절. 해당 법인 서브트리만
추출해 운영에 재삽입한다. [`scripts/restore-org.ts`](../scripts/restore-org.ts) 가 읽기 전용으로
INSERT SQL 을 뽑아준다 (운영 직접 쓰기 X — 사람이 검토 후 수동 적용).
```powershell
# 스크래치 DB 를 소스로 지정
$env:RESTORE_DATABASE_URL = "libsql://intervia-restore-....turso.io"
$env:RESTORE_AUTH_TOKEN   = "<intervia-restore 토큰>"   # turso db tokens create intervia-restore
npm run db:restore-org                    # 법인 목록 (org_id 확인)
npm run db:restore-org -- --org <id>      # → restore-org-<id>.sql 생성 (FK 순서대로)
# 생성 SQL 검토 → 🚨 사용자 승인 + 직전 백업 확보 후 운영 적용:
turso db shell <운영DB> < restore-org-<id>.sql
```
- 삭제분 재삽입은 기본(`--conflict error`). 이미 있는 행 덮어쓰기(롤백)는 `--conflict replace` →
  **운영 데이터 변경이므로 절대 규칙 적용**(승인+백업+대상 행 확인).
- 전역/공유(screening_cache·token_pricing·marketing_recipients)·휘발 인증 테이블은 추출 제외.
  포함 테이블·FK 순서·근거는 스크립트 상단 주석 참조. 로컬 검증: FK ON 빈 스키마 라운드트립 통과(2026-06-14).

### 4-4. 분기 복구 드릴 (3-2-2)
분기 1회: 최신 dump 를 임시 DB 에 복구 → 행 수·핵심 테이블 스팟체크. "백업이 실제로 복구되는가"를 확인(백업의 존재 ≠ 복구 가능).

---

## 5. 에스컬레이션 / 연락처

| 대상 | 연락 |
|---|---|
| 운영 책임자(대표·DPO 겸직) | `OPS_ALERT_EMAIL` / 회사 이메일(site-info COMPANY_INFO) |
| 외부 서비스 | Turso(support@turso.tech) · Vercel(대시보드 support) · GCP(콘솔 지원) · 메일 서버 운영 담당자 · Resend(대시보드, 대체 발송 경로) |
| 개인정보 침해 | [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) — 72시간 신고·정보주체 통지 |

## 6. 사후 (Postmortem)

해소 후: **무엇이 / 언제 / 영향범위 / 탐지경위 / 조치 / 근본원인 / 재발방지**를 블레임리스로 기록.
재발방지 액션은 `docs/COMMERCIAL_PLAN.md` 에 후속 작업으로 등록.

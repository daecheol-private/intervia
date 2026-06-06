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
| 토큰 환불/조정 | `/api/admin/orgs/[id]/refund`, grant-tokens | 사유 필수 + 감사 로그 |
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

## 5. 메일 발송 실패 (Resend / SMTP)

**증상**: 면접 안내·인증·결과 통보 메일 미도착. "본인 외 이메일로 발송 실패".

1. **가장 흔한 원인** — `MAIL_OVERRIDE_TO` 가 production 에 남아있음(지원자 메일이 그쪽으로 감) 또는 Resend 도메인 미verify(본인 메일만 발송 가능). → LAUNCH_CHECKLIST §1.
2. **Resend 상태** — resend.com 대시보드 발송 로그·도메인 verify 상태·일/월 한도(Free 100/일·3000/월).
3. **법인 SMTP** — 법인이 자체 SMTP 등록한 경우 그 계정 문제일 수 있음. `/api/orgs/smtp` 의 verify 로 재확인.
4. **부분 실패는 비치명적** — 자동불합격 알림·리마인더 등은 best-effort(실패해도 cron 흐름 안 막음). 핵심은 면접 링크·결과 통보.
5. **지속 장애** — 한도 초과면 Resend Pro 전환, 도메인 문제면 DNS(DKIM/SPF) 재점검.

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
| Resend | 100/일·3000/월 | 발송 실패 | Pro($20/월) |
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

**정책 (C-2 결정 2026-06-07): Turso PITR(주) + 주간 오프사이트 dump(부).**

별도 serverless export cron 은 두지 않는다 — Turso 의 PITR(시점 복구)와 공식 `turso db dump` 가
자체 구현보다 견고하고, 서버리스에서의 전체 dump 는 함수 타임아웃·부분실패 위험이 크다.

### 4-1. 1차 — Turso PITR (자동, 무료 티어 7일)
- Turso 가 시점 복구를 제공. 실수 삭제·손상 시 특정 시각으로 복구.
- 복구: `turso db shell` 또는 대시보드에서 PITR 으로 새 DB 생성 → 검증 → URL 교체. (정확한 절차는 Turso 문서 — 플랜별 보존기간 확인.)

### 4-2. 2차 — 주간 오프사이트 dump (Turso 계정 자체 손실·오삭제 대비)
PITR 은 Turso 계정·DB 가 살아있을 때만 유효 → 계정 손실/오삭제 대비 **off-Turso 사본**을 둔다.

```bash
# 운영자 로컬 또는 스케줄 머신(주 1회 권장)
turso db dump <db-name> --output backups/intervia-$(date +%Y%m%d).sql
# 안전한 곳에 보관 (암호화 저장소 — 후보자 PII 포함이므로 접근통제 필수)
```
- (선택) GitHub Actions `schedule` 로 자동화 가능 — turso CLI + `TURSO_AUTH_TOKEN` secret, dump 를 아티팩트/암호화 스토리지로. 덤프는 PII 포함이라 공개 저장소·평문 보관 금지.

### 4-3. 복구 절차
```bash
# 빈/새 DB 에 dump 적용
turso db create intervia-restore
turso db shell intervia-restore < backups/intervia-YYYYMMDD.sql
# 검증 후 앱의 TURSO_DATABASE_URL/TOKEN 교체 → redeploy
```

### 4-4. 분기 복구 드릴 (3-2-2)
분기 1회: 최신 dump 를 임시 DB 에 복구 → 행 수·핵심 테이블 스팟체크. "백업이 실제로 복구되는가"를 확인(백업의 존재 ≠ 복구 가능).

---

## 5. 에스컬레이션 / 연락처

| 대상 | 연락 |
|---|---|
| 운영 책임자(대표·DPO 겸직) | `OPS_ALERT_EMAIL` / 회사 이메일(site-info COMPANY_INFO) |
| 외부 서비스 | Turso(support@turso.tech) · Vercel(대시보드 support) · Resend(대시보드) · GCP(콘솔 지원) |
| 개인정보 침해 | [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) — 72시간 신고·정보주체 통지 |

## 6. 사후 (Postmortem)

해소 후: **무엇이 / 언제 / 영향범위 / 탐지경위 / 조치 / 근본원인 / 재발방지**를 블레임리스로 기록.
재발방지 액션은 `docs/COMMERCIAL_PLAN.md` 에 후속 작업으로 등록.

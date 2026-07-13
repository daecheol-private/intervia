# 필수 기능 자동 테스트 (Critical Tests)

**목적**: 운영 배포 전, 면접관(HR)·지원자 레벨에서 반드시 정상 동작해야 하는 기능을 코드 레벨(HTTP API + lib 단위)에서 자동 검증한다. 하나라도 실패하면 배포하지 않는다.

사용자가 **"필수테스트하고 배포해줘"** 라고 하면 아래 배포 프로토콜을 그대로 수행한다.

## 배포 프로토콜

```
① npx tsc --noEmit                 # 타입체크
② npx eslint . --quiet            # 린트 (vercel-build 1단계 로컬 재현 — 실패 시 배포 자체가 안 나감)
③ npm run test:critical           # 이 문서의 시나리오 전체 (아래)
④ ①~③ 전부 통과 → 사용자에게 결과 표 보고 → git push origin HEAD:main
⑤ 배포 반영 확인 (prod-domain-and-deploy-verify 절차 — 랜딩 문구 또는 ?dpl= 해시)
```

⚠️ 마이그레이션(`drizzle/*.sql` 변경)이 포함된 push 는 별도로 CLAUDE.md "운영 데이터 보호 절대 규칙" + pre-push 게이트를 따른다. 이 테스트는 그 규칙을 대체하지 않는다.

## 실행 방법

```powershell
cd D:\intervia\interviewer
npm run test:critical        # 전체 (~2/4분, dev 서버 라우트 컴파일 포함)
```

- 결과: node:test TAP 출력. 종료코드 0 = 전부 통과.
- 실패 시: 실패한 CT ID 기준으로 아래 표의 "예상 결과"와 실제 응답을 대조해 원인 분석.

## 격리 원칙 (운영·로컬 dev 절대 불간섭)

| 자원 | 테스트에서 사용하는 것 | 절대 건드리지 않는 것 |
|---|---|---|
| DB | `file:.testdb/critical.db` (매 실행 재생성) | 운영 Turso, 로컬 `data.db` |
| 서버 | 테스트 전용 `next dev -p 3103` + 전용 빌드 디렉토리 `.next-test/` (`NEXT_TEST_DIST_DIR` — Next 16 은 distDir 락으로 프로젝트당 dev 1개만 허용하므로 분리) | 개발 서버(3003)와 그 `.next/` |
| 파일 | `uploads/` 에 `ct-{run}-*` 프리픽스만, 종료 시 정리 | 기존 업로드 파일 |
| LLM | 호출 안 함 (자격증명 빈 값 → 호출 시 즉시 실패) — "성공 시에만 과금" 경계 검증에 활용 | Vertex AI 호출(비용) |
| 메일/알림톡 | SMTP·알리고 env 빈 값 → 발송 시도 자체가 안전 실패/skip | 실제 발송 |

강제 방법: 테스트 러너가 서버 spawn 시 `TURSO_DATABASE_URL=""`, `DATABASE_URL="file:.testdb/critical.db"`, `BLOB_READ_WRITE_TOKEN=""`, `SMTP_* =""`, `GOOGLE_APPLICATION_CREDENTIALS=""` 를 **명시적으로 주입** — `.env.local` 값은 process env 우선 규칙에 의해 무시된다. 하네스는 시작 전에 `DATABASE_URL` 이 `file:` + `.testdb` 인지 assert 하고 아니면 즉시 중단한다 (`tests/critical/env.ts`).

## 시드 (매 실행 동일 상태)

`scripts/seed-test.mjs` 와 동일 구성을 테스트 DB에 재현:

- 법인: `test-company-a` / `test-company-b` (verified)
- 사용자 (비번 전부 `Test1234!aZ`, active + 이메일 인증됨): `sysadmin@test`(system_admin) / `admin@company-a.test`(org_admin A) / `member@company-a.test`(member A) / `admin@company-b.test`(org_admin B)
- 지갑: A·B 각 1,000 토큰. 단가: `job_post:10, resume_upload:5, interview:30`
- 공고: JOB_A(A사 공개), JOB_A_PIN(A사 PIN=1234), JOB_B(B사)
- 이력서 픽스처: pdfkit 으로 실행 시 생성한 실제 PDF (pdf-parse 추출 검증됨)

## 시나리오

표기: 🧑‍💼 = 면접관(HR) 경로, 🙋 = 지원자 경로, ⚙️ = 시스템/정합성.

### CT-0. 인프라

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-001 | ⚙️ `GET /api/health` | 200 (DB 연결 포함 정상) |

### CT-1. 인증

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-101 | 🧑‍💼 정상 로그인 (`admin@company-a.test`) | 200 `{id,email,name}` + `session` 쿠키(httpOnly) |
| CT-102 | 잘못된 비밀번호 | 401, 세션 쿠키 미발급 |
| CT-103 | 쿠키 없이 `GET /api/jobs` | 차단 — proxy 가드의 `/login` 리다이렉트(3xx) 또는 401. 데이터 미노출이 계약 |
| CT-104 | 로그아웃 후 같은 쿠키로 `GET /api/jobs` | 로그아웃 2xx → 이후 401 (서버측 세션 무효화) |
| CT-105 | 동일 이메일 로그인 5회 실패 후 6회째 | 429 `{code:"rate_limited"}` |
| CT-106 | 이메일 미인증 계정 로그인 | 403 `{code:"email_unverified"}` |

### CT-2. 테넌시 / 권한 격리 (가장 위험한 회귀)

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-201 | 🧑‍💼 A사 admin 이 B사 공고 `GET /api/jobs/{JOB_B}` | 404 (존재 위장) |
| CT-202 | A사 admin 이 B사 후보자 `GET /api/candidates/{id}` | 404 |
| CT-203 | member 가 `GET /api/orgs/members` (org_admin 전용) | 403 |
| CT-204 | member 가 `PATCH /api/admin/pricing` (system_admin 전용) | 403 |
| CT-205 | A사 admin 이 `bulk-delete` 에 B사 후보 id 포함 | 전체 거부 (B사 후보 생존) |
| CT-206 | system_admin 이 B사 공고 + A사 PIN 공고 접근 | 둘 다 200 (전역 + PIN 우회) |

### CT-3. 공고 CRUD + 과금

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-301 | 🧑‍💼 공고 생성 | 200 row + ledger `job_post` -10 + 잔액 정확히 감소 |
| CT-302 | 필수 필드(title 등) 누락 | 400 |
| CT-303 | 공고 수정 PUT | 200, 변경 반영 |
| CT-304 | 생성 5분 내 삭제 | 204 + `refund` ledger +10, 잔액 복원 |
| CT-305 | 잔액 0 상태에서 공고 생성 | 402 `{code:"insufficient_tokens"}` |
| CT-306 | PIN 공고: 미해제 GET → 오답 PIN → 정답 PIN → 재GET | 403 `{locked:true}` → 401 → 204 → 200 `{locked:false}` |

### CT-4. 이력서 인입 — HR 업로드 🧑‍💼

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-401 | 정상 PDF 업로드 (동의 체크) | 200 `created:1`. 후보 row(org/job 매핑, 마스킹 파이프라인 진입), `screening_jobs` queued 1건, **과금 0** (후차감 전) |
| CT-402 | 같은 파일 재업로드 | `created:0, failed:1` (SHA-256 중복) |
| CT-403 | 동의 미체크 | 400 `{code:"applicant_consent_required"}` |
| CT-404 | 확장자 위장 파일(.pdf 인데 텍스트) | 매직바이트 거부 → `failed:1` |
| CT-405 | 잔액 0 상태 업로드 | 402 |
| CT-406 | 잠긴 공고(PIN 미해제) 업로드 | 403 |

### CT-5. 지원자 셀프 지원 (공개 링크) 🙋

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-501 | 정상 지원 (이름/이메일/동의/PDF/referrer) | `{ok:true}` + 후보 row `source:"apply_link"` + `apply_referrer_host` 호스트만 저장 + 동의시각 기록 + 큐 등록 |
| CT-502 | 같은 이메일 재지원 | 409 `{code:"already_applied"}` |
| CT-503 | 수집·이용 동의 누락 | 400 `{code:"consent_required"}` |
| CT-504 | **잔액 0 이어도** 지원 접수 성공 (지원자 유실 방지 정책) | `{ok:true}`, 평가는 큐 보류 |
| CT-505 | 무효 지원 토큰 | 404 `{code:"invalid_link"}` |

### CT-6. 서류 평가 큐 — LLM 경계 ⚙️

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-601 | 워커 무인증 호출 (`/api/internal/process-screenings`) | 401 |
| CT-602 | 워커 정상 호출(X-Internal-Secret), LLM 자격증명 없음 | 200. **과금 0** + 후보가 `screened` 로 오염되지 않음 + 큐는 재시도/실패 상태 (= "평가 성공 시에만 과금" 보증) |
| CT-603 | queued 후보에 단건 `screen` 재트리거 | 2xx (백오프 해제 재시도 계약) |

### CT-7. AI 면접 토큰 플로우 🙋 (LLM 채팅 제외 전 구간)

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-701 | 서류평가 없는 후보에 링크 발급 | 409 `{code:"screening_required"}` |
| CT-702 | 리포트 존재 후보 발급 | 200 세션(accessToken) + stage→`ai_pending` + **과금 0** |
| CT-703 | `GET /api/interview/[token]` | 200 `consentRequired:true`, 평가·인성 원응답 비노출 |
| CT-704 | 무효 토큰 GET | 404 |
| CT-705 | 동의 전 chat | 403 `{code:"consent_required"}` |
| CT-706 | 메시지 2개 미만 complete / 메시지 있어도 동의 전 complete | 400 "대화 부족" / 403 `consent_required` |
| CT-707 | 동의 제출 — 본인 이메일 불일치 | 403 `{code:"email_mismatch"}` |
| CT-708 | 정상 동의 (필수 2항목 + 본인 이메일) | `{ok:true, consentVersion}` + 재GET 시 `consentRequired:false` |
| CT-709 | 만료 세션 GET / chat | `expired:true` / 400 |
| CT-710 | cron `expire-interviews` (Bearer CRON_SECRET) | 200 + pending 만료 세션 `expired` + 자동 불합격 처리 |
| CT-711 | 인성검사 (법인 컬처핏 설정 시): GET 문항 → 제출 → 재제출 | 문항쌍 노출(특성 태그 비노출) → 채점 저장 → 멱등 · 동의 후 검사 전 chat 403 `personality_required` |
| CT-712 | 지원 취소 withdraw ({email}) | 세션 expired + outcome `withdrawn` |

### CT-8. 후보자 데이터 보호 / 권리 ⚙️🙋

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-801 | 후보 상세 GET 응답 | `resumeText` 원문 필드 미포함 (마스킹본만) — 보안감사 회귀 |
| CT-802 | `me` POST (본인 이메일) | 보유 항목 요약 반환 |
| CT-803 | `me` DELETE (즉시 파기) | 이력서 본문·파일·전화 삭제, 평가 보존 |
| CT-804 | 후보 삭제 (HR) | row + 로컬 파일 삭제 |
| CT-805 | 공고 삭제 | 소속 후보·세션 연쇄 정리 |

### CT-9. 대면 면접 일정 — 지원자 응답 🙋

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-901 | SMTP 미설정 상태 일정 제시 | 503 `{code:"smtp_not_configured"}` (조용한 실패 금지 계약) |
| CT-902 | (DB 시드 스케줄) 공개 `GET /api/schedule/[token]` | 200 슬롯 목록 |
| CT-903 | 슬롯 선택 select | `{ok:true, selectedSlot}` — 메일 불가 환경에서도 확정은 성공 |
| CT-904 | 같은 토큰 재선택 | 409 |

### CT-10. 토큰 지갑 정합성 (lib 단위 직접 호출) ⚙️

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-1001 | `chargeFeature` 동일 (reason,refType,refId) 2회 | 2회째 `alreadyCharged:true`, ledger 1건 |
| CT-1002 | `refundFeature` 2회 | 1회만 환불 (멱등) |
| CT-1003 | `chargeRepeatable` 3회 | refType `base`/`_re1`/`_re2` 로 각각 과금 |
| CT-1004 | ledger delta 누적 == wallet.balance | 일치 (체인 정합) |
| CT-1005 | `requireSpendableBalance` | 잔액 0→차단 / 양수→통과 / system_admin→통과 |
| CT-1006 | 동일 ref 병렬 charge ×5 | 총 1회만 반영 (동시성 멱등) |

## 범위 외 (이 스위트가 다루지 않는 것)

- **LLM 응답 품질/성공 경로** — 비결정적 + 비용. 경계(과금·상태 오염 방지)만 검증. 실 LLM 스모크가 필요하면 수동으로 1건 업로드→평가 확인.
- MCQ 출제/영문 면접/알림톡 실발송/토스 결제/녹취 평가 — 각 기능 문서·수동 절차(TEST_CASES.md)로 검증.
- UI 렌더링 — API 계약까지만. 화면은 preview 검증.
- 마이그레이션 안전 — `scripts/check-migration-safety.mjs` + pre-push 게이트가 담당.

## 유지보수 규칙

- API 계약(상태코드·code 필드)을 바꾸는 변경은 **이 문서와 `tests/critical/` 를 같이 수정**한다.
- 새 필수 기능이 생기면 CT 그룹을 추가하고 시나리오 표를 갱신한다.
- 테스트가 실패하는데 "테스트가 낡아서"인지 "코드가 깨져서"인지 애매하면 → 배포 중단하고 사용자에게 보고가 기본값.

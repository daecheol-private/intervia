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
| CT-905 | 후보자 불합격 처리(`PATCH /api/candidates/[id]/stage`) | 활성 일정 `cancelled` + AI 세션 `expired` (cleanupOnClose) + 일정 링크 410 |
| CT-906 | 종결 후보의 옛 링크(정리 이전 `pending` row) GET/select/counter | 전부 410 — 후보자 상태(`isScheduleSuperseded`)로 차단 |

### CT-10. 토큰 지갑 정합성 (lib 단위 직접 호출) ⚙️

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-1001 | `chargeFeature` 동일 (reason,refType,refId) 2회 | 2회째 `alreadyCharged:true`, ledger 1건 |
| CT-1002 | `refundFeature` 2회 | 1회만 환불 (멱등) |
| CT-1003 | `chargeRepeatable` 3회 | refType `base`/`_re1`/`_re2` 로 각각 과금 |
| CT-1004 | ledger delta 누적 == wallet.balance | 일치 (체인 정합) |
| CT-1005 | `requireSpendableBalance` | 잔액 0→차단 / 양수→통과 / system_admin→통과 |
| CT-1006 | 동일 ref 병렬 charge ×5 | 총 1회만 반영 (동시성 멱등) |

### CT-11. 이력서 추출 판정 (lib 단위 직접 호출) ⚙️

2026-07-20 사고 회귀 — 이력서 하나에서 스킬 줄 `한글/MS워드` 의 "MS" 가 석사로 잡혀 실제 학사를
덮어썼고(`education-extract`), 증명사진 대신 더 큰 포트폴리오 스크린샷이 뽑혔다(`photo-extract`).
둘 다 사람이 화면을 봐야만 드러나는 조용한 오판이라 판정 결과를 여기서 고정한다.

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| CT-1101 | 스킬·경력 표현 9종 (`한글/MS워드`, `MS Office`, `Scrum Master`, `master branch`, `Business Analyst(BA)`, `분석 사례`, `분석 사업`, `박 사원`, `입학 사정`) | 전부 `level: null` — 학위로 오탐 없음 |
| CT-1102 | 실제 학위 표기 14종 (`석사 졸업`·`공학석사`·`석 사 졸업`(PDF 자간)·`M.S.`·`MBA`·`Ph.D`·`B.S.`·`컴퓨터공학부`·`전문학사`·`고졸` 등) | 각 기대 등급으로 인식 (오탐 차단이 정탐을 깎지 않음) |
| CT-1103 | 학력 섹션 + 보유기술 섹션이 같이 있는 이력서 | `학사` + 학교명 — 뒤쪽 스킬 줄이 앞쪽 학력을 덮어쓰지 않음 |
| CT-1104 | 증명사진(235x302)이 스크린샷(532x607)보다 **작고**, ZIP 엔트리엔 스크린샷이 **먼저** 저장된 DOCX | 본문 첫 인물형 이미지(235x302) 선택 — 면적·ZIP 순서 어느 쪽으로 골라도 오답인 배치 |
| CT-1105 | 가로형 배너·로고만 있는 DOCX | `null` (아무거나 집지 않음 — 화면은 이니셜 아바타 폴백) |
| CT-1106 | 표 양식 이력서 + `대학원(박사)` 가 라벨·`YYYY.MM` 뿐인 미기입 행 | `level: 석사` — 빈 학위 행을 최종학력으로 잡지 않음 (학교·전공은 이 양식에서 부정확, 아래 참조) |
| CT-1107 | 생년월일 2자리 연도 표기 5종 (`83.01.24`, `83-01-24`, `83년 1월 24일`, 표 양식 분리 셀 등) + 기존 표기(`1983.01.24`·`93년생`·`나이: 30세`) | 전부 정확한 나이. 세기는 유효 나이 범위(14~90)로 판별 |
| CT-1108 | 라벨 없는 경력·자격증 날짜 (`15.01.01 ~ 20.12.31`, `2025.06.03`) / 라벨 + 뒤쪽 경력 날짜 | 앞 둘은 `null`(생년월일 아님), 마지막은 라벨 쪽 값이 이김 |
| CT-1109 | `extractPII` 가 인식한 생년월일을 `maskText` 가 가리는지 (같은 줄·표 양식) + 라벨 없는 경력 기간 보존 | 추출 인식 = 마스킹 커버. 경력 기간은 평가에 필요하므로 안 가림 |
| CT-1110 | 표 양식 "값 → 라벨" 순서 (`010-…휴대폰` + `02-…전화번호`) / 기존 "라벨 → 값" / 긴급연락처 | 본인 휴대폰(`010-…`) 선택. 라벨 앞뒤 중 **더 가까운** 번호를 택하고, 긴급연락처는 본인 번호를 덮지 않음 |
| CT-1111 | 채용포털 양식 6종 (`영산대학교(부산) 대학교(4년) 졸업`, `강원대학교(삼척) …`, `학점은행제 …`, `한림대학교 대학원(박사) 수료`) | 실제 이력서에서 확인한 정답과 일치. 괄호 안 지역명을 학교로 오인하지 않고(`삼척대학교` X), 캠퍼스는 학교명에 붙이며(`강원대학교(삼척)`) 학제·학위 괄호(`(4년)`·`(박사)`)는 붙이지 않는다. `졸업`/`수료` 상태 유지 |
| CT-1112 | `maskText` known 이름 — 부정확한 이름(`개발`)/조사·호칭(`홍길동은`·`홍길동님`)/표 양식(라벨과 값이 다른 줄)/`(이름 미상)` | `웹개발팀` 이 안 깨지고(앞 경계), 조사 붙은 이름은 가려지고(뒤 열림), `extraNames` 로 본문 추출 이름도 마스킹, `(이름 미상)` 은 치환 안 함 |
| CT-1113 | 경력 표기 — `총 경력 24년 4개월`·`경력 총 27년`·`총 30년`·`총 경 력 17년10개월` / `(경력1년반)`(문장 속)·`신입` | 명시 표기만 연 단위로 인정(개월 버림). "총" 없는 문장 속 표기는 `null` — LLM 이 채울 몫 |

픽스처 `makeResumeDocx`(`tests/critical/fixtures.ts`)는 본문 등장 순서와 ZIP 저장 순서를 따로
받는다. 실측한 이력서에서 첫 ZIP 엔트리는 image3, 본문 첫 이미지는 image11 로 **둘이 일치하지
않았다** — CT-1104 가 이 함정을 재현한다. PNG 는 시그니처+IHDR 만 정확한 스텁이라 픽셀 디코딩이
필요한 테스트에는 못 쓴다.

CT-1106 의 배제 조건은 **좁다** — 학위 행에 `YYYY.MM` 류 플레이스홀더가 있고 실제 값(연월·
학교명)이 하나도 없을 때만 미기입으로 본다. 그 외에는 어떤 후보도 떨어뜨리지 않는다.

> ⚠️ 여기를 넓히지 말 것. 판정 근거를 "학위 뒤에 학교명이 따라오는가"로 확장했다가 로컬
> 실데이터 107건 중 **51건이 달라지는 회귀**를 냈다 — 학사→고졸 강등, `졸업`/`수료` 상태
> 소실, `영산대학교`→`학력대학교`(표 셀이 붙어 추출됨), 전공에 `"하며"` 같은 조각. 학교명
> 인식이 약칭(`창원대`)과 셀 붙음에 취약해 근거로 쓸 수 없다. 이 파일의 픽스처 6개는 전부
> 통과했는데도 실데이터가 깨졌다 — **추출 로직 변경은 픽스처만으로 판단하지 말고 실제 이력서
> 회귀 스캔(수정 전/후 diff)을 반드시 돌릴 것.**

CT-1112 의 이름 마스킹은 **앞 경계만** 건다. 뒤에도 걸면 조사·호칭이 붙은 형태를 통째로
놓치고, 앞을 안 걸면 부정확한 known 이름이 본문을 파괴한다(`개발` → `웹[이름]팀`). 마스킹은
과검출이 안전한 방향이라 앞만 막는다 — `개발자로` → `[이름]자로` 같은 과검출은 감수한다.
`extraNames` 는 본문 추출 이름용이다: DB 이름은 **파일명 유래**라 본문의 진짜 이름과 다를 수
있고, 그러면 이름이 마스킹되지 않은 채 LLM 으로 나간다.

CT-1110 은 라벨 **앞뒤 거리 비교**다. 표 양식 PDF 는 셀이 "값 → 라벨" 로 추출되는 경우가 흔해
라벨 뒤만 보면 다음 셀 값을 집는다. 앞뒤 모두에서 후보를 찾아 라벨에 붙어 있는 쪽을 택하되,
`RE_PHONE_LABEL_EXCLUDE`(긴급·보호자·회사·팩스) 가드는 그대로 앞선다.

CT-1107·1108 도 같은 구조다. 2자리 연도는 **생년월일 라벨 뒤 50자 안에서만** 인정한다
(`RE_DOB_LABEL` → `RE_DOB_LOOSE`). 라벨이 없으면 기존 4자리 전용 `RE_DOB_YEAR` 전체 스캔으로
폴백하므로, 라벨 없이 `1983-01-24` 만 적힌 이력서도 계속 동작한다. 라벨 세트는 `lib/mask.ts`
의 dob 라벨과 정렬돼 있다 — 한쪽만 고치면 마스킹과 어긋난다(GOTCHAS §0-7 사고 패턴).

## 범위 외 (이 스위트가 다루지 않는 것)

- **LLM 응답 품질/성공 경로** — 비결정적 + 비용. 경계(과금·상태 오염 방지)만 검증. 실 LLM 스모크가 필요하면 수동으로 1건 업로드→평가 확인.
- MCQ 출제/영문 면접/알림톡 실발송/토스 결제/녹취 평가 — 각 기능 문서·수동 절차(TEST_CASES.md)로 검증.
- UI 렌더링 — API 계약까지만. 화면은 preview 검증.
- 마이그레이션 안전 — `scripts/check-migration-safety.mjs` + pre-push 게이트가 담당.

## 유지보수 규칙

- API 계약(상태코드·code 필드)을 바꾸는 변경은 **이 문서와 `tests/critical/` 를 같이 수정**한다.
- 새 필수 기능이 생기면 CT 그룹을 추가하고 시나리오 표를 갱신한다.
- 테스트가 실패하는데 "테스트가 낡아서"인지 "코드가 깨져서"인지 애매하면 → 배포 중단하고 사용자에게 보고가 기본값.

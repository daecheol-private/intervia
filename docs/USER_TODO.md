# 운영자(강대철) 직접 작업 체크리스트

코드로 해결 불가능하고, **사람이 외부 서비스에 로그인해서 처리해야 하는 항목**만 모아둔 파일.
Claude가 코드를 다 고쳐도 이 항목들이 비어 있으면 상용 출시 불가.

작업 완료 후 Claude에게 **"USER_TODO 업데이트해줘, A-3 끝났어"** 식으로 말하면 체크박스 갱신 + 후속 코드 처리.

---

## 진행 로드맵 (합의 2026-05-22)

```
Phase A — 무료 셋업 + 사업자등록     (이번주, 비용 0원)
Phase B — 도메인 + stage 외부 테스트  (다음주 초, ~$10)
Phase C — DPA + 법적 마무리          (stage 운영 중)
Phase D — 첫 고객 약속 시점          (Vercel Pro·통신판매업·보험·PG)
Phase E — 결제 시스템 개발           (PG 가맹 후, Claude 가 코드)
```

각 Phase 는 앞 Phase 의 prerequisite 완료를 가정. 순서 어기면 다음 단계 비용 낭비.

---

## Phase A — 무료 셋업 + 사업자등록 (이번주)

> 비용 0원. stage 테스트 직전까지 모두 완료해야 함.

### [x] A-1. Gemini API paid tier 결제 등록 (완료 2026-05-22)
- 충전 paid tier 활성화 확인 — `scripts/test-gemini.mjs` 3개 모델 호출 성공.
- 코드 분기: `lib/gemini.ts` `MODELS` — screening=flash / interview=pro / interviewEval=pro.

### [x] A-2. 사업자등록 (완료 2026-06-22) ⭐
- **왜**: 비용 0원의 행정 절차. 그러나 안 되어 있으면:
  - 처리방침 사업자번호 빈칸 → PIPA §30 위반 (법적 검토 자체가 흠)
  - DPA 서명 시 사업자 정보 기재 불가
  - B2B 계약·세금계산서 발행 불가
- **할 일**:
  1. 홈택스 → 신청·제출 → 사업자등록 신청 (개인사업자 즉시발급)
  2. 업종 코드: 정보서비스업 (642001) 또는 응용소프트웨어 개발 및 공급업 (582102)
  3. 발급된 사업자등록번호 + 통신판매업 신고번호 미정 상태로 기록
- **완료 후 Claude 가 처리**:
  - `lib/site-info.ts` `COMPANY_INFO.bizRegistrationNo` 갱신
  - `/privacy` `/terms` `/legal/*` 모든 페이지 자동 반영

### [x] A-3. dev / prod GOOGLE_API_KEY 분리 발급 (해소 2026-05-26 — Vertex 통합으로 무효화)
- **2026-05-26 통합 이후 폐기**: 모든 LLM 호출이 Vertex AI 서울 (gemini-2.5-flash) 로 단일화되면서 직접 Gemini API (`GOOGLE_API_KEY`) 자체가 제거됨. dev/prod 키 분리 이슈, Tier 1 승급 이슈 모두 해당 없음.
- **현재 인증 방식**: `GOOGLE_CLOUD_PROJECT` + 서비스계정 JSON (`GOOGLE_APPLICATION_CREDENTIALS` 파일 / `_JSON` 통문자열). GCP 결제 계정에 직접 청구.
- **이전 prod 키**: 폐기 가능 (Google AI Studio 에서 revoke). 보안상 사용 안 하는 키는 정리 권장.

### [x] A-4. Sentry 프로젝트 생성 (완료 2026-05-22)
- ✅ Sentry 가입 + intervia 프로젝트 생성 + DSN 발급
- ✅ `.env.production.local` 에 `SENTRY_DSN` 입력
- ✅ `scripts/test-sentry.mjs` 테스트 envelope POST 200 OK
- ✅ `lib/error-reporter.ts` event_id 버그 발견·수정 (`Math.random` → `crypto.randomBytes(16).toString("hex")`)
- 📋 **Phase B 배포 시 Vercel 환경변수에도 `SENTRY_DSN` 동일 입력 필수**
- 📋 (선택) Slack 연동 — `SLACK_WEBHOOK_URL` 환경변수 추가 시 critical 액션 자동 알림

### [x] A-5. Vercel Blob 토큰 발급 (완료 2026-05-22)
- ✅ Vercel 계정 신규 생성 (GitHub OAuth, daecheol1983 GitHub)
- ✅ Empty project `intervia` 생성 (Hobby plan)
- ✅ Blob store `intervia-resumes` 생성 (Region: ICN1 서울)
- ⚠️→✅ 처음 Private 모드로 생성 → 코드와 불일치 → **Public 모드로 재생성** 해서 해결
- ✅ `.env.production.local` 에 `BLOB_READ_WRITE_TOKEN` 추가
- ✅ `scripts/test-blob.mjs` 업로드/다운로드/삭제 3단계 모두 통과
- 📋 **Phase B 배포 시 Vercel 환경변수에도 동일 토큰 입력 필수**
- 📋 단, Vercel 프로젝트 안에서 Blob 만들면 환경변수가 **프로젝트 deploy 시 자동 주입** 되므로 별도 입력 불필요할 수도 있음 — 배포 시점에 환경변수 화면에서 확인

### [x] A-6. 로컬 풀 사이클 자동 E2E 테스트 (완료 2026-05-22)
- ✅ `scripts/test-e2e-cycle.mjs` 9단계 통과 (91.9초)
- ✅ Step 1 로그인 / 2 잔액 / 3a consent 누락 차단 / 3b 업로드 / 4 서류평가 (flash, 27s, score=90) / 5 면접 토큰 / 6 동의 5종 / 7 채팅 3턴 (pro, 평균 5.7s) / 8 평가 (pro, 43.6s) / 9 토큰 -35
- ✅ 모델 분기 검증: gemini-2.5-flash (서류) + gemini-2.5-flash (면접+평가) — **2026-05-26 Vertex 통합 이후 셋 다 flash 로 변경. 재측정 필요.**
- ✅ Pro thinking=128 latency 5.7s 평균 — UX 임계 통과 (8s 권장). Flash 통합 후 재측정 권장.
- ⚠️ 발견된 운영 이슈:
  - 면접 latency 5.7s — Hobby 함수 timeout 10s 와 가까움. 운영 시 Vercel Pro 60s timeout 권장 (Phase D)
  - PDFKit 생성 PDF 가 multipart 전송 시 일부 깨짐 → 검증된 sample-resume.pdf 로 진행
- 📋 **UI 수동 확인 (선택)**: 자동 테스트는 API 레벨. 화면 UX (체크박스 색상·alert 메시지·면접 진행률 바·이의제기 링크) 는 별도 시간에 시각 확인 권장
- **왜**: 코드 변경(consent gate, model 분기, thinking config) 의 첫 통합 검증.
- **할 일**:
  1. `npm run dev` (로컬 SQLite)
  2. `LOCAL_DB=1 npm run db:seed-test` 로 테스트 시드
  3. `admin@company-a.test` / `Test1234!aZ` 로그인
  4. 공고 1개 생성 → 토큰 차감 확인
  5. 동의 체크박스 미체크 → 업로드 차단 확인
  6. 동의 체크 + 이력서 PDF 1개 업로드 → 평가 자동 큐 진입
  7. 평가 완료 (gemini-2.5-flash 호출, ~30초)
  8. 면접 링크 생성 → 본인 이메일 발송 (당시 Resend 샌드박스라 본인 메일만 가능했음. 2026-07-25 회사 SMTP 전환 후엔 제약 없음)
  9. 시크릿창에서 토큰 링크 클릭 → 동의 4종 체크 → 채팅 5턴 (gemini-2.5-flash, thinking=128, 3-4초 응답)
  10. 면접 종료 → 평가 JSON (gemini-2.5-flash) 생성
  11. `/candidates/[id]` 에서 최종 결과 확인
- **검증**: 11 단계 모두 막힘 없이 통과 + Google Cloud Console → APIs → Gemini API 호출 통계에서 flash·pro 분리 확인

---

## Phase B — 도메인 + stage 외부 테스트 (다음주 초)

> 비용 ~$10 (도메인 1회). stage 환경 외부 인원 테스트 가능 상태.

### [x] B-1. 도메인 구매 (완료 — https://intervia.kr) ⭐
- **왜**: stage 외부 테스트의 prerequisite. Resend verify, B2B 신뢰도, 세금계산서 발송 모두 도메인 필요.
- **추천 등록처**:
  - **Cloudflare Registrar** (마진 0%, ~$10/년) — `.com` 권장
  - 가비아 `intervia.kr` ~22,000원/년
  - 후이즈 `intervia.co.kr` ~30,000원/년 (사업자등록 필요)
- **할 일**:
  1. 등록처 가입·로그인
  2. `intervia.kr` (또는 선택한 도메인) 검색·결제
  3. Claude 에게 알리기: **"도메인 샀어, intervia.kr 이야"**
- **완료 후 Claude 가 자동 처리** (모두 2026-06 처리 완료):
  - Vercel 도메인 연결 가이드 (DNS A/CNAME)
  - Resend Dashboard 도메인 verify 절차 안내 (DKIM/SPF/DMARC TXT)
    → 2026-07-25 주 경로가 회사 SMTP 로 바뀌며 루트 SPF 는 회사 서버 단독. Resend DKIM 레코드는 대체 경로용으로 보존
  - `SMTP_FROM` 환경변수 갱신 권고
  - `lib/site-info.ts` `baseUrl` 갱신
  - 처리방침 §5 PROCESSORS 표에 Resend Inc. (미국) 추가 → 유지(대체 경로). 주 경로 추가는 C-4-2
  - `CONSENT_VERSION` bump → 기존 후보자 재동의 (현 로컬 DB 비어 있어 영향 없음)

### [x] B-2. data.go.kr 사업자등록정보 API 키 발급 (완료 2026-06-14)
- **왜**: 가입 시 신규 법인이 입력한 사업자번호 외부 검증 (활성 사업자인지). 누락돼도 기능 동작하나 신뢰도 ↑.
- **할 일**:
  1. https://www.data.go.kr 회원가입
  2. "국세청 사업자등록정보 진위확인 및 상태조회" 검색 → 활용신청 (개발용 일 1000건 무료)
  3. 인증키(Encoding 키) 복사
  4. `.env.production.local` `BUSINESS_REGISTRY_API_KEY` 입력 + Vercel 환경변수 추가

### [ ] B-3. stage 외부 인원 1~3명 면접 풀 테스트
- **왜**: 로컬 테스트가 검증 못 하는 것 — 실제 메일 도달·외부 후보자 UX·차별 신호·LLM latency 실제 체감.
- **할 일**:
  1. 가족·친구 1~3명에게 협조 요청
  2. 본인 회사 공고 1개 + 그들 이력서 업로드 (동의 체크) → 평가
  3. 그들 이메일로 면접 링크 발송 → 실제 도달 확인
  4. 그들이 면접 진행 → 사용성·자연스러움·이상한 응답 모두 기록
  5. 면접 평가 결과 검토 → 점수 캘리브레이션 합리적인지 체감
- **검증**: 후보자가 면접 마치고 "AI 면접 같지 않다" 라고 느낄 정도면 합격

### [x] B-4. GitHub Dependabot 활성화 (완료 2026-07-01)
- **왜**: pdf-parse 등 취약점 자동 알림.
- **할 일**: GitHub 리포 → Settings → Code security and analysis → Dependabot alerts + security updates 활성화.
- **완료 (2026-07-01)**: Dependency graph + alerts + security updates + malware alerts + grouped security updates 전부 ON. (Automatic dependency submission·version updates는 의도적으로 OFF — lock 파일이 의존성 커버 + PR 노이즈 방지)

### [x] B-5. 카카오 알림톡 — 알리고 가입 + 채널/템플릿 (지원자 알림 병행) ⭐ (2026-07-06 운영 LIVE — 실수신 확인)
- **왜**: 지원자 핵심 알림 5종(AI면접 초대 / 미응답 리마인더 / 대면 일정제안 / 대면 D-1 / 합격)을 이메일과 **병행**해 카카오톡으로도 발송 → 지원자는 이메일을 잘 안 봐서 면접 **완료율↑**. **코드는 이미 완성(게이트 상태)** — env만 채우면 켜지고, 미설정 시 이메일만 발송(영향 없음).
- **prerequisite**: A-2 사업자등록 (카카오 비즈니스 채널·발신프로필 등록에 사업자 필요).
- **할 일** (상세 절차 + 카카오 승인용 템플릿 5종 본문: [ALIMTALK.md](ALIMTALK.md)):
  1. 알리고(https://smartsms.aligo.in) 가입 → API Key 발급 (`ALIGO_API_KEY`, `ALIGO_USER_ID`)
  2. 카카오 비즈니스 채널 개설 + 발신프로필 등록 (`ALIGO_SENDER_KEY`, `ALIGO_SENDER`)
  3. 템플릿 5종 사전 승인 신청 (카카오 심사 ~1영업일) → 각 코드 (`ALIGO_TPL_*` 5개)
  4. 발급·승인 정보를 Claude 에게 전달
- **완료 후 Claude**: Vercel·로컬 env 등록, `ALIGO_TEST_MODE=1` 로 1건 발송 검증, `lib/alimtalk.ts` `buildMessage()` 텍스트를 승인본과 정합 확인.
- **✅ 완료 (2026-07-06)**: env 9개(APP_BASE_URL 포함) 등록·재배포 후에도 안 나감 → 진짜 원인 = **알리고 발신 서버 허용 IP 제한 vs Vercel 동적 egress IP**(Vercel Runtime Log `token 발급 실패: 인증되지 않는 서버 IP`). **Fixie 무료 고정 IP 프록시**로 해결: Vercel Marketplace 연동→`FIXIE_URL` 자동 주입, Fixie 고정 IP 2개를 알리고 허용 IP에 등록(둘 다 필수), `lib/alimtalk.ts` `withProxy`로 **알리고 호출만** 프록시 우회(전역 X). 커밋 `6c1d2e8` → 운영 실수신 확인. ⚠️ 이후 알리고 허용 IP = Fixie 2개뿐이라 로컬 `test-alimtalk`/`alimtalk-history` 스크립트는 로컬 IP 추가해야 다시 됨. 발송량 늘면 아래 "솔라피 이관" 참조.

---

## Phase C — DPA + 법적 마무리 (stage 운영 1~2주 중)

> 비용 0원. 법적 검토는 **실 운영 데이터 기반** 이라 가치 큼.

### [x] C-1. Google Cloud DPA 다운로드·보관 (완료 2026-07-01)
- **왜**: PIPA §26 위탁계약 서면 보관 의무. paid tier 등록 시 자동 적용되지만 사본 보관 필요.
- **할 일**:
  1. https://cloud.google.com/terms/data-processing-addendum 접속
  2. PDF 다운로드 → `legal/dpa/google-dpa-YYYYMMDD.pdf` 로 저장
  3. 폴더 `legal/dpa/` 는 `.gitignore` 처리 (민감정보 아니나 git 제외 권장)

### [x] C-2. Vercel DPA 다운로드·서명·보관 (완료 2026-07-01)
- **왜**: 위와 동일. Vercel 은 별도 서명 form 제공.
- **할 일**:
  1. https://vercel.com/legal/dpa 접속
  2. 사업자 정보 입력 후 양방 서명본 다운로드
  3. `legal/dpa/vercel-dpa-YYYYMMDD.pdf` 보관

### [x] C-3. Turso DPA 요청·서명·보관 (완료 2026-07-01)
- **왜**: 위와 동일.
- **할 일**:
  1. sales@turso.tech 또는 support@turso.tech 에 메일:
     > "Hi, I'd like to sign a Data Processing Agreement for our paid Turso account. Company: Intervia, registered in Korea. Could you send me the DPA document?"
  2. 24~48시간 내 회신 → 서명 → 양방 사본 보관
  3. `legal/dpa/turso-dpa-YYYYMMDD.pdf`

### [x] C-4. Resend DPA 다운로드·보관 (완료 2026-07-01 — **여전히 유효**)
- **왜**: 도메인 verify 후 Resend 가 메일 수탁자로 추가됨 (Phase B 에서 Claude 가 처리방침 갱신).
- **할 일**:
  1. https://resend.com/legal/dpa 또는 대시보드 → Settings → Legal → DPA
  2. 다운로드 → `legal/dpa/resend-dpa-YYYYMMDD.pdf`
- 2026-07-25 주 발송이 회사 메일 서버로 바뀌었지만 **Resend 는 점검·장애 시 대체 경로로 보존**
  (계정·키·DNS 유지). 그 경로가 실제로 쓰일 수 있으므로 이 DPA 와 처리방침의 Resend 기재는
  **유지해야 한다** — 지우면 장애 전환 시 고지 없는 국외이전이 된다.

### [x] C-4-2. 메일 발송 수탁자 — 공개(§26②) + 문서 위탁(§26①) (완료 2026-07-25)
- **배경**: 주 발송은 사업자 소유가 아닌 **(주) 엑스퍼넷의 메일 서버**를 무상 협조로 쓴다.
  지원자 이메일 주소·메일 본문이 그 서버를 지나가므로 PIPA §26 처리위탁에 해당한다.
  - ✅ **공개(§26②) 완료 (2026-07-25)**: 처리방침 §5 수탁자 표·동의문(한·영)·지원자 동의 템플릿(한·영)에
    **"(주) 엑스퍼넷 (대한민국) — 메일 발송 서버 운영"** 기재. 사용자 승인 후 정식 상호로 기재
    (익명 표기는 수탁자 특정 요건 미충족이고, 루트 SPF·메일 헤더로 이미 공개된 정보라 은닉 실익도 없음).
    영문판은 기능적 번역이라 `Expernet (Republic of Korea)` 로 표기 — 등기 영문 상호가 따로 있으면 알려줄 것.
  - ✅ **문서 위탁(§26①) 완료 (2026-07-25)**: 법정 기재사항 8개 조(목적·범위 / 목적 외 처리 금지 /
    안전조치 / 재위탁 제한 / 관리 현황 확인·협력 / 책임 / 기간·종료 / 기타 — PIPA §26①, 시행령 §28①)를
    담은 확인서를 을 측 **부서 책임자**가 이메일 회신으로 동의. 날인은 불요(전자문서법 §4①).
    - 보관: `D:\intervia\legal\개인정보_처리위탁_확인서.docx`(을 측 정보 기입본) +
      `[확인 요청] … §26) - Intervia.eml`(동의 회신). **두 파일이 한 세트** — 문서에 자필 서명이 없으므로
      "누가 언제 어떤 문서에 동의했는지"의 증거는 회신 메일의 `In-Reply-To`/`References` 체인이 담당한다.
      어느 하나만 남기면 증거가 반쪽이 되니 함께 보관할 것.
  - **책임 배분 (문서 제6조)**: 정보주체에 대한 손해배상은 **PIPA §26⑦(수탁자를 위탁자의 소속 직원으로 봄)에
    따라 위탁자(아임인)가 부담**하고, 을에게는 고의·중과실 시 구상만 가능하며 품질 보증 의무는 없다.
    무상 협조 관계라 초안의 수탁자 부담형 문구를 이 구조로 재작성했다(사용자 지적 반영 2026-07-25).
  - (선택) 더 확실히 하려면 대표 또는 개인정보보호책임자 명의 확인을 추가로 받아 같은 폴더에 덧붙인다.
- ✅ **정식 상호 확인 완료 (2026-07-25)**: `(주) 엑스퍼넷` — 고지 5곳 반영.
- **중장기 대안**: 사업자(아임인) 명의 상용 발송 서비스로 주 경로를 옮기면 이 위탁 관계 자체가
  정리된다(AWS SES 서울·가비아·다우오피스 등, 국내 리전이면 국외이전 고지도 불필요).
- 사용자 결정: 문구 수정 시 **CONSENT_VERSION·PRIVACY_VERSION 둘 다 유지**(축소·정확화라 재동의 불요).

### [ ] C-5. (선택) 변호사 1회 자문 (60~120만원) (2026-07-05 비용 사유 보류 중)
- **왜**: stage 운영 데이터 + 사업자등록 + 도메인 + DPA 4건 모두 갖춰진 상태에서 법적 검토는 가치 ↑.
- **저비용 대안**: 동의 v1.8.0 자체검토 '적법' 판정이 이미 있으므로 출시 차단 아님. ① 중기부·창업진흥원/서울창업허브 무료 법률자문 ② 대한변협 중소기업고문변호사단 ③ 로톡 단건 문서검토(15~30만원). 첫 유료 계약서 검토와 묶어 1회 자문이 비용 효율 최대.
- **추천 자문 주제**:
  - 이용약관 §5 indemnify 조항 약관규제법 적합성 (최종 확인)
  - 사전공개 페이지 (`/legal/ai-evaluation-disclosure`) §37의2 충족 여부
  - 처리방침 PIPA §30 완전성
  - 채용절차법 §4의2·§4의3 준수 흐름
- **추천처**: 개인정보·노동 분야 경험 스타트업 자문 변호사 (시간당 30~50만원, 2~3시간)
- **자문 받는 자료**: 처리방침·이용약관·동의서·SOP 출력본 + 1면 서비스 개요

---

## Phase D — 첫 고객 약속 시점 (최소 1주 전 시작)

> 비용 일회성 ~70만원 + 월 $20. 매출이 잡혀야 정당화 가능. 첫 계약 임박 시 일괄 진행.

### [x] D-1. Vercel Pro 전환 (완료 2026-06-07) ⭐
- **왜**: Vercel Hobby Plan 약관 §1.2 — "personal, non-commercial use only". B2B SaaS 운영 = 명백한 상업적 사용 = 약관 위반 → 계정 정지 가능.
- **얻은 것**:
  - 상업적 사용 허용 (가장 중요)
  - 함수 timeout 10초 → 60초 (Gemini Pro thinking + stream 안전)
  - Cron 무제한 → `vercel.json` cron 5개 네이티브 실행, **cron-job.org 외부 의존 제거 완료**
  - DDoS 보호

### [x] D-2. 통신판매업 신고 (완료 — 2026-서울강서-1773)
- **왜**: 결제 받기 시작하는 순간 의무 (전자상거래법 §12). 미신고 시 1000만원 이하 과태료.
- **할 일**:
  1. 정부24 → 통신판매업 신고
  2. 필요: 사업자등록증 + 구매안전서비스 이용확인증 (PG 가입 후 발급)
  3. 등록면허세 4만 5천원/년
- **완료 후 Claude**: 통신판매업 신고번호를 `lib/site-info.ts` 에 입력 + 처리방침 갱신

### [ ] D-3. 개인정보보호 손해배상책임보험 가입 (35~50만원/년)
- **무엇**: 해킹·유출·오남용 등 개인정보 사고로 정보주체(지원자)에게 손해배상 책임을 질 때 배상금·소송비용을 보장하는 보험.
- **의무 기준 (현행, 2026-07-05 확인)**: PIPA §39의7 + 시행령 §48의7 — **매출 10억원 이상 AND 정보주체 일평균 1만명 이상 둘 다** 충족 시 의무. 현재 Intervia 는 해당 없음 = **임의 가입**. (구 기준 "매출 5천만+1천명"은 폐지됨. 정부는 기준을 매출 1500억/100만명으로 추가 상향 추진 중)
- **그래도 첫 고객 전 가입 권장 이유**: ① 이력서 = PII 집합, 유출 1건이면 1인 기업에 치명적 (법정손해배상 300만원/인 × 인원수) ② B2B 고객사 벤더 실사에서 가입 여부를 묻는 경우 많음 ③ 연 35~50만원으로 저렴.
- **추천 보험사**: 메리츠화재 / DB손보 / 한화손해보험 (B2B SaaS 특화 상품)
- **권장 한도**: 1억원

### [ ] D-4. 결제 PG 가맹 신청 (진행 중 2026-07-05 — 토스 심사 접수, **1~2개월 소요 안내받음**)
- **왜**: 토큰 충전 결제 받기 위해 필수.
- **심사 대기 중 매출 대안**: system_admin 수동 충전 페이지 + 세금계산서 발행(계좌이체)으로 PG 없이도 첫 고객 과금 가능 — B2B 초기엔 이게 오히려 표준.
- **추천 PG**: 토스페이먼츠 또는 포트원(아임포트). 토스가 DX 우수.
- **할 일**:
  1. 가입 → 가맹점 심사 신청 (사업자등록증 + 통신판매업 신고증 첨부)
  2. 심사 1주 정도
  3. 승인 후 테스트 키 + 운영 키 발급
  4. 키 받으면 Claude 에게 전달 → Phase E 코드 개발
- **심사 보완 이력** (토스 요구 → 약관 개정):
  - 2026-08-18 — "서비스 제공기간 1년 초과 시 입점 불가" → §7 토큰 유효기간 5년 → **1년** (`TERMS_VERSION` 1.4.0).
  - 2026-09-04 — "무기한 환불이 가능한 형태는 심사 불가, 1년 이내 환불만 가능하도록 수정" → §7-2 환불 청구 기한 "언제든" → **결제일로부터 1년 이내** (`TERMS_VERSION` 1.5.0). `/org/tokens` 결제 화면·`/pricing`·`/faq` 에도 동일 문구 노출.

### [x] D-5. system_admin 2FA 등록 (완료 2026-07-01)
- **왜**: system_admin 계정 탈취 = 전 법인 데이터 접근 가능. TOTP 2FA 필수.
- **할 일**:
  1. `/account` 페이지 → "2단계 인증 (TOTP)" 섹션 → "설정 시작"
  2. Google Authenticator / Authy / 1Password 중 하나 → QR 또는 시크릿 등록
  3. 6자리 코드 입력 → 활성화

### [x] D-6. HEALTH_TOKEN 설정 (완료 2026-05-22)
- ✅ 32B 랜덤 hex 생성 → `.env.production.local` 에 `HEALTH_TOKEN` 추가
- ✅ Production build smoke test 에서 인증 분기 동작 확인 (토큰 없으면 `{ok}`, 있으면 상세)
- 📋 Phase B 배포 시 Vercel 환경변수에도 동일 입력 필요

---

## Phase E — 결제 시스템 개발 (코드 완료 2026-06-22, 라이브는 D-4 대기)

> ⚠️ 당초 "D-4 PG 가맹 승인 후 시작" 계획이었으나, **코드는 가맹 승인 전에 선제 개발·배포됨**(2026-06-22, commit 7340fb6). 현재 상태: **코드 완성 + 운영 배포 완료, 단 Vercel 에 토스 라이브키 미설정이라 dormant("준비 중" 표시)**. D-4 토스 가맹 심사(2026-07-05 접수, 1~2개월) 승인 → 라이브키 Vercel 등록(`NEXT_PUBLIC_TOSS_CLIENT_KEY`/`TOSS_SECRET_KEY`, 빌드타임) → 재배포하면 켜짐. 대기 중 매출은 D-4 대안(수동 충전 + 세금계산서)으로 커버.

### [x] E-1. payment_orders 실연동 (완료 2026-06-22)
- ✅ `payment_orders` 스텁 → 실연동. 기존 테이블 + `applyChargePayment()`(멱등) 재사용, DB 스키마 변경 없음. 토스 `orderId = IV-{payment_orders.id}`, paymentKey 는 `provider_ref` 저장.
- ✅ 토스 v2 승인 REST(`lib/toss.ts`) + `checkout`(pending 주문, 허용금액만) → 토스 결제창 → `confirm`(DB `amount_krw` 로 서버검증·토큰지급) 플로우. webhook 대신 successUrl→confirm 콜백(토스 v2 카드 단건 표준 패턴).
- ✅ 로컬 실승인(DONE) 경로 검증 완료(사용자 토스 테스트키): 100,000원 → `payment_orders` #7 paid + 토큰 1,050 지급.

### [x] E-2. 토큰 충전 UI (완료 2026-06-22)
- ✅ `/org/tokens` `ChargePanel.tsx` — 충전 패키지(`CHARGE_PACKAGES` 5만~100만원) 카드 + 토스 v2 결제창(CDN, npm 의존 없음) + success/fail 페이지. 권한 org_admin (멤버는 기존 충전요청 메일 유지).

### [x] E-3. 환불 흐름 (완료 2026-06-22)
- ✅ 결제취소(전액 환불) — **system_admin 전용 + step-up**(비번 재입력). 토스 취소 API + 지급 토큰 회수(`reverseChargePayment`, 멱등). 상태머신(`paid→cancelled` 조건부 claim)으로 이중환불 차단.
- 📋 부분환불·후보자 셀프 청약철회(약관 §7-2) API 는 범위 외(추후). 현재는 운영자 개입 전액환불.

---

## 상시 / 운영 안정화 (Phase 무관)

### [ ] (조건부) 알림톡 SOLAPI(솔라피) 이관 — **Fixie 안 될 경우에만**
- **트리거 (아래 중 하나면 착수)**: ① Fixie 무료 한도(500요청·100MB/월) 초과 ② Fixie 프록시 장애·불안정 ③ 프록시 계층/월 관리부담 자체를 없애고 싶을 때.
- **왜 솔라피**: HMAC 서명 인증이라 **발신 서버 IP 등록·프록시 자체가 불필요** → Vercel 동적 IP 문제 원천 소멸. **월 고정비 0원**(발송 건당만: 알림톡 13원~, 물량할인 최저 6.5원). 현재 Aligo+Fixie 구조의 프록시 SPOF·월 한도·모니터링 부담 제거.
- **비용(일회성)**: 카카오 채널 연결 + **템플릿 5종 재승인**(카카오 검수 며칠 리드타임) + 연동 재작성(코드는 Claude). 알림톡은 이메일 보조 채널이라 **무중단 이관** 가능(급하지 않음).
- **할 일 (트리거 시)**: 1) 솔라피(solapi.com) 가입·카카오 채널 연결 2) 템플릿 5종 등록·승인 3) Claude 에게 알려 연동 재작성(HMAC apiKey/secret env, `lib/alimtalk.ts` 교체) 4) 발송 검증 후 스위치.
- **참고**: 현재는 Aligo+Fixie 로 정상 운영 중(B-5). 이 항목은 **대기(대비책)** 이며 Fixie 가 문제없으면 착수하지 않는다.

### [x] 토큰 환불 정책 약관 명시 (Claude 완료 2026-05-16)
- `/terms` §7-2 — 전상법 §17 적합 5항 작성.

### [ ] 정기 백업 검증 (분기 1회)
- Turso 7일 PITR 자동이지만, 분기 1회 복구 테스트.

### [ ] 채용 면접 AI 가이드라인 자체점검 (분기 1회)
- 개인정보위 「인공지능(AI) 환경에서 개인정보 보호 6대 원칙」(2023) 자체점검표.
- `docs/COMPLIANCE_SOP.md` §2 분기 점검에 통합되어 있음.

### [ ] DPA 갱신 모니터링
- Google/Vercel/Turso/Resend 약관 변경 메일 구독 → 변경 시 신규 사본 수령.
  (Resend 는 대체 발송 경로로 계속 보유. 주 발송 수탁자 (주) 엑스퍼넷은 표준 DPA 가 없어 자체 확인서로
  대체 — `legal/개인정보_처리위탁_확인서.docx` + 동의 회신 `.eml`, C-4-2.)

---

## 진행 상황 요약

| Phase | 의미 | 항목 수 | 완료 |
|---|---|---|---|
| A | 무료 셋업 + 사업자등록 | 6 | 6 |
| B | 도메인 + stage 외부 테스트 | 5 | 4 (B-1·B-2·B-4·B-5 알림톡) |
| C | DPA + 법적 마무리 | 5 | 4 (C-5 변호사만 선택 보류) |
| D | 첫 고객 약속 시점 | 6 | 4 (D-1·D-2·D-5·D-6) |
| E | 결제 시스템 (Claude 처리) | 3 | 3 (코드 완료·배포, 라이브키만 대기) |
| 상시 | 운영 안정화 | 5 | 1 (+ 솔라피 이관은 Fixie 안 될 때 조건부) |
| **합계** | | **30** | **22** |

---

## 비용 누계 표

| 시점 | 추가 지출 | 누계 |
|---|---|---|
| Phase A 끝 | 0원 | 0원 |
| Phase B 끝 (도메인) | ~$10~30 | ~$10~30 (≈1.3~4만원) |
| Phase C 끝 (DPA 무료) | 0~120만원 (변호사 선택) | ~1~125만원 |
| Phase D 끝 (Pro+통판+보험+PG가맹) | $20/월 + 일회성 ~80만원 | 누계 ~100만원 + 월 ~3만원 |
| Phase E 끝 (결제 시스템) | 0 (PG 수수료는 거래 발생 시) | 누계 ~100만원 + 월 ~3만원 |

→ **첫 고객 받기 직전까지 누계 약 100만원**. B2B SaaS 운영 비용으로는 매우 낮은 수준.

---

마지막 업데이트: 2026-07-06 (B-5 알림톡 **운영 LIVE**(실수신) — 원인=알리고 허용 IP vs Vercel 동적 egress, Fixie 무료 고정 IP 프록시로 해결. 상시에 "솔라피 이관"을 **Fixie 안 될 때 조건부 대비책**으로 추가. 요약 21→22)
2026-07-06 (문서 동기화 — Phase E 결제 3건은 실제로 2026-06-22 토스 연동으로 코드 완성·운영 배포(dormant, 라이브키만 대기)라 [x] 처리, 진행 요약 18→21)
2026-07-05 (B-5 알림톡 테스트 발송 완료·D-4 토스 심사 접수(1~2개월)·C-5 비용 보류 반영. D-3 보험 의무 기준을 현행법(§39의7, 매출10억+1만명 AND 조건)으로 정정 — 현재 임의 가입)

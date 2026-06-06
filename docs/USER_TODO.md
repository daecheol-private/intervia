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

### [ ] A-2. 사업자등록 (수수료 0원, 30분) ⭐
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
  3. `admin@company-a.test` / `Test1234!` 로그인
  4. 공고 1개 생성 → 토큰 차감 확인
  5. 동의 체크박스 미체크 → 업로드 차단 확인
  6. 동의 체크 + 이력서 PDF 1개 업로드 → 평가 자동 큐 진입
  7. 평가 완료 (gemini-2.5-flash 호출, ~30초)
  8. 면접 링크 생성 → 본인 이메일 발송 (현재 `onboarding@resend.dev` 본인 메일만 가능)
  9. 시크릿창에서 토큰 링크 클릭 → 동의 4종 체크 → 채팅 5턴 (gemini-2.5-flash, thinking=128, 3-4초 응답)
  10. 면접 종료 → 평가 JSON (gemini-2.5-flash) 생성
  11. `/candidates/[id]` 에서 최종 결과 확인
- **검증**: 11 단계 모두 막힘 없이 통과 + Google Cloud Console → APIs → Gemini API 호출 통계에서 flash·pro 분리 확인

---

## Phase B — 도메인 + stage 외부 테스트 (다음주 초)

> 비용 ~$10 (도메인 1회). stage 환경 외부 인원 테스트 가능 상태.

### [ ] B-1. 도메인 구매 ⭐
- **왜**: stage 외부 테스트의 prerequisite. Resend verify, B2B 신뢰도, 세금계산서 발송 모두 도메인 필요.
- **추천 등록처**:
  - **Cloudflare Registrar** (마진 0%, ~$10/년) — `.com` 권장
  - 가비아 `intervia.kr` ~22,000원/년
  - 후이즈 `intervia.co.kr` ~30,000원/년 (사업자등록 필요)
- **할 일**:
  1. 등록처 가입·로그인
  2. `intervia.com` (또는 선택한 도메인) 검색·결제
  3. Claude 에게 알리기: **"도메인 샀어, intervia.com 이야"**
- **완료 후 Claude 가 자동 처리**:
  - Vercel 도메인 연결 가이드 (DNS A/CNAME)
  - Resend Dashboard 도메인 verify 절차 안내 (DKIM/SPF/DMARC TXT)
  - `SMTP_FROM` 환경변수 갱신 권고
  - `lib/site-info.ts` `baseUrl` 갱신
  - 처리방침 §5 PROCESSORS 표에 Resend Inc. (미국) 추가
  - `CONSENT_VERSION` bump → 기존 후보자 재동의 (현 로컬 DB 비어 있어 영향 없음)

### [ ] B-2. data.go.kr 사업자등록정보 API 키 발급 (10분, 무료)
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

### [ ] B-4. GitHub Dependabot 활성화 (5분, 무료)
- **왜**: pdf-parse 등 취약점 자동 알림.
- **할 일**: GitHub 리포 → Settings → Code security and analysis → Dependabot alerts + security updates 활성화.

---

## Phase C — DPA + 법적 마무리 (stage 운영 1~2주 중)

> 비용 0원. 법적 검토는 **실 운영 데이터 기반** 이라 가치 큼.

### [ ] C-1. Google Cloud DPA 다운로드·보관 (5분, 무료)
- **왜**: PIPA §26 위탁계약 서면 보관 의무. paid tier 등록 시 자동 적용되지만 사본 보관 필요.
- **할 일**:
  1. https://cloud.google.com/terms/data-processing-addendum 접속
  2. PDF 다운로드 → `legal/dpa/google-dpa-YYYYMMDD.pdf` 로 저장
  3. 폴더 `legal/dpa/` 는 `.gitignore` 처리 (민감정보 아니나 git 제외 권장)

### [ ] C-2. Vercel DPA 다운로드·서명·보관 (15분, 무료)
- **왜**: 위와 동일. Vercel 은 별도 서명 form 제공.
- **할 일**:
  1. https://vercel.com/legal/dpa 접속
  2. 사업자 정보 입력 후 양방 서명본 다운로드
  3. `legal/dpa/vercel-dpa-YYYYMMDD.pdf` 보관

### [ ] C-3. Turso DPA 요청·서명·보관 (1일 — 메일 응답 대기)
- **왜**: 위와 동일.
- **할 일**:
  1. sales@turso.tech 또는 support@turso.tech 에 메일:
     > "Hi, I'd like to sign a Data Processing Agreement for our paid Turso account. Company: Intervia, registered in Korea. Could you send me the DPA document?"
  2. 24~48시간 내 회신 → 서명 → 양방 사본 보관
  3. `legal/dpa/turso-dpa-YYYYMMDD.pdf`

### [ ] C-4. Resend DPA 다운로드·보관 (5분, 무료)
- **왜**: 도메인 verify 후 Resend 가 메일 수탁자로 추가됨 (Phase B 에서 Claude 가 처리방침 갱신).
- **할 일**:
  1. https://resend.com/legal/dpa 또는 대시보드 → Settings → Legal → DPA
  2. 다운로드 → `legal/dpa/resend-dpa-YYYYMMDD.pdf`

### [ ] C-5. (선택) 변호사 1회 자문 (60~120만원)
- **왜**: stage 운영 데이터 + 사업자등록 + 도메인 + DPA 4건 모두 갖춰진 상태에서 법적 검토는 가치 ↑.
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

### [ ] D-2. 통신판매업 신고 (45,000원, 1일)
- **왜**: 결제 받기 시작하는 순간 의무 (전자상거래법 §12). 미신고 시 1000만원 이하 과태료.
- **할 일**:
  1. 정부24 → 통신판매업 신고
  2. 필요: 사업자등록증 + 구매안전서비스 이용확인증 (PG 가입 후 발급)
  3. 등록면허세 4만 5천원/년
- **완료 후 Claude**: 통신판매업 신고번호를 `lib/site-info.ts` 에 입력 + 처리방침 갱신

### [ ] D-3. 개인정보보호 손해배상책임보험 가입 (35~50만원/년)
- **왜**: PIPA §39의9 — 매출 5천만원 + 정보주체 1000명 이상 시 의무. 그 이하면 권장. 첫 사고 1건 막아주면 본전.
- **추천 보험사**: 메리츠화재 / DB손보 / 한화손해보험 (B2B SaaS 특화 상품)
- **권장 한도**: 1억원

### [ ] D-4. 결제 PG 가맹 신청 (심사 1주, 가맹비 무료)
- **왜**: 토큰 충전 결제 받기 위해 필수.
- **추천 PG**: 토스페이먼츠 또는 포트원(아임포트). 토스가 DX 우수.
- **할 일**:
  1. 가입 → 가맹점 심사 신청 (사업자등록증 + 통신판매업 신고증 첨부)
  2. 심사 1주 정도
  3. 승인 후 테스트 키 + 운영 키 발급
  4. 키 받으면 Claude 에게 전달 → Phase E 코드 개발

### [ ] D-5. system_admin 2FA 등록 (10분, 무료)
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

## Phase E — 결제 시스템 개발 (PG 가맹 후, Claude 처리)

> D-4 PG 가맹 승인 + 키 발급 완료 후 시작. 운영자는 코드 검수·테스트만.

### [ ] E-1. payment_orders 실연동 (Claude 처리)
- 현재 `payment_orders` 테이블은 스텁. PG SDK 연동 + webhook 처리 + 토큰 자동 충전.

### [ ] E-2. 토큰 충전 UI (Claude 처리)
- `/org/tokens` 페이지에 "토큰 구매" 버튼 + 결제 모달.

### [ ] E-3. 환불 흐름 (Claude 처리)
- 약관 §7-2 청약철회 7일 정책에 맞춘 환불 API.

---

## 상시 / 운영 안정화 (Phase 무관)

### [x] 토큰 환불 정책 약관 명시 (Claude 완료 2026-05-16)
- `/terms` §7-2 — 전상법 §17 적합 5항 작성.

### [ ] 정기 백업 검증 (분기 1회)
- Turso 7일 PITR 자동이지만, 분기 1회 복구 테스트.

### [ ] 채용 면접 AI 가이드라인 자체점검 (분기 1회)
- 개인정보위 「인공지능(AI) 환경에서 개인정보 보호 6대 원칙」(2023) 자체점검표.
- `docs/COMPLIANCE_SOP.md` §2 분기 점검에 통합되어 있음.

### [ ] DPA 갱신 모니터링
- Google/Vercel/Turso/Resend 약관 변경 메일 구독 → 변경 시 신규 사본 수령.

---

## 진행 상황 요약

| Phase | 의미 | 항목 수 | 완료 |
|---|---|---|---|
| A | 무료 셋업 + 사업자등록 | 6 | 4 (△ A-3 Phase D 연기) |
| B | 도메인 + stage 외부 테스트 | 4 | 0 |
| C | DPA + 법적 마무리 | 5 | 0 |
| D | 첫 고객 약속 시점 | 6 | 2 (D-1 Pro 전환 완료) |
| E | 결제 시스템 (Claude 처리) | 3 | 0 |
| 상시 | 운영 안정화 | 4 | 1 |
| **합계** | | **28** | **7** |

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

마지막 업데이트: 2026-05-22 (전체 Phase 재구성 — 사용자 합의 로드맵 반영)

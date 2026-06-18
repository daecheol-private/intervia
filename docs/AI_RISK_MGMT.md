# AI 기본법 §34 고영향 AI 책무 이행 문서 (AI Risk Management)

> 「인공지능 발전과 신뢰 기반 조성 등에 관한 기본법」(AI 기본법, 2026-01-22 시행) §34 가 고영향 인공지능 사업자에게 요구하는 책무의 **이행 현황 문서**. §34 가 요구하는 "조치 이행 결과의 문서 작성·보관" 의무 자체를 본 문서(+ git 이력)로 이행한다.
>
> 운영 절차(주기·트리거별 할 일)는 [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md), 시스템 동작은 [ARCHITECTURE.md](ARCHITECTURE.md) 참고. **본 문서는 사실만 기재** — 코드에 없는 조치는 "미적용/개선 항목"으로 명시.

## §34 책무 ↔ 본 문서 매핑

| §34 책무 | 섹션 |
|---|---|
| 위험관리방안 수립·운영 | §2 |
| 설명 가능성 확보 (최종결과·주요 기준·학습데이터 개요 설명) | §3 |
| 이용자 보호 | §4 |
| 사람의 관리·감독 | §5 |
| 안전성·신뢰성 확보 | §6 |
| 조치 이행 결과의 문서 작성·보관 | 본 문서 + §7 |

---

## 1. 시스템 개요 및 고영향 AI 해당성 판단

### 1-1. 시스템 개요

| 항목 | 내용 |
|---|---|
| 기능 | ① 서류(이력서) LLM 평가 — 6축 점수 + 의견, ② 채팅 기반 AI 면접 진행, ③ 면접 응답 LLM 평가 |
| 모델 | Google Gemini 2.5 Flash (전 task), Vertex AI 서울 리전(asia-northeast3) — `lib/gemini.ts` `MODELS` |
| 출력 성격 | **추천(참고 자료)** — 합·불 자동 확정 없음. 최종 결정은 채용 담당자(§5) |
| 입력 | 마스킹 처리된 이력서·면접 발화 텍스트만 (원본 텍스트 DB 미보관, §2-1) |

### 1-2. 고영향 AI 해당성

| 판단 요소 | 판단 | 근거 |
|---|---|---|
| 법정 고영향 영역 해당 | **해당** | AI 기본법 §2 의 고영향 AI 정의 중 "채용 등 개인의 권리·의무 관계에 중대한 영향을 미치는 판단·평가" 영역. 본 서비스는 채용 후보자 평가가 핵심 기능 |
| Intervia 의 지위 | **인공지능사업자** (개발·공급) | 외부 기반 모델(Gemini) 위에 평가 시스템을 직접 설계·개발해 SaaS 로 공급 |
| 채용기업의 지위 | **이용사업자** | 본 서비스를 도입해 자사 채용에 활용. AI 평가 적용 고지·동의 취득 책임은 이용약관 §5 로 채용기업에 배분 (분기 표본 점검: [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) §2-1) |

> 하위 시행령·고시의 고영향 AI 판단 기준·책무 세부 기준이 확정되면 본 판단을 재검토한다 — 모니터링 절차는 [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) §2-3.

---

## 2. 위험관리방안 (수립·운영)

식별된 주요 위험: ① 개인정보·차별 금지 항목의 평가 유입, ② 간접 차별, ③ 프롬프트 인젝션을 통한 평가 조작.

| 조치 | 내용 | 구현 근거 |
|---|---|---|
| PII 마스킹 파이프라인 | 업로드 시점에 정규식(주민번호·전화·이메일·DOB·주소 등) + 라벨 + 사전(국내외 대학 ~350·행정구역 ~200) 마스킹. LLM·UI 모두 마스킹본만 사용, 원본 텍스트는 DB 미보관 | `lib/mask.ts`, `lib/pii-extract.ts`, [ARCHITECTURE.md](ARCHITECTURE.md) §11 |
| 면접 발화 마스킹 | 면접 중 후보자 자가 발화 PII 도 LLM 전달 전 동일 마스킹, 트랜스크립트도 마스킹본만 보관 | `app/api/interview/[token]/chat/route.ts` |
| 차별 금지 항목 평가 배제 | 채용절차법 §4의3 항목(성별·나이·출신지·가족·종교·신체 등 + 출신 학교명)은 마스킹 필수 + 서류·면접 프롬프트에 "인용·언급·질문 금지" 명시 지시. HR 평가 가이드에 차별 항목이 섞여 들어와도 무시하도록 지시 | `lib/prompts.ts` (평가 절대 제외 / 절대 금지 / `evaluationFocusSection`), [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) 마스킹 정책 |
| 차별 키워드 입력 필터 | HR 평가 가이드(evaluationFocus)의 차별 항목(성별·연령·결혼·출신지·종교·외모·장애 등) 포함 라인을 **저장 전 제거** — 프롬프트 지시 우회 위험을 입력 단계에서 차단 | `lib/job-bias-filter.ts` `stripBiasedLines`, 호출: `app/api/jobs/route.ts` (생성)·`app/api/jobs/[id]/route.ts` (수정) |
| JD 생성 단계 차별 배제 | 요건 체크리스트 생성·공고 URL 가져오기 시 학력·전공·나이·성별·출신지역 항목을 추출하지 않도록 지시 | `lib/job-checklist.ts`, `lib/job-url-import.ts` |
| 점수분포 분기 모니터링 | `/admin/metrics` 90일 점수 분포로 간접 차별 신호(특정 법인 저점 편중, 단계별 극단 합격률) 점검, 분기 기록 보존(인권위 진정 대응 증거) | [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) §2-2 |
| 프롬프트 인젝션 방어 | 후보자 발화 sanitize(시스템 토큰 제거·인젝션 패턴 플래그·로그), 이력서 본문 sanitize(숨김 지시문·점수 강요 문구 라인 차단), 모델 응답의 시스템 프롬프트 누설 검증 + 프롬프트 차원의 인젝션 무시 지시 | `lib/prompt-safety.ts` (`sanitizeUserInput` / `sanitizeResumeText` / `detectSystemPromptLeak`), `lib/prompts.ts` |
| 침해사고 대응 | 72시간 룰(보호위 신고 + 정보주체 통지) 절차 수립 | [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) §3-1 |
| 법령 모니터링 | 보호위·채용절차법 + AI 기본법 하위 시행령·고시 분기 모니터링 | [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) §2-3 |

**한계 (사실 그대로 기재)**:
- 마스킹은 사전·정규식 기반 자동 처리 — 미등록 학교명·회사명·변형 표기는 잔존 가능 (100% 보장 표현 금지 정책: [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) 마스킹 정책).
- 차별 키워드 입력 필터는 단순 패턴 매칭 — false positive(예: "연령대별 사용자 경험" 라인 제거) 가능성을 감수하고 보수적으로 차단.

---

## 3. 설명 가능성 (최종결과·주요 기준 설명)

| 조치 | 내용 | 구현 근거 |
|---|---|---|
| 평가 기준 사전공개 | 평가 차원·가중치(**서류 6축**: 기술 적합도 20% / 경험 깊이 20% / 직무 매칭도 25% / 성과 임팩트 15% / 재직 안정성 10% / 성장·태도 10%, **AI 면접 4차원**: 기술역량 35% / 실무경험 30% / 협업·커뮤니케이션 15% / 직무적합성 20%), 등급 컷오프(85+ 강력추천 / 70+ 추천 / 55+ 보류 / 미만 비추천), 사용 모델·처리 위치, 마스킹 정책을 **비로그인 공개 페이지**로 상시 게시 | `app/legal/ai-evaluation-disclosure/page.tsx` (`/legal/ai-evaluation-disclosure`) |
| 평가 결과의 근거 구조화 | 평가 JSON 이 6축 breakdown 각각에 `score` + `reason`(한 줄 근거) + `confidence`(high/medium/low — 근거 충분성) 를 포함. 요건별 충족 매트릭스(requirement_coverage: status/evidence)로 JD 항목 단위 근거 제시. 추측·일반론 출력 금지, 본문 인용 필수 | `lib/prompts.ts` `buildScreeningPrompt` 출력 형식, `lib/screening.ts` `SCREENING_SCHEMA` |
| 점수 산식 공개·검증 가능 | 종합 점수 = 6축 가중평균(가중치 프롬프트에 명시), 시스템이 산식대로 재계산(§6) — 산출 과정 재현 가능 | `lib/screening.ts` `recomputeScore`, `/legal/ai-evaluation-disclosure` §2 |
| 학습용 데이터 개요 | 자체 학습 없음(파인튜닝 X). 기반 모델은 Google Gemini — 결제 등급으로 **입력이 모델 학습에 활용되지 않음**을 사전공개 페이지에 명시. 학습데이터 상세는 Google 공개 자료에 의존 | `/legal/ai-evaluation-disclosure` §3 |
| 감사 로그 | 평가·조회·결정·메일 발송 등 민감 액션을 `audit_logs` 에 기록, `/admin/audit` 에서 조회 — 사후 설명·분쟁 대응의 증거 체인 | `lib/audit.ts` `logAudit`, [GOTCHAS.md](GOTCHAS.md) §0-0-1-2 |

---

## 4. 이용자 보호

### 4-1. 지원자 (정보주체)

| 권리·보호 | 내용 | 구현 근거 |
|---|---|---|
| 동의 | 면접 시작 전 동의 화면(버전 관리 `CONSENT_VERSION`, `consent_logs` 영구 보존) + 이력서 업로드 시 채용기업의 지원자 동의 확인 게이트(미확인 시 400 `applicant_consent_required`) | `lib/consent.ts`, `app/api/interview/[token]/consent/route.ts`, [GOTCHAS.md](GOTCHAS.md) §0-2-2 |
| 열람·삭제 | 후보자 셀프 채널 — 토큰 + 본인 이메일 매칭 후 보유 데이터 요약 열람(GET) / 즉시 폐기(DELETE). 이메일 미등록이면 fail-safe 거부 | `app/api/interview/[token]/me/route.ts` (`/interview/[token]/me`) |
| 이의제기 | 면접 종료 화면·메일 채널로 접수 → `appeal_logs` + DPO 알림, **7영업일 내 답변** (PIPA §37의2) | `app/api/interview/[token]/appeal/route.ts`, [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) §3-2 |
| 거부권 | AI 평가 자체 거부 가능 — 거부 시 채용기업의 일반 채용 절차로 진행 | `/legal/ai-evaluation-disclosure` §5 |
| 데이터 최소 보유 | 이력서 원본·마스킹본은 합·불 결정 시 즉시 폐기(+평가 후 30일 자동 폐기 cron), 평가 결과는 공고 종결 +14일 | `lib/candidate-stage.ts` `purgeOnDecision`, [ARCHITECTURE.md](ARCHITECTURE.md) §11 [5] |

### 4-2. 채용기업 (이용사업자)

| 보호 | 내용 | 구현 근거 |
|---|---|---|
| 평가 근거 표시 | 후보자 상세에 6축 점수·근거·confidence·요건 매트릭스를 그대로 표시 — 점수만 보고 결정하지 않도록 근거 노출 | `app/candidates/[id]/page.tsx` |
| 재평가 | 서류 재평가(`POST /api/candidates/[id]/screen` — 평가된 후보 재평가 허용)·AI 면접 재평가 가능 | [ARCHITECTURE.md](ARCHITECTURE.md) §11 [3] |
| 마스킹 검수 | 업로드 직후 마스킹 미리보기 + 원본 토글(경고 표시)로 평가 전 입력 품질 검수 가능 | [ARCHITECTURE.md](ARCHITECTURE.md) §11 [2] |
| 과금 보호 | 평가 성공 시에만 후차감, transient 실패 자동 재시도 — 실패 건 과금 없음 | [ARCHITECTURE.md](ARCHITECTURE.md) §9·§11 [4] |

---

## 5. 사람의 관리·감독

| 조치 | 내용 | 구현 근거 |
|---|---|---|
| AI 는 추천만 | 평가 출력은 점수 + `recommendation`(강력추천/추천/보류/비추천) — 어떤 경로로도 합·불 상태를 자동 확정하지 않음 | `lib/prompts.ts`, `/legal/ai-evaluation-disclosure` §4 |
| 평가 시작도 사람 게이트 | 업로드만으로 자동 평가하지 않음 — 사용자가 마스킹 결과 확인 후 "검토 진행"으로 명시 시작 | [GOTCHAS.md](GOTCHAS.md) §0-2, [ARCHITECTURE.md](ARCHITECTURE.md) §11 |
| 결정자·사유 기록 | 합·불·취소 확정 시 `decided_at` / `decided_by_user_id` / `decision_note` 기록. **불합격 확정은 사유 코드 선택 필수**(미선택 시 400 `reason_required`) — 실질적 인적 검토 보장 | `app/api/candidates/[id]/stage/route.ts`, `lib/schema.ts` |
| 일괄 자동 결정 방지 | 합·불 확정의 일괄 API 없음 — 일괄 처리는 **평가**(bulk-screen)까지만, 결정은 후보자별 1건씩 + 사유 선택 | `app/api/candidates/bulk-screen/route.ts` (평가 전용), stage 라우트 단건 설계 |
| 결정 이력 감사 | 단계·결정 변경은 from/to·사유와 함께 감사 로그 기록, 영구 보존 | `app/api/candidates/[id]/stage/route.ts` `logAudit` |
| 운영자 감독 | system_admin 의 cross-org 접근 주간 리뷰, 평가 실패율 모니터링 | [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) §1-1·§1-2 |

---

## 6. 안전성·신뢰성

| 조치 | 내용 | 구현 근거 |
|---|---|---|
| 모델·엔드포인트 고정 | task별 모델을 `MODELS` 상수로 고정(전 task gemini-2.5-flash, Vertex AI 서울). 호출부의 모델 직접 지정·엔드포인트 우회 금지 | `lib/gemini.ts`, CLAUDE.md LLM 모델 정책 |
| 평가 일관성 | screening `temperature: 0` + `screening_cache`(prompt_hash 캐싱) — 같은 입력은 같은 결과 재사용. 내용 해시 2차 dedup 으로 중복 이력서 독립 재평가 차단 | `lib/screening.ts`, [GOTCHAS.md](GOTCHAS.md) §0-5 |
| 점수 재계산 검증 | LLM 이 출력한 종합 점수를 신뢰하지 않고 시스템이 6축 가중평균을 직접 재계산(`recomputeScore`) — 산술 오류·점수 조작 무력화 | `lib/screening.ts` |
| 출력 구조 보장 | `responseSchema` 로 유효 JSON 강제(깨진 응답 → 평가 실패로 처리, 잘못된 값 유입 차단) | `lib/screening.ts` `SCREENING_SCHEMA` |
| 장애 안전 처리 | 큐 기반 처리 + transient 재시도(backoff 3회) + stuck 복구 cron + 성공 시에만 과금 — 부분 실패가 잘못된 평가·과금으로 남지 않음 | `lib/screening-queue.ts`, [ARCHITECTURE.md](ARCHITECTURE.md) §11 [4] |
| 부정행위 신호의 중립 표시 | 면접 행태 신호(붙여넣기·이탈 등)는 채용 담당자 **참고 자료로만** 제공, 단독 합·불 결정 금지, 정당한 사용 가능성을 전제로 중립 표시 — 사전공개로 지원자에게 고지 | `/legal/ai-evaluation-disclosure` §1, `lib/prompts.ts` (llm_assist 신호) |
| 응답 누설 검증 | 모델 응답의 시스템 프롬프트 누설 패턴 검증 | `lib/prompt-safety.ts` `detectSystemPromptLeak` |

---

## 7. 문서 이력·검토 주기

- **검토 주기**: 분기 1회 — [COMPLIANCE_SOP.md](COMPLIANCE_SOP.md) §2 분기 점검과 함께 수행. AI 기본법 하위 시행령·고시 제·개정 확인 시(SOP §2-3) 수시 갱신.
- **담당**: 개인정보 보호책임자(대표 겸임).
- **보관**: 본 문서는 git 이력으로 버전 보관 (§34 문서 작성·보관 의무 이행).

| 버전 | 일자 | 변경 |
|---|---|---|
| 1.0 | 2026-06-10 | 최초 작성 — §34 5개 책무 체계로 기존 구현·SOP 재편 |
| 1.1 | 2026-06-18 | §3 평가 가중치 서술 정정 — 옛 4축 비율을 실제 채점 코드(서류 6축·AI 면접 4차원) 가중치로 동기화. 공개 사전공개 페이지(`/legal/ai-evaluation-disclosure`) §2 도 서류/면접 2개 표로 분리해 일치시킴 |

# 테스트 계획서

서비스화 (멀티테넌트 + 역할 + 토큰) 변경 후 검증할 시나리오 모음.

**자동 테스트 진행 방식**: 사용자가 "테스트해줘" / "TC-XX 돌려줘" 라고 요청하면 이 문서의 시나리오 ID를 골라 순서대로 실행한다. 실행 = (1) 가능하면 API 직접 호출 (curl/PowerShell `Invoke-RestMethod`) 으로 자동화, (2) UI 만 가능한 부분은 Playwright 또는 수동 체크포인트로 보고. 결과는 `pass / fail / blocked` 와 근거(응답 JSON, DB row, 스크린샷 경로)와 함께 표로 보고.

## 테스트 환경

- 로컬: `npm run dev` (포트 3003), `data.db` (SQLite)
- 매 테스트 셋 시작 전: **DB 시드 리셋** — `data.db` 삭제 후 `npm run db:push` → 시드 스크립트 (`scripts/seed-test.ts` — PR-1 에서 추가)
- 시드 내용:
  - 법인 `test-company-a` (도메인 `company-a.test`), `test-company-b` (도메인 `company-b.test`)
  - 사용자: `sysadmin@test-company-a` (system_admin), `admin@company-a.test` (org_admin/test-company-a), `member@company-a.test` (member/test-company-a), `admin@company-b.test` (org_admin/test-company-b)
  - 비번 모두 `Test1234!`
  - 각 법인 토큰 1000
  - test-company-a 공고 1개(공개), test-company-a 공고 1개(PIN=1234), test-company-b 공고 1개

## 보고 포맷 (자동 테스트 응답 시 따를 것)

```
| ID    | 결과 | 근거                              | 비고          |
|-------|------|-----------------------------------|---------------|
| TC-01 | pass | POST /api/auth/check-email → 200  |               |
| TC-07 | fail | candidates row org_id 누락        | PR-2 스코핑   |
```

실패 시 즉시 중단할지 계속할지: **계속 진행** (전체 회귀 파악 우선).

---

## 1. 회원가입 / 법인 매칭 (TC-01 ~ TC-09)

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| TC-01 | `POST /api/auth/check-email` — 미사용 이메일 + 도메인 기존 법인 일치 | `{available:true, matchedOrg:{id, name}, suggestion:"join"}` |
| TC-02 | `check-email` — 공용 도메인(`x@gmail.com`) | `{available:true, suggestion:"create_or_search", matchedOrg:null}` |
| TC-03 | `check-email` — 이미 가입된 이메일 | `{available:false, reason:"already_registered"}` |
| TC-04 | 신규 법인 등록 + 첫 가입 | 사용자 role=`org_admin`, 새 organization row 생성, wallet=0(또는 초기지급) |
| TC-05 | 기존 법인 합류 요청 (도메인 일치) | `org_join_requests` row 생성, status=`pending` |
| TC-06 | org_admin 이 합류 승인 | 사용자 role=`member`, request status=`approved`, 사용자 org_id 매핑 |
| TC-07 | org_admin 이 거절 | request status=`rejected`, 사용자는 로그인 불가 |
| TC-08 | 사업자번호로 법인 검색 | 매칭되는 organization 목록 반환 |
| TC-09 | 공용 도메인인데 자동매칭 시도 → 차단 | API 가 자동매칭 응답 안 함 |

## 2. 인증 / 권한 / 테넌트 격리 (TC-10 ~ TC-19)

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| TC-10 | `member@company-a.test` 로그인 후 `/` 공고 목록 | test-company-a 공고만 보임, test-company-b 공고 보이지 않음 |
| TC-11 | 위 사용자가 `GET /api/jobs/{test-company-b공고id}` | 404 (또는 403) |
| TC-12 | 위 사용자가 test-company-b 후보자 ID 직접 접근 `/candidates/{id}` | 404 |
| TC-13 | system_admin 로그인 후 `/` | 전체 법인 공고 보임, 법인 필터 드롭다운 노출 |
| TC-14 | system_admin 이 test-company-b 공고 PIN 우회 접근 | 정상 열람 |
| TC-15 | member 가 같은 법인 PIN 공고 상세 (PIN 미입력) | PIN 입력 모달, 무입력 시 차단 |
| TC-16 | member 가 같은 법인 PIN 공고 상세 (PIN 입력) | 정상 열람 |
| TC-17 | member 가 `/org/members` 접근 | 403 (org_admin 전용) |
| TC-18 | member 가 `/admin/pricing` 접근 | 403 (system_admin 전용) |
| TC-19 | 로그아웃 상태에서 `/` 접근 | `/login` 으로 리다이렉트 |

## 3. 법인 관리 (TC-20 ~ TC-26)

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| TC-20 | org_admin 이 자기 법인 멤버 목록 조회 | test-company-a 멤버 N명 |
| TC-21 | org_admin 이 다른 법인 멤버 조회 시도 | 403 |
| TC-22 | org_admin 이 member → org_admin 권한 부여 | role 변경, ledger 영향 없음 |
| TC-23 | org_admin 이 자기 자신 권한 박탈 | 마지막 org_admin 이면 차단, 아니면 허용 |
| TC-24 | org_admin 이 멤버 추방 | 사용자 비활성/탈퇴 처리 (정책 ❓ — 우선 soft delete) |
| TC-25 | 합류 요청 승인 메일 발송 | nodemailer 호출 mock 또는 SMTP 로그 확인 |
| TC-26 | system_admin 이 법인 전체 목록 조회 | 모든 organization row |

## 4. 토큰 시스템 (TC-30 ~ TC-44)

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| TC-30 | 공고 등록 → 잔액 차감 | `token_ledger` insert (reason=`job_post`, delta=-단가), wallet 잔액 감소 |
| TC-31 | 공고 등록 직후 삭제 (5분 내) | 자동 환불 ledger (reason=`refund`, delta=+단가) |
| TC-32 | 공고 등록 5분 후 삭제 | 환불 없음 |
| TC-33 | 이력서 업로드 성공 | ledger -`resume_upload` 단가 |
| TC-34 | 이력서 텍스트추출 실패 | ledger 자동 환불 |
| TC-35 | 이력서 LLM 평가 실패(`status=failed`) | ledger 자동 환불 |
| TC-36 | 면접 링크 발급 | ledger -`interview` 단가 |
| TC-37 | 면접 미시작 상태에서 만료 | ledger 자동 환불 |
| TC-38 | 면접 1턴 이상 진행 후 만료 | 환불 없음 |
| TC-39 | 잔액 0 인 상태에서 공고 등록 | 마이너스로 진행 (정책: 후불), UI 경고 배너 표시 |
| TC-40 | 잔액 마이너스에서 더 사용 | 계속 마이너스 누적, ledger 정상 기록 |
| TC-41 | system_admin 수동 충전 | ledger reason=`admin_adjust`, delta=+N, `balance_after` 정확 |
| TC-42 | system_admin 이 단가 변경 (`job_post` 10→20) | `token_pricing` 업데이트, 이후 등록부터 새 단가 적용 (소급 X) |
| TC-43 | org_admin 이 단가 변경 시도 | 403 |
| TC-44 | ledger `balance_after` 누적 일관성 | 같은 org 의 ledger 순차 합계 = 현재 wallet balance |

## 5. 기존 기능 회귀 (TC-50 ~ TC-65)

핵심: 멀티테넌트 도입 후에도 프로토타입 기능이 그대로 동작.

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| TC-50 | 공고 CRUD (생성/수정/삭제) | 정상, org_id 자동 주입 |
| TC-51 | 공고 PIN 설정/해제 | password_hash 정상 |
| TC-52 | PDF 이력서 업로드 | candidates row 생성, resume_text 추출됨, status=`screening` |
| TC-53 | 4초 polling 후 서류평가 완료 | status=`screened`, screening_score 채워짐, personal_info 추출 |
| TC-54 | 중복 이력서 재업로드 (같은 hash) | 409 |
| TC-55 | 면접 링크 발급 + 이메일 발송 | interview_sessions row, 메일 발송 성공 로그 |
| TC-56 | `/interview/[token]` 접근 (외부, 비로그인) | 세션 로드, 첫 턴 정상 |
| TC-57 | 면접 채팅 스트리밍 | SSE 응답 정상, messages 누적 저장 |
| TC-58 | AI 가 `[INTERVIEW_END]` 출력 시 자동 종료 | `/complete` 호출됨, status=`completed`, evaluation 채워짐 |
| TC-59 | "면접 종료" 버튼 수동 finalize | 동일 |
| TC-60 | 종합 점수 계산 (서류 0.4 + 면접 0.6) | candidate 상세에 정확히 표시 |
| TC-61 | 후보자 삭제 → 파일 정리 | uploads 디렉토리에 파일 없음 |
| TC-62 | 공고 삭제 → cascade | candidates / interview_sessions 모두 삭제 |
| TC-63 | 만료 토큰 접근 | "만료" 메시지 |
| TC-64 | 1회 완료 토큰 재접근 | "이미 완료" 메시지 |
| TC-65 | `npx tsc --noEmit` 통과 | 에러 0 |

## 6. 보안 / 엣지 (TC-70 ~ TC-78)

| ID | 시나리오 | 예상 결과 |
|---|---|---|
| TC-70 | 다른 법인 사용자 ID 로 세션 위조 시도 (쿠키 조작) | 검증 실패 / 로그아웃 처리 |
| TC-71 | API body 에 `org_id` 강제 주입 시도 | 무시되고 서버 측 currentUser.orgId 사용 |
| TC-72 | 잠금 PIN 무차별 입력 | rate limit 또는 N회 후 차단 (정책 ❓) |
| TC-73 | 면접 토큰 추측 (`tk_` + 무작위) | UUID 32바이트 강도, 충돌/추측 사실상 불가 — 1000회 시도 모두 404 |
| TC-74 | 시스템관리자 강제 권한 상승 시도 (member 가 PATCH role) | 403 |
| TC-75 | 프롬프트 인젝션 (이력서에 "당신은 ~ 이다") | 면접관 페르소나 유지 (lib/prompts.ts 인젝션 방어 확인) |
| TC-76 | 거대한 PDF (>10MB) 업로드 | 적절한 에러 또는 정상 처리 (제한값 정해서 명시) |
| TC-77 | 스캔 PDF (텍스트 30자 미만) | 업로드 거부, 토큰 차감 안 됨 |
| TC-78 | 동시 업로드 race (같은 hash 2건 동시) | 1건만 성공, 다른 1건 409 |

---

## 자동 실행 우선순위

사용자가 "전체 테스트" 요청 시 다음 순서:
1. **TC-65** 먼저 (타입체크 통과 안 하면 의미 없음)
2. TC-10 ~ TC-19 (테넌트 격리 — 가장 위험)
3. TC-30 ~ TC-44 (토큰 정합성)
4. TC-50 ~ TC-65 (회귀)
5. 나머지

"빠른 테스트" 요청 시: TC-65, TC-10, TC-11, TC-30, TC-50, TC-52, TC-58 (스모크 7개).

## 자동화 가능 여부

| 그룹 | 자동화 | 도구 |
|---|---|---|
| API 응답 검증 | ✅ | PowerShell `Invoke-RestMethod` + JSON 어서션 |
| DB row 검증 | ✅ | `lib/db.ts` 직접 쿼리 스크립트 (`scripts/test-assert.ts`) |
| UI 흐름 | △ | Playwright 권장. 미설치면 수동 |
| 스트리밍 SSE | △ | curl 로 chunk 수신, `[INTERVIEW_END]` 포함 여부만 |
| 이메일 발송 | △ | `NODE_ENV=test` 때 mailer mock — 발송 인자만 검증 |
| LLM 응답 품질 | ❌ | 비결정적. status 변화만 확인, 점수 자체 검증 X |

## 미해결 / 보충 필요 항목

- 시드 스크립트(`scripts/seed-test.ts`) — PR-1 에서 만든다
- DB reset / 어서션 헬퍼(`scripts/test-assert.ts`) — PR-1 에서 만든다
- mailer mock — PR-5 와 함께
- Playwright 도입 여부 결정 (수동만 해도 충분하면 패스)
- PIN 무차별 입력 차단 정책 (TC-72)
- 거대 PDF 제한값 (TC-76)

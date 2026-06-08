# 전체 테스트 재개 가이드 (세션이 끊겨도 여기서 이어서)

> 마지막 작업: 2026-06-08. **섹션 0~11 완료, 섹션 12부터 이어서 진행.**
> 결과 상세: [TEST_CASES.md](TEST_CASES.md) (케이스별 체크박스 + 근거) · 버그: [TEST_BUGS.md](TEST_BUGS.md)

---

## 0. 지금 어디까지 했나 (재개 지점)

| 구간 | 상태 |
|---|---|
| **섹션 0~11** | ✅ 검증 완료 (TEST_CASES.md 에 기록) |
| **섹션 12 (AI 면접)** | ⬅️ **여기부터 이어서** |
| 섹션 13~23 | ⬜ 미진행 |

- 확정 버그 2건(TC-1.3.6, TC-7.2.2) + 마스킹 견고성 2건 → [TEST_BUGS.md](TEST_BUGS.md). **전체 테스트 후 일괄 수정** 예정(지시).
- **dev 에서 Gemini/Vertex 평가·과금·pdf-parse 동작 확인됨** → §12 AI면접도 실검증 가능.

## 1. 환경 기동 (매 세션 시작)

```powershell
cd D:\intervia\interviewer

# (1) dev 서버 — preview_start 도구로 "dev" 설정 기동 (포트 3003 고정).
#     .claude/launch.json(루트) 에 "dev" 설정 있음: cmd /c cd interviewer && npm run dev
#     ⚠️ 라우트 추가/수정 후 404(HTML) 나면 dev 서버 재시작(stale manifest).

# (2) 깨끗한 시드로 리셋 (재개 전 권장 — ID 가 또 바뀌니 하드코딩 금지, 아래 §3)
$env:LOCAL_DB="1"; node scripts/seed-test.mjs
node scripts/_q.mjs "DELETE FROM auth_attempts" "DELETE FROM api_rate_log"
```

- 테스트 계정 (모두 비번 `Test1234!`): `sysadmin@test`(system_admin) / `admin@company-a.test`(org_admin) / `member@company-a.test`(member) / `admin@company-b.test`(org_admin, 타법인).

## 2. 테스트 방법론 (이번에 쓴 방식)

- **API 검증**: PowerShell `System.Net.HttpWebRequest` 로 호출. 상태변경(POST/PUT/PATCH/DELETE)은 **반드시 `Origin: http://localhost:3003` 헤더** 추가(없으면 proxy.ts CSRF 가드가 403).
- **인증**: 먼저 `POST /api/auth/login {email,password}` → `Set-Cookie` 에서 `session=s_...` 추출 → 이후 요청에 `Cookie: session=...`.
- **DB 상태 확인/세팅**: `scripts/_q.mjs` (아래 §4). 항상 `LOCAL_DB=1` 로 실행(운영 DB 오염 방지).
- **LLM 평가품질**(점수 산식·등급·캐시 등)은 **코드검증**으로 처리(사용자 결정). 큐/트리거/상태전이/과금 wiring/rate limit 은 실테스트.
- 기록: 각 케이스 `[ ]`→`[x]`(통과) / `[ ]`+`> 🔴 FAIL:`(실패) / `[ ]`+`> ⏭️ SKIP:`. 섹션 끝 `결과 요약` + 상단 진행률표 갱신.

## 3. ⚠️ 반드시 기억할 함정 (이번에 데인 것들)

1. **ID 드리프트**: `db:seed-test` 는 wipe 후 재삽입하지만 SQLite autoincrement 는 리셋 안 됨 → **재시드마다 org/user/job id 가 증가**(예: org A 가 6→15→23→25→29→31...). **절대 ID 하드코딩 금지.** 매 세션 시작에 `SELECT id,email,role,org_id FROM users` / `SELECT id,org_id,title FROM job_postings` 로 현재 id 조회 후 사용. 정지/소유 변경은 `WHERE id=(SELECT org_id FROM users WHERE email='...')` 식 서브쿼리로.
2. **CSRF Origin**: 상태변경 API 는 Origin 헤더 필수(없으면 403). GET 은 불요.
3. **Rate limit / 잠금 누적**: `api_rate_log`(범용 rate limit)·`auth_attempts`(로그인 잠금)는 DB 기반이라 케이스 사이 누적됨. 한도/잠금 테스트 전 `DELETE FROM api_rate_log` / `DELETE FROM auth_attempts` 로 리셋. (시드 wipe 는 이 둘을 안 지움)
4. **`$env:LOCAL_DB=$null` 금지**: 환경변수 제거가 샌드박스 가드에 걸림("Remove-Item on system path"). `$env:LOCAL_DB="1"` 한 번만 설정하고 같은 호출 내에선 해제하지 말 것(서버는 별도 프로세스라 영향 없음).
5. **dev 서버 stale 라우트**: 라우트 파일이 있는데 404(HTML not-found) 나오면 dev 서버 재시작(매니페스트 stale). 제품 버그 아님.
6. **pdf-parse + 합성 PDF**: pdfkit 로 만든 PDF 가 첫 파싱에서 `bad XRef` 로 실패할 수 있으나 **재시도(재screen)하면 성공**(transient). 평가 파이프라인 자체는 정상.
7. **종결/삭제 테스트 후 재시드**: 후보·공고를 mutate 하는 섹션 끝나면 `db:seed-test` 로 baseline 복원 후 다음 섹션.

## 4. 만들어 둔 테스트 헬퍼 (scripts/ — 전체 테스트 끝나면 삭제)

| 파일 | 용도 | 사용 (항상 `$env:LOCAL_DB="1"`) |
|---|---|---|
| `_q.mjs` | 읽기/쓰기 SQL 헬퍼(첫 줄 `DB:` 로 타깃 확인) | `node scripts/_q.mjs "SELECT ..." "UPDATE ..."` |
| `_totp.ts` | TOTP 코드 생성(lib/totp 재사용) | `npx tsx scripts/_totp.ts <base32secret>` |
| `_tok.ts` | 토큰 과금/환불/반복차감 직접 호출(lib/tokens) | `npx tsx scripts/_tok.ts charge <orgId> job_post job 1` |
| `_mask.ts` | 마스킹 직접 검증(lib/mask) | `npx tsx scripts/_mask.ts "전화 010-... 이메일 ..."` |
| `_mkpdf.mjs` | 테스트 이력서 PDF 생성(pdfkit) | `node scripts/_mkpdf.mjs out.pdf "텍스트"` |
| `_upload.mjs` | 이력서 멀티파트 업로드(로그인+업로드) | `node scripts/_upload.mjs <jobId> <email> true scripts\_resume_a.pdf` |
| `_resume_a.pdf` / `_resume_b.pdf` | 테스트 이력서 PDF (PII 포함) | (위 _upload 에 사용) |

> 이 헬퍼들은 git 에 커밋하지 말 것(또는 `.gitignore`). 전체 테스트 종료 후 `scripts/_*.mjs` `scripts/_*.ts` `scripts/_resume_*.pdf` 일괄 삭제.

## 5. 남은 섹션 (12~23) 진행 순서 + 주의

- **12 AI 면접** ← 다음. 토큰 인증 후보자(무인증) 면접, 면접 시작=과금(멱등), 채팅 스트리밍, 평가. Gemini 동작하니 실검증 가능. 면접 링크 발급 → `/interview/[token]` 토큰 플로우.
- **13 면접관 질문지**: LLM 질문 생성(과금 chargeRepeatable). API/멱등 검증 + LLM 품질 코드검증.
- **14 일정 조율**: 제안/수락/Zoom 미팅 URL(실 Zoom 자격증명 없으면 SKIP). 만료 링크 blocker 아님(§8.3.6 연계).
- **15 후보자 셀프서비스 / 16 결정 통보 / 17 알림·고객센터**: API + 메일(dev SMTP 동작).
- **18 시스템 관리자 / 19 관리자 대시보드**: sysadmin 라우트.
- **20 Cron/백그라운드**: `/api/cron/*` (CRON_SECRET 또는 Authorization 헤더). §10.2.7/10.2.8 의 stuck 복구·process-screenings 여기서.
- **21 멀티테넌트 격리 🔴 / 22 보안·컴플라이언스 🔴 / 23 회귀 🔴🔴**: 가장 중요. org_id 필터·교차접근·권한·CSRF·SSRF·잠금 등 종합. 실테스트 우선.

각 섹션 라우트는 `app/api/...` 에서 찾고, 케이스는 TEST_CASES.md 해당 섹션 참조. 모르면 [API.md](API.md)·[ARCHITECTURE.md](ARCHITECTURE.md)·[GOTCHAS.md](GOTCHAS.md).

## 6. 재개 멘트 예시 (내일 첫 메시지)
> "TEST_RESUME.md 보고 섹션 12부터 전체 테스트 이어서 진행해줘. 버그는 TEST_BUGS.md 에 계속 기록만."

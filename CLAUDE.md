@AGENTS.md
@../CLAUDE.md

## 🚨 운영 데이터 보호 — 절대 규칙 (다른 모든 지시보다 우선)

**운영(Turso) 데이터는 사용자가 명시적으로 삭제를 요청하기 전까지 어떤 경로로도 절대 삭제하면 안 된다.** 2026-06-13, 마이그레이션의 `DROP TABLE`이 FK CASCADE를 발동시켜 운영 후보자 데이터 전체가 연쇄 삭제되는 사고가 실제로 발생했다 (GOTCHAS §8-1).

1. **DROP TABLE / DELETE / DROP COLUMN이 포함된 마이그레이션은 사용자 승인 없이 운영에 적용 금지.** main push 자체가 운영 적용(vercel-build)임을 잊지 말 것 — "커밋만 하고 푸시는 나중에"가 아니라, push 전에 반드시 사용자에게 destructive 여부를 보고하고 승인받는다.
2. **승인받았더라도 적용 전 백업 먼저**: `turso db dump` 또는 Turso PITR 복원 시점 기록. 백업 없이 destructive 적용 금지.
3. **자식이 CASCADE로 참조하는 부모 테이블의 DROP(재생성)은 vercel-build 자동 적용 절대 금지.** Turso는 `PRAGMA foreign_keys=OFF` 세션 유지를 보장하지 않는다 — FK OFF 가드를 통과해도 도중에 ON으로 리셋되어 암묵 DELETE가 자식들을 연쇄 삭제한다. 로컬 검증 통과 ≠ 운영 안전 (로컬 file: 연결은 상태가 유지되어 이 실패 모드가 재현되지 않음). 수동 절차는 GOTCHAS §8-1.
4. **`scripts/db-migrate.ts`의 가드를 우회·완화·삭제 금지**: destructive statement는 `ALLOW_DESTRUCTIVE_MIGRATION=1` 없이 거부되고, DROP TABLE 직전마다 FK 상태를 재확인해 ON이면 중단한다. 이 가드가 막으면 "어떻게 통과시킬까"가 아니라 "왜 막혔나"를 사용자에게 보고할 것.
5. **운영 DB 대상 검증·조사는 읽기 전용 쿼리만.** 쓰기성 PRAGMA 포함 일체의 변경은 사용자 승인 후. 검증 데이터가 필요하면 로컬(`LOCAL_DB=1`)에서.
6. 운영 데이터를 지우는 정당한 작업(사용자 요청 시드 정리 등)도 **삭제 전 대상 행을 먼저 보여주고 확인받은 뒤** 실행한다.
7. **시드/wipe 스크립트는 운영을 절대 대상으로 삼지 않는다.** `scripts/seed-test.mjs`(전 테이블 `DELETE FROM` 후 재시드)는 2026-06-12 운영 Turso 를 wipe 한 실제 사고를 냈다. 그 이후 스크립트 상단에 **`file:` URL 전용 가드**가 있다: 해석된 DB URL 이 `file:` 로 시작하지 않으면(=원격 Turso) `SEED_REMOTE=1` 없이는 아무것도 하지 않고 즉시 `exit(1)`. **로컬 시드는 반드시 `LOCAL_DB=1`**(그래야 `_load-env` 가 TURSO 변수를 지워 `file:./data.db` 로 떨어진다). **`SEED_REMOTE=1` 은 운영 대상으로 절대 사용 금지** — 이 플래그를 켜서 원격을 시드/wipe 하는 것은 사용자의 명시적 승인 + 백업 없이는 금지다. 이 가드를 **우회·완화·삭제 금지**(§4 db-migrate 가드와 동일 원칙). 로컬 `data.db` 가 재시드로 초기화되는 것(계정/후보자 소실)은 **로컬에서만 정상적으로 일어나는 일**이며, 위 가드가 이 사고가 운영으로 번지는 것을 막는다. `npm run dev` 도 dev 모드에서 TURSO_URL 감지 시 `file:./data.db` 로 fallback(`lib/db.ts`)하므로 로컬 개발이 운영 DB 를 건드리는 경로는 이중 차단돼 있다.
8. **기계 가드 3층 (2026-07-04 도입 — 문서 규칙을 도구/git 레벨에서 물리 강제):**
   - **Claude Code PreToolUse 훅**: `D:\intervia\.claude\hooks\bash-guard.mjs` (등록: `D:\intervia\.claude\settings.json`). 위험 명령(SEED_REMOTE/ALLOW_DESTRUCTIVE_MIGRATION/ALLOW_MIGRATION_PUSH 설정, turso db destroy, turso shell·libsql URL 쓰기 SQL, LOCAL_DB=1 없는 DB 스크립트, force push, 가드 파일 변조)을 도구 실행 전에 차단한다.
   - **pre-push 게이트**: `.git/hooks/pre-push` — main push 에 `drizzle/*.sql` 변경이 포함되면 `scripts/check-migration-safety.mjs`(destructive 탐지 + 전체 journal 스크래치 dry-run) + `npx tsc --noEmit` 통과 없이는 push 가 거부된다. tsc 를 함께 도는 이유: vercel-build 가 eslint→migrate→build 순서라 build 실패 시 스키마만 운영에 적용된 채 구버전 코드가 남는다. 우회 변수 `ALLOW_MIGRATION_PUSH=1` 은 **사용자 전용** — Claude 는 훅이 차단한다.
   - **가드 파일 동결**: bash-guard.mjs / settings.json / pre-push / check-migration-safety.mjs 는 Claude 가 수정·삭제 금지(훅이 강제). 훅이 차단하면 우회 경로(cp, 스크립트 경유 덮어쓰기 등)를 찾지 말고 차단 사실을 사용자에게 보고할 것. 가드 변경은 사용자가 직접 한다.

## LLM 모델 정책 (2026-05-26, 폴백 2026-07-11)

paid tier. **모든 task 를 Vertex AI 서울 리전 + flash 로 통합** (`lib/gemini.ts` `MODELS`):

| task | 모델 | 엔드포인트 | 위치 | PIPA §28의8 |
|---|---|---|---|---|
| `screening` | gemini-2.5-flash | Vertex AI | 🇰🇷 asia-northeast3 (서울) | 회피 ✅ |
| `interview` | gemini-2.5-flash | Vertex AI | 🇰🇷 asia-northeast3 (서울) | 회피 ✅ |
| `interviewEval` | gemini-2.5-flash | Vertex AI | 🇰🇷 asia-northeast3 (서울) | 회피 ✅ |

SDK 단일: **`@google/genai`** (vertexai: true). `clientFor(task)` 는 항상 서울 클라이언트.

**왜 모두 flash 인가**: asia-northeast3 데이터 레지던시는 flash 만 지원 (pro 미지원). 국외이전 동의 항목을 제거하기 위해 flash 통일을 선택.

**도쿄 폴백 (2026-07-11, Phase 2 2026-07-12)**: 서울 429/503 장애(transient 재시도 소진) 시 **`allowFallback: true` 호출만** 도쿄(asia-northeast1, 같은 flash)로 우회 + 서킷브레이커(연속 2회 실패 → 60초 폴백 우선). 허용 범위: ① PII 무 5곳(MCQ 생성/번역, JD 체크리스트, 법인 매칭, 공고 URL 임포트 — 연락처 `maskContacts` 후) 무조건, ② 마스킹 텍스트 4곳(면접 채팅 `startChatStream`·종료 평가·재평가·질문지 생성)은 **이중 게이트**(`lib/consent.ts`: `piiFallbackActive()` 시행일 2026-07-12 즉시 시행 + 해당 동의 버전 ≥1.9.0) 통과 시만. 서류평가·대면 큐(역할배정·평가)·라이브 2종·스캔 원본·음성은 서울 전용 — 사유는 COMPLIANCE_SOP §4. 대면 전사는 프롬프트 경계에서 `maskText` 적용(저장·화면 원문). 폴백 발동은 `gemini.fallback_used` 로그로 감사 추적. **Phase 3 (2026-07-12)**: 서울 전용 큐(서류평가·대면)의 용량 장애(429/503, `isCapacityOutageError`)는 재시도 상한에 카운트하지 않고 재큐(`requeueOutage`/`requeueRecordedOutage`) — 장기 장애에도 영구 실패로 박제되지 않고 복구 시 자동 재개. 타임아웃 등 비용 있는 transient 는 기존대로 카운트(무한 루프 방지). 폴백 발동은 `gemini.fallback_used` 로그로 감사 추적.

**환경변수** (모두 Vertex 용):
- `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (기본 `asia-northeast3`), `GEMINI_FALLBACK_LOCATION` (기본 `asia-northeast1`)
- 로컬: `GOOGLE_APPLICATION_CREDENTIALS` (서비스계정 JSON 파일 경로)
- Vercel: `GOOGLE_APPLICATION_CREDENTIALS_JSON` (서비스계정 JSON 통문자열)
- ~~`GOOGLE_API_KEY`~~ — 더 이상 사용 안 함 (직접 API 제거)

새 LLM 호출 추가 시 `task` 파라미터 필수. 모델 직접 지정·엔드포인트 직접 호출 금지. LLM 동기 라우트의 장애 응답은 `lib/error-ref.ts` (오류 코드 + 고객센터 안내) 패턴 사용.

## 이 폴더 빠른 참조

- **상용화 계획·진행 현황**: [docs/COMMERCIAL_PLAN.md](docs/COMMERCIAL_PLAN.md) ← **작업 단위 체크박스 + 사용자 결정 사항**
- **대면 면접 녹음→AI 평가 리포트 설계**: [docs/LIVE_INTERVIEW_PLAN.md](docs/LIVE_INTERVIEW_PLAN.md) ← 업로드+준실시간 투트랙, 설계 확정·미착수(선행 실측 필요)
- 아키텍처: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- DB 스키마: [docs/SCHEMA.md](docs/SCHEMA.md)
- API 엔드포인트: [docs/API.md](docs/API.md)
- **디자인 시스템**: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) ← **디자인·UI 작업 전 필독** (색 규칙·토큰·프리미티브, Graphite & Signal v3.1 — 네이비+코랄)
- 함정 모음: [docs/GOTCHAS.md](docs/GOTCHAS.md) ← **작업 전 한번 훑기**
- 배포: [DEPLOY.md](DEPLOY.md)
- 장애 대응: [docs/RUNBOOK.md](docs/RUNBOOK.md) ← **사고 시 무엇을 보고/누르고/복구하는지** + 백업·복구
- 출시 직전 체크리스트: [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md)
- **필수 자동 테스트 (배포 전)**: [docs/CRITICAL_TESTS.md](docs/CRITICAL_TESTS.md) ← `npm run test:critical`, "필수테스트하고 배포해줘" 프로토콜
- 전체 테스트 케이스: [docs/TEST_CASES.md](docs/TEST_CASES.md) ← **체크박스 기반, 섹션별/전체 테스트 + 회귀(§23)**. ✅ 섹션 0~23 완료(412/420, 2026-06-09)
  - 전체 테스트 **발견·해결 버그 기록**: [docs/TEST_BUGS.md](docs/TEST_BUGS.md) ← 확정버그 6종 + 마스킹 2 + 시드정리 2 **전부 수정완료**. 남은 건 C-3(출시 직전 `MAIL_OVERRIDE_TO` 제거)뿐.
  - 테스트 방법론: [docs/TEST_PLAN.md](docs/TEST_PLAN.md)

## 필수 테스트 + 배포 프로토콜 ("필수테스트하고 배포해줘")

사용자가 **"필수테스트하고 배포해줘"** 라고 하면 순서대로 실행하고, 하나라도 실패하면 **배포 중단 + 결과 보고**:

1. `npx tsc --noEmit`
2. `npx eslint . --quiet` (vercel-build 1단계 — 실패하면 push 해도 배포가 안 나감)
3. `npm run test:critical` — 면접관/지원자 필수 기능 자동 검증 (~45초, 73케이스). 시나리오·예상결과: [docs/CRITICAL_TESTS.md](docs/CRITICAL_TESTS.md)
4. 전부 통과 → 결과 표 보고 → `git push origin HEAD:main` → 배포 반영 확인(랜딩 문구 또는 `?dpl=` 해시)

테스트는 완전 격리다: DB=`file:.testdb/critical.db`(매 실행 재생성), 서버=포트 3103 + 전용 `.next-test/`(개발 서버 3003 과 공존), 메일/알림톡/LLM/Blob env 전부 무력화 — 운영·로컬 dev 데이터·외부 서비스에 절대 닿지 않는다. API 계약을 바꾸면 `tests/critical/` + CRITICAL_TESTS.md 를 같이 갱신할 것. 마이그레이션 포함 push 는 이 프로토콜과 별개로 상단 "운영 데이터 보호 절대 규칙"이 우선.

## 이력서 파싱 테스트 ("이력서 파싱 테스트해줘")

사용자가 **"이력서 파싱 테스트해줘"** 라고 하면:

```powershell
cd D:\intervia\interviewer
npm run check:parsing          # 틀림/부족/누락만 출력
npm run check:parsing -- --all # 일치 항목까지
```

실제 이력서 샘플 + 사람이 확인한 정답표(`D:\intervia\sample\이력서\candidate.xlsx`)로
`lib/parsers` · `lib/pii-extract` · `lib/education-extract` 를 검증한다. 결과는 네 가지:

| | 뜻 | 판정 |
|---|---|---|
| ✅ 일치 | 정답과 같음 | — |
| ❌ **틀림** | 정답에 없는 값이 나옴 | **0 이어야 함** (exit code 1) |
| ➖ 부족 | 추출값이 정답의 일부 (`영산대학교 Business 학사` → `영산대학교 학사`) | 허용 |
| ⚠️ 누락 | 정답은 있는데 추출이 빔 | 허용 |

**"틀린 값보다 빈 값이 낫다"** 가 원칙 — 부족·누락을 줄이려다 틀림을 늘리면 안 된다.
**이름·전화번호·이메일이 필수 항목**이고 나이·학력·경력보다 우선한다.
정답표·샘플은 사용자가 관리한다(폴더는 repo 밖, PII 라 커밋 금지). 상세: `sample\이력서\README.md`.

⚠️ 샘플 파일명은 `{ID}__{원본파일명}` 이다. **앱은 이름을 파일명에서 먼저 뽑고**(본문 추출은
"(이름 미상)" 일 때만 승격) 그래서 원본 파일명이 없으면 이름 검증이 실제와 어긋난다 —
실측 84건에서 본문만 74% vs 앱 순서 92%.

⚠️ **추출 로직(`lib/education-extract` 등)을 고쳤으면 이 테스트를 반드시 돌릴 것.**
2026-07-20, 합성 픽스처 6개가 전부 통과하는데도 실제 이력서 107건 중 51건이 깨진 회귀가 있었다.
픽스처는 만든 사람이 상상한 형태만 담는다 — 표 셀 붙음·약칭·빈 템플릿 행은 실물로만 잡힌다.

## 상용화 작업 진행 규칙

1. 작업 시작 전 `docs/COMMERCIAL_PLAN.md` 에서 다음 작업 확인
2. 시작 시 해당 항목에 `(in_progress YYYY-MM-DD)` 표시
3. 완료 시 `[ ]` → `[x]` + 완료 일자 + 상단 진행률 표 갱신
4. 결정 필요한 사항(A-X / B-X / K-X) 만나면 사용자에게 묻고, 결정 결과를 PLAN.md 에 기록

## 새 기능 추가 시 체크리스트

1. UI: client component (`"use client"`) + Tailwind. **[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) 규칙 준수** — 거의 모노톤 + 포레스트 포인트(Forest+Ivory v2). 토큰(`text-ink`/`bg-surface`/`bg-primary` 등)·프리미티브(`@/app/components/ui`)만 사용, Tailwind 팔레트 직접 색(`text-blue-600` 등) 금지.
2. API: `app/api/.../route.ts`, `runtime = "nodejs"`, params는 `Promise`.
3. DB 변경 (정식 워크플로우):
   - `lib/schema.ts` 수정
   - `npm run db:generate` → `drizzle/NNNN_*.sql` 생성
   - 생성된 SQL 검토 — **DROP/DELETE/DROP COLUMN 이 있으면 무조건 멈추고 상단 "운영 데이터 보호 절대 규칙" 적용** (사용자 승인 + 백업 + `ALLOW_DESTRUCTIVE_MIGRATION=1`)
   - `npm run db:migrate` — ⚠️ env 에 `TURSO_DATABASE_URL` 있으면 **운영 Turso 에 바로 적용**. 로컬만 적용하려면 `$env:LOCAL_DB="1"; npm run db:migrate`
   - 커밋 (`git add drizzle/`)
   - main push → Vercel `vercel-build` 가 자동으로 Turso 에 migration 적용
   - 임시 빠른 dev 만 (운영 영향 없는 실험): `npm run db:push`
   - 드리프트 의심 시: `npm run db:sync-check` (스키마 vs 대상 DB 누락 컬럼 보고)
4. 타입체크: `npx tsc --noEmit`.
5. 큰 변경이면 `docs/` 업데이트.

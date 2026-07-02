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

## LLM 모델 정책 (2026-05-26)

paid tier. **모든 task 를 Vertex AI 서울 리전 + flash 로 통합** (`lib/gemini.ts` `MODELS`):

| task | 모델 | 엔드포인트 | 위치 | PIPA §28의8 |
|---|---|---|---|---|
| `screening` | gemini-2.5-flash | Vertex AI | 🇰🇷 asia-northeast3 (서울) | 회피 ✅ |
| `interview` | gemini-2.5-flash | Vertex AI | 🇰🇷 asia-northeast3 (서울) | 회피 ✅ |
| `interviewEval` | gemini-2.5-flash | Vertex AI | 🇰🇷 asia-northeast3 (서울) | 회피 ✅ |

SDK 단일: **`@google/genai`** (vertexai: true). 분기 없음 — `clientFor(task)` 는 항상 vertexClient.

**왜 모두 flash 인가**: asia-northeast3 데이터 레지던시는 flash 만 지원 (pro 미지원). 국외이전 동의 항목을 제거하기 위해 flash 통일을 선택.

**환경변수** (모두 Vertex 용):
- `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (기본 `asia-northeast3`)
- 로컬: `GOOGLE_APPLICATION_CREDENTIALS` (서비스계정 JSON 파일 경로)
- Vercel: `GOOGLE_APPLICATION_CREDENTIALS_JSON` (서비스계정 JSON 통문자열)
- ~~`GOOGLE_API_KEY`~~ — 더 이상 사용 안 함 (직접 API 제거)

새 LLM 호출 추가 시 `task` 파라미터 필수. 모델 직접 지정·엔드포인트 직접 호출 금지.

## 이 폴더 빠른 참조

- **상용화 계획·진행 현황**: [docs/COMMERCIAL_PLAN.md](docs/COMMERCIAL_PLAN.md) ← **작업 단위 체크박스 + 사용자 결정 사항**
- **대면 면접 녹음→AI 평가 리포트 설계**: [docs/LIVE_INTERVIEW_PLAN.md](docs/LIVE_INTERVIEW_PLAN.md) ← 업로드+준실시간 투트랙, 설계 확정·미착수(선행 실측 필요)
- 아키텍처: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- DB 스키마: [docs/SCHEMA.md](docs/SCHEMA.md)
- API 엔드포인트: [docs/API.md](docs/API.md)
- **디자인 시스템**: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) ← **디자인·UI 작업 전 필독** (색 규칙·토큰·프리미티브, Forest+Ivory v2)
- 함정 모음: [docs/GOTCHAS.md](docs/GOTCHAS.md) ← **작업 전 한번 훑기**
- 배포: [DEPLOY.md](DEPLOY.md)
- 장애 대응: [docs/RUNBOOK.md](docs/RUNBOOK.md) ← **사고 시 무엇을 보고/누르고/복구하는지** + 백업·복구
- 출시 직전 체크리스트: [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md)
- 전체 테스트 케이스: [docs/TEST_CASES.md](docs/TEST_CASES.md) ← **체크박스 기반, 섹션별/전체 테스트 + 회귀(§23)**. ✅ 섹션 0~23 완료(412/420, 2026-06-09)
  - 전체 테스트 **발견·해결 버그 기록**: [docs/TEST_BUGS.md](docs/TEST_BUGS.md) ← 확정버그 6종 + 마스킹 2 + 시드정리 2 **전부 수정완료**. 남은 건 C-3(출시 직전 `MAIL_OVERRIDE_TO` 제거)뿐.
  - 테스트 방법론: [docs/TEST_PLAN.md](docs/TEST_PLAN.md)

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

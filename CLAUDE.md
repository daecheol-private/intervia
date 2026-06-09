@AGENTS.md
@../CLAUDE.md

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
- 아키텍처: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- DB 스키마: [docs/SCHEMA.md](docs/SCHEMA.md)
- API 엔드포인트: [docs/API.md](docs/API.md)
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

1. UI: client component (`"use client"`) + Tailwind. 기존 디자인 톤 유지 (slate-50 배경, white 카드, blue accent).
2. API: `app/api/.../route.ts`, `runtime = "nodejs"`, params는 `Promise`.
3. DB 변경 (정식 워크플로우):
   - `lib/schema.ts` 수정
   - `npm run db:generate` → `drizzle/NNNN_*.sql` 생성
   - 생성된 SQL 검토 (특히 destructive 변경 — DROP/RENAME 은 별도 결정)
   - `npm run db:migrate` → 로컬 적용
   - 커밋 (`git add drizzle/`)
   - main push → Vercel `vercel-build` 가 자동으로 Turso 에 migration 적용
   - 임시 빠른 dev 만 (운영 영향 없는 실험): `npm run db:push`
   - 드리프트 의심 시: `npm run db:sync-check` (스키마 vs 대상 DB 누락 컬럼 보고)
4. 타입체크: `npx tsc --noEmit`.
5. 큰 변경이면 `docs/` 업데이트.

# 전체 테스트 발견 버그·이슈 트래커

> 출처: [TEST_CASES.md](TEST_CASES.md) 전체 테스트 (섹션 0~11 진행, 2026-06-07~08).
> 방침: **전체 테스트를 끝까지 마친 뒤** 아래 항목을 위에서부터 하나씩 수정한다. (사용자 결정)
> 상태 범례: 🔴 미수정 / 🟢 수정완료 / ⏳ 재검증대기

---

## A. 확정 버그 (코드 수정 필요)

### A-1. 🔴 중복 합류 이메일 → 500 (기대 409) — TC-1.3.6
- **위치**: `app/api/orgs/join-requests/route.ts:123` (POST, catch 블록)
- **현상**: 이미 가입된 이메일로 합류 요청 시 `users` INSERT 가 UNIQUE 위반 → catch 가 `e.message` 에서 `/UNIQUE/` 를 찾지만 Drizzle 이 에러를 감싸 최상위 message 는 `"Failed query: insert into..."` 라 매칭 실패 → `throw e` → **500**.
- **루트원인**: `"UNIQUE constraint failed"` 문구는 `e.cause.message`(LibsqlError, code `SQLITE_CONSTRAINT_UNIQUE`)에만 존재. catch 가 cause 체인을 안 봄.
- **수정안**: catch 에서 `e.cause?.message` 까지 확인하거나 `(e as any).code === 'SQLITE_CONSTRAINT_UNIQUE'` / `(e as any).cause?.rawCode === 2067` 로 판정 → 409 반환.
- **영향/심각도**: 중. 실사용 UI 는 사전 `check-email` 로 중복을 먼저 걸러 드물지만, API 자체가 500 + 에러로그 오염. 환경 무관(운영에서도 재현).
- **추가 점검**: 동일 `.cause` 미탐색 catch 패턴이 다른 라우트에도 있는지 `grep "unique constraint"` 로 전수 점검.

### A-2. 🔴 공고 5분내 삭제 환불 미발동 (TZ 버그) — TC-7.2.2
- **위치**: `app/api/jobs/[id]/route.ts:191` (DELETE)
- **현상**: 공고 생성 직후 삭제해도 `refundFeature` 가 발동 안 함 → 토큰 환불 안 됨.
- **루트원인**: `new Date(existing.createdAt)` 가 SQLite UTC 타임스탬프(`"2026-06-07 15:00:00"`, `Z` 없음)를 **로컬 타임존으로 파싱**. KST(+9) 머신에서는 9시간 이른 값이 되어 `ageMs` 가 항상 ~9시간 → `ageMs <= 5분` 영영 false → 환불 미발동.
  - node 확인: `new Date('2026-06-07 15:00:00')` − UTC파싱 = **−32,400,000ms(−9h)**, TZ=Asia/Seoul.
- **수정안**: `lib/auth-attempts.ts` 의 `parseSqliteTimestamp`(문자열에 `Z` 부착 후 파싱)처럼 UTC 로 파싱. 또는 createdAt 비교를 UTC 기준으로 통일.
- **영향/심각도**: 중. ⚠️ **운영(Vercel)은 UTC 라 정상 동작 → 잠재버그**. 그러나 (a) 로컬/비UTC 서버에서 토큰 손실, (b) 로컬에서 환불 테스트 불가, (c) UTC 의존이라 fragile. 견고성 위해 수정 권장.
- **추가 점검**: `grep "new Date(" lib app | grep -i "createdAt\|created_at\|attemptedAt"` 로 동일 패턴(SQLite ts 를 Z 없이 `new Date`) 전수 점검. 환불·만료·기간 계산 등 시간 비교 로직 우선.

---

## B. 마스킹 robustness (lib/mask.ts — PII 보호 견고성)

### B-1. 🔴 짧은 후보 이름 → 과잉 마스킹으로 이력서 텍스트 파괴 — §10/§9.4.1
- **위치**: `lib/mask.ts` `maskText` (known.name 기반 치환)
- **현상**: 후보 이름이 1글자(테스트: 파일명 stem `"a"`)면, `maskText` 가 known.name 으로 문서 내 **모든 "a"** 를 `[이름]` 으로 치환 → 마스킹본이 `"N[이름]me"`, `"Educ[이름]tion"`, `"5 ye[이름]rs"` 처럼 파괴됨. 이 파괴된 텍스트가 AI 평가에 입력됨.
- **루트원인**: known-name 치환에 길이 하한·단어경계 가드가 없음. 1~2글자 이름/토큰이면 본문 단어 내부까지 매칭.
- **수정안**: known-name 길이 < 2 면 치환 스킵, 또는 한글/영문 단어경계(`\b` 또는 한글 경계 lookaround) 적용. 영문 단일 알파벳은 마스킹 대상에서 제외.
- **영향/심각도**: 중. 정상 한글 이름(2~3자)은 영향 적으나, 1글자 이름·이니셜·파일명 기반 이름에서 평가 입력 오염. 환경 무관.

### B-2. 🟡 라벨 마스킹이 이메일 TLD 조각 잔존 — TC-9.4.1
- **위치**: `lib/mask.ts` `applyLabels`
- **현상**: `"이메일 test@example.com"` 입력 시 마스킹 결과에 `.com` 조각이 남음(`"...[전화].com"`). 이메일 로컬/도메인 핵심은 가려지나 TLD 조각 leak.
- **루트원인**: 라벨 기반 사전 마스킹의 값 경계 처리가 이메일 정규식과 어긋남(applyLabels 가 부분만 소비하고 applyBasic 의 이메일 정규식이 잔여 `.com` 을 재매칭 못함).
- **수정안**: applyLabels 값 경계를 이메일 전체 토큰까지 확장하거나, applyBasic(정규식 패스)을 라벨 패스보다 먼저 적용해 전체 이메일을 먼저 마스킹.
- **영향/심각도**: 낮음. 도메인 TLD 조각 leak(식별성 낮음). 그래도 PII 정책상 정리 권장.

> B-1/B-2 는 같은 파일(`lib/mask.ts`)이라 함께 손보는 게 효율적. 수정 후 `scripts/_mask.ts` 로 회귀 확인 가능.

---

## C. 시드/환경 정리 항목 (제품 버그 아님 — 테스트 품질·출시 위생)

### C-1. 시드 법인이 `pending_review` 상태
- **현상**: `npm run db:seed-test` 가 만든 법인이 `verification_status='pending_review'`. 실제 signup 은 `verified` 를 생성하므로 불일치 → 합류 happy-path 테스트가 막혀 우회 필요.
- **권장**: `scripts/seed-test.mjs` insertOrg 에 `verification_status='verified'` 명시.

### C-2. 시드 비밀번호 `Test1234!` 가 9자 (정책 10자 미달)
- **현상**: 로그인은 bcrypt 비교라 통과하지만, 비번 정책(10자+) 검증을 가림(예: TC-4.1.2 "동일 비번 거부" 가 정책 에러에 먼저 막힘).
- **권장**: 시드 비번을 10자+ compliant(예: `Test1234!!`)로 교체. (교체 시 CLAUDE.md/문서의 비번 표기도 동기화)

### C-3. dev `MAIL_OVERRIDE_TO` 설정됨
- **현상**: dev `.env.local` 에 메일 가로채기 활성. 출시 전 제거 대상(LAUNCH_CHECKLIST 연계).

### C-4. (해결됨, 기록용) CSV export 404 → dev 서버 stale manifest
- 실행 중이던 dev 서버가 `/api/jobs/[id]/candidates/export` 라우트를 미등록 → 404. **서버 재시작 후 정상**(200, UTF-8 BOM). 제품 버그 아님. 운영(Vercel 빌드)은 영향 없음. → 라우트 추가/수정 후 stale 404 보이면 dev 서버 재시작.

---

## 진행 요약 (2026-06-08 기준)
- 확정 버그 **2** (A-1, A-2) · 마스킹 견고성 **2** (B-1, B-2) · 환경/시드 정리 **4** (C-1~C-4)
- 섹션 0~11 검증 완료. 12~23 미진행. 상세는 [TEST_CASES.md](TEST_CASES.md), 재개법은 [TEST_RESUME.md](TEST_RESUME.md).

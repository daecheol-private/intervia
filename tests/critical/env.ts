/**
 * 필수 테스트 격리 환경 — 이 모듈이 모든 테스트 파일의 "첫 import" 여야 한다.
 *
 * 안전 원칙 (CLAUDE.md 운영 데이터 보호 절대 규칙의 테스트판):
 *  - DB 는 오직 file:.testdb/critical.db — 운영 Turso·로컬 data.db 절대 접근 불가.
 *  - 외부 부수효과(메일/알림톡/LLM/Blob) env 를 전부 무력화한 채 서버를 spawn 한다.
 *  - 조건 위반 시 어떤 테스트도 실행되지 않고 즉시 중단.
 */
import path from "node:path";
import assert from "node:assert";

export const ROOT = process.cwd();
assert.ok(
  /interviewer[\\/]?$/.test(ROOT),
  `테스트는 D:\\intervia\\interviewer 에서 실행해야 합니다 (현재: ${ROOT})`
);

export const TEST_PORT = 3103;
export const BASE = `http://127.0.0.1:${TEST_PORT}`;
export const TESTDB_DIR = path.join(ROOT, ".testdb");
export const TEST_DB_FILE = path.join(TESTDB_DIR, "critical.db");
/** cwd(interviewer) 기준 상대 file URL — 서버·테스트 프로세스 둘 다 같은 파일을 가리킨다 */
export const TEST_DB_URL = "file:.testdb/critical.db";
export const INTERNAL_SECRET = "ct-internal-secret";
export const CRON_SECRET = "ct-cron-secret";
/** 이 실행에서 만든 업로드 파일 식별용 프리픽스 (종료 시 정리) */
export const RUN_TAG = `ct-${Date.now().toString(36)}`;

export const PASSWORD = "Test1234!aZ";

// ── 테스트 프로세스 자신의 env (lib/db.ts 등 lib 직접 import 용) ──────────────
process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
process.env.DATABASE_URL = TEST_DB_URL;
process.env.BLOB_READ_WRITE_TOKEN = "";

export function assertIsolated() {
  const url = process.env.DATABASE_URL ?? "";
  assert.ok(
    url.startsWith("file:") && url.includes(".testdb"),
    `격리 위반: DATABASE_URL 이 테스트 DB 가 아님 (${url})`
  );
  assert.equal(process.env.TURSO_DATABASE_URL, "", "격리 위반: TURSO_DATABASE_URL 잔존");
}
assertIsolated();

/** spawn 되는 next dev 서버의 env — .env.local 값은 process env 우선 규칙으로 전부 무시된다 */
export const SERVER_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
  DATABASE_URL: TEST_DB_URL,
  // 파일 저장 → 로컬 uploads/ 강제 (Blob 사용 금지)
  BLOB_READ_WRITE_TOKEN: "",
  // 메일 → SMTP 미설정 상태 강제 (SmtpNotConfiguredError 경로 — 실발송 0)
  SMTP_HOST: "",
  SMTP_PORT: "",
  SMTP_USER: "",
  SMTP_PASS: "",
  MAIL_OVERRIDE_TO: "",
  // 알림톡 → 미설정 강제 (조용히 skip)
  ALIGO_API_KEY: "",
  ALIGO_USER_ID: "",
  ALIGO_SENDER_KEY: "",
  ALIGO_SENDER: "",
  ALIMTALK_LOCAL_ENABLED: "",
  // LLM → 존재하지 않는 자격증명 파일 경로: 호출 시 즉시 실패 (실호출·과금 0)
  GOOGLE_APPLICATION_CREDENTIALS: path.join(TESTDB_DIR, "no-creds.json"),
  GOOGLE_APPLICATION_CREDENTIALS_JSON: "",
  GOOGLE_CLOUD_PROJECT: "ct-test",
  // 내부/크론 인증 시크릿 — 테스트가 아는 고정값
  INTERNAL_API_SECRET: INTERNAL_SECRET,
  CRON_SECRET,
  // 워커 self-kick 이 테스트 서버 밖으로 새지 않도록
  APP_BASE_URL: BASE,
  // 부트스트랩 자동 승격 비활성 (시드가 system_admin 을 직접 만든다)
  SYSTEM_ADMIN_EMAIL: "",
  SUBDOMAIN_APPLY_ENABLED: "",
  NEXT_TELEMETRY_DISABLED: "1",
  // 개발 서버(.next)와 분리된 빌드 디렉토리 — dev 락 충돌 회피 + 아티팩트 불간섭.
  // .testdb 밖에 둬서 실행 간 컴파일 캐시를 재사용한다 (gitignore 등재).
  NEXT_TEST_DIST_DIR: ".next-test",
};

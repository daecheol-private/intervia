/**
 * 환경변수 중앙화 + 검증. 런타임 첫 호출 시 lazy validate.
 *
 * 사용:
 *   import { config } from "@/lib/config";
 *   const proj = config().GOOGLE_CLOUD_PROJECT;
 *
 * 정책:
 *   - 필수 키 누락 시 throw (앱 부팅 또는 첫 호출 시점에 즉시 발각)
 *   - 선택 키는 undefined 허용
 *   - .env 파일 로딩은 Next.js 가 알아서 (또는 scripts/_load-env.mjs)
 */

type Config = {
  // 필수 (배포 환경) — 모든 LLM 호출은 Vertex AI 서울 리전 경유 (2026-05-26 통합)
  GOOGLE_CLOUD_PROJECT: string;
  MASTER_ENCRYPTION_KEY: string; // 64 hex chars
  // 선택 — 없으면 fallback 동작
  GOOGLE_CLOUD_LOCATION?: string; // 기본 asia-northeast3
  GOOGLE_APPLICATION_CREDENTIALS?: string; // 로컬: JSON 파일 경로
  GOOGLE_APPLICATION_CREDENTIALS_JSON?: string; // Vercel: JSON 통문자열
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  BLOB_READ_WRITE_TOKEN?: string;
  CRON_SECRET?: string;
  INTERNAL_API_SECRET?: string;
  APP_BASE_URL?: string;
  // SMTP fallback
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  // 모니터링
  SENTRY_DSN?: string;
  SLACK_WEBHOOK_URL?: string;
  // 큐 튜닝
  SCREENING_WORKER_CONCURRENCY?: string;
  SCREENING_WORKER_MAX_JOBS?: string;
  // 정책
  PURGE_AFTER_DAYS?: string;
  SKIP_HIBP?: string;
};

let cached: Config | null = null;
let errors: string[] = [];

function validate(): Config {
  errors = [];
  const env = process.env;
  if (!env.GOOGLE_CLOUD_PROJECT) errors.push("GOOGLE_CLOUD_PROJECT 필수");
  if (
    !env.GOOGLE_APPLICATION_CREDENTIALS &&
    !env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  ) {
    errors.push(
      "GOOGLE_APPLICATION_CREDENTIALS 또는 GOOGLE_APPLICATION_CREDENTIALS_JSON 필수"
    );
  }
  if (!env.MASTER_ENCRYPTION_KEY) {
    errors.push("MASTER_ENCRYPTION_KEY 필수");
  } else if (env.MASTER_ENCRYPTION_KEY.length !== 64) {
    errors.push(
      `MASTER_ENCRYPTION_KEY 길이 오류: ${env.MASTER_ENCRYPTION_KEY.length} (64 hex chars 필요)`
    );
  }

  // 운영 환경 (NODE_ENV=production) 에서 추가 권장 체크
  if (env.NODE_ENV === "production") {
    if (!env.TURSO_DATABASE_URL) errors.push("TURSO_DATABASE_URL 권장 (운영)");
    if (!env.CRON_SECRET) errors.push("CRON_SECRET 권장 (운영)");
    if (!env.INTERNAL_API_SECRET) errors.push("INTERNAL_API_SECRET 권장 (운영)");
    if (!env.APP_BASE_URL) errors.push("APP_BASE_URL 권장 (운영)");
  }

  if (errors.length > 0) {
    const msg = `환경변수 검증 실패:\n${errors.map((e) => "  - " + e).join("\n")}`;
    throw new Error(msg);
  }
  return env as unknown as Config;
}

export function config(): Config {
  if (cached) return cached;
  cached = validate();
  return cached;
}

/** 검증 없이 raw env 조회 — 검증 우회 필요한 경우만. */
export function rawEnv(name: keyof Config): string | undefined {
  return process.env[name];
}

/** 검증 결과만 확인 (throw 안 함). 헬스체크 용도. */
export function checkConfig(): { ok: boolean; errors: string[] } {
  try {
    validate();
    return { ok: true, errors: [] };
  } catch {
    return { ok: false, errors: [...errors] };
  }
}

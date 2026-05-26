/**
 * 헬스체크.
 *
 * 두 가지 모드:
 *   1) 공개 ping (인증 불요) — DB liveness 만. 부하 분산기·uptime 모니터링용.
 *      응답 200/503 + { ok: boolean }.
 *   2) 상세 진단 (Authorization: Bearer <HEALTH_TOKEN>) — 환경변수 설정 상태 등 인프라 정보 노출.
 *      HEALTH_TOKEN 미설정 시 상세 모드 차단.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

async function checkDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const t = Date.now();
  try {
    await db.run(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - t };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function checkEnv(name: string): boolean {
  return !!process.env[name];
}

function isAuthorized(req: Request): boolean {
  const token = process.env.HEALTH_TOKEN;
  if (!token) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  if (header.length !== expected.length) return false;
  // 길이가 같을 때만 비교 — timing-safe 는 아니지만 short-circuit 차단.
  return header === expected;
}

export async function GET(req: Request) {
  const dbR = await checkDb();
  const authorized = isAuthorized(req);

  if (!authorized) {
    // 공개 모드: DB ok 여부만. 환경 정보는 노출 X.
    return Response.json(
      { ok: dbR.ok, service: "intervia" },
      { status: dbR.ok ? 200 : 503 }
    );
  }

  // 상세 모드: 인프라 진단 정보 포함.
  const result = {
    ok: dbR.ok,
    timestamp: new Date().toISOString(),
    service: "intervia",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    checks: {
      db: dbR,
      env: {
        google_cloud_project: checkEnv("GOOGLE_CLOUD_PROJECT"),
        google_app_credentials:
          checkEnv("GOOGLE_APPLICATION_CREDENTIALS") ||
          checkEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
        master_encryption_key: checkEnv("MASTER_ENCRYPTION_KEY"),
        internal_api_secret: checkEnv("INTERNAL_API_SECRET"),
        cron_secret: checkEnv("CRON_SECRET"),
      },
      blob: { configured: checkEnv("BLOB_READ_WRITE_TOKEN") },
      sentry: { configured: checkEnv("SENTRY_DSN") },
      slack: { configured: checkEnv("SLACK_WEBHOOK_URL") },
    },
  };
  return Response.json(result, { status: result.ok ? 200 : 503 });
}

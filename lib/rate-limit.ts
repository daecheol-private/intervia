/**
 * 범용 API rate limit. DB 기반 sliding window.
 *
 * 사용 예 (route 안):
 *   const limited = await rateLimit(req, "signup", { limit: 5, windowSec: 60 });
 *   if (limited) return limited;
 *
 * 식별자 우선순위:
 *   1) currentUserId 가 주어지면 `user:${id}` (로그인된 액션)
 *   2) 그 외 IP (Vercel x-forwarded-for)
 *   3) 둘 다 없으면 "anon" (운영에선 거의 발생 안 함)
 *
 * 동작:
 *   - INSERT (멱등 X — 모든 호출 1 row)
 *   - SELECT COUNT(*) FROM api_rate_log
 *     WHERE scope = ? AND identifier = ? AND attempted_at >= now-window
 *   - count > limit → 429 응답 + Retry-After 헤더
 *
 * 정리: cron 으로 24h 경과 row 삭제 (purge-original 에 끼움).
 *
 * 한계 (운영 시 고려):
 *   - DB 부하: 매 요청 1 SELECT + 1 INSERT. 따라서 sensitive endpoint 에만 적용.
 *   - timestamp 포맷: SQLite 'YYYY-MM-DD HH:MM:SS' UTC. 헬퍼 사용.
 */
import { db } from "./db";
import { apiRateLog } from "./schema";
import { and, eq, gte, sql, lt } from "drizzle-orm";
import { extractIp } from "./auth-attempts";

function sqliteTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

export type RateLimitOpts = {
  limit: number;
  windowSec: number;
  // 명시적으로 identifier 지정 (예: 로그인 시도 시 사용자가 입력한 email + ip)
  identifier?: string;
};

export async function rateLimit(
  req: Request,
  scope: string,
  opts: RateLimitOpts,
  currentUserId?: number | null
): Promise<Response | null> {
  const ip = extractIp(req);
  const identifier =
    opts.identifier ??
    (currentUserId ? `user:${currentUserId}` : ip ?? "anon");

  const since = sqliteTimestamp(new Date(Date.now() - opts.windowSec * 1000));

  const [row] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(apiRateLog)
    .where(
      and(
        eq(apiRateLog.scope, scope),
        eq(apiRateLog.identifier, identifier),
        gte(apiRateLog.attemptedAt, since)
      )
    );
  const count = Number(row?.c ?? 0);

  // INSERT — fire-and-forget 으로 응답 지연 최소화
  void db
    .insert(apiRateLog)
    .values({ scope, identifier })
    .catch((e) => console.error("[rate-limit] insert failed:", e));

  if (count >= opts.limit) {
    return new Response(
      JSON.stringify({
        error: `요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.`,
        code: "rate_limited",
        retryAfterSeconds: opts.windowSec,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(opts.windowSec),
        },
      }
    );
  }

  return null;
}

/** 24h 경과 row 삭제. cron 정리용. */
export async function cleanupOldRateLog(): Promise<number> {
  const cutoff = sqliteTimestamp(new Date(Date.now() - 86_400_000));
  const r = await db
    .delete(apiRateLog)
    .where(lt(apiRateLog.attemptedAt, cutoff))
    .returning({ id: apiRateLog.id });
  return r.length;
}

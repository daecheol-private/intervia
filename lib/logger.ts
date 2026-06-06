/**
 * 가벼운 구조화 로거. Vercel logs 가 console.* 을 수집하므로 별도 transport 불필요.
 *
 * 사용:
 *   import { log } from "@/lib/logger";
 *   log.info("event-name", { foo: 1 });
 *   log.error("event-name", err, { ctx: "..." });
 *
 * 출력 형식 (JSON 1줄):
 *   {"ts":"2026-05-16T...","level":"info","msg":"event-name","foo":1}
 *
 * 요청 ID 부착이 필요한 경우:
 *   const reqLog = withRequest(req);
 *   reqLog.info("hit", { foo:1 });   // → 자동으로 req_id 포함
 *
 * node 모듈을 import 하지 않는다 — instrumentation.ts(onRequestError) 가 이 로거를
 * 거쳐 error-reporter 를 쓰므로 Edge 런타임 번들에도 들어간다. 글로벌 Web Crypto 만 사용.
 */

type Level = "debug" | "info" | "warn" | "error";

function shouldLog(level: Level): boolean {
  if (level === "debug")
    return process.env.NODE_ENV !== "production" || process.env.DEBUG === "1";
  return true;
}

function out(level: Level, msg: string, meta: Record<string, unknown> = {}) {
  if (!shouldLog(level)) return;
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };
  const writer =
    level === "error" || level === "warn" ? console.error : console.log;
  try {
    writer(JSON.stringify(line));
  } catch {
    // 직렬화 실패 시 fallback (circular 등)
    writer(`[${level}] ${msg}`, meta);
  }
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) =>
    out("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) =>
    out("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    out("warn", msg, meta),
  error: (msg: string, err?: unknown, meta?: Record<string, unknown>) => {
    const errMeta: Record<string, unknown> = { ...meta };
    if (err instanceof Error) {
      errMeta.error = err.message;
      errMeta.stack = err.stack?.split("\n").slice(0, 8).join("\n");
    } else if (err !== undefined) {
      errMeta.error = String(err);
    }
    out("error", msg, errMeta);
  },
};

export type RequestLogger = typeof log;

/** Request 단위 컨텍스트 (req_id 자동 첨부). */
export function withRequest(req: Request): RequestLogger {
  const reqId = readOrCreateRequestId(req);
  const wrap = (level: Level) =>
    (
      msg: string,
      arg2?: unknown,
      arg3?: Record<string, unknown>
    ): void => {
      if (level === "error") {
        const errMeta: Record<string, unknown> = { req_id: reqId, ...(arg3 ?? {}) };
        if (arg2 instanceof Error) {
          errMeta.error = arg2.message;
          errMeta.stack = arg2.stack?.split("\n").slice(0, 8).join("\n");
        } else if (arg2 !== undefined) {
          errMeta.error = String(arg2);
        }
        out("error", msg, errMeta);
      } else {
        out(level, msg, { req_id: reqId, ...((arg2 as Record<string, unknown>) ?? {}) });
      }
    };
  return {
    debug: wrap("debug") as RequestLogger["debug"],
    info: wrap("info") as RequestLogger["info"],
    warn: wrap("warn") as RequestLogger["warn"],
    error: wrap("error") as RequestLogger["error"],
  };
}

function readOrCreateRequestId(req: Request): string {
  return (
    req.headers.get("x-request-id") ??
    req.headers.get("x-vercel-id") ??
    "r_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8)
  );
}

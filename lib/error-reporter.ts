/**
 * 외부 에러 리포팅. Lightweight — Sentry/Slack 모두 fire-and-forget.
 *
 * 통합 방식:
 *  - SENTRY_DSN 있으면 Sentry envelope HTTP API 직접 POST (SDK 미사용 → bundle 가벼움)
 *  - SLACK_WEBHOOK_URL 있으면 critical 한정 Slack 메시지
 *
 * 사용:
 *   import { captureError, captureCritical } from "@/lib/error-reporter";
 *   captureError(err, { route: "/api/foo", userId: 1 });
 *   captureCritical(err, { ... });   // → Sentry + Slack
 */
import { log } from "./logger";

type ErrorContext = Record<string, unknown>;

// ── PII 스크럽 (Sentry 는 미국 리전 → 개인정보 섞이면 §28의8 국외이전) ──────────────
// 전송 직전 error.message·context 의 문자열에서 흔한 PII(이메일·전화·주민번호·면접/일정 토큰)를
// 마스킹하고, 이름·자유서술성 키는 통째로 드롭한다. 디버깅에 필요한 식별 ID·라우트·액션은 유지.
// (Vercel 로그에는 원본이 그대로 남아 디버깅엔 지장 없음 — 스크럽은 Sentry/Slack 전송분 한정.)
const PII_RULES: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b\d{6}[-\s]?[1-4]\d{6}\b/g, "[rrn]"],
  [/\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, "[phone]"],
  [/\b(?:tk|sch)_[A-Za-z0-9]+/g, "[token]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[uuid]"],
  [/\b[0-9a-f]{32,}\b/gi, "[hex]"],
];

function scrubString(s: string): string {
  let out = s;
  for (const [re, rep] of PII_RULES) out = out.replace(re, rep);
  return out.length > 1000 ? out.slice(0, 1000) + "…" : out;
}

// 값에 자유서술 PII(특히 정규식으로 못 잡는 이름)가 들어가기 쉬운 키 — 통째로 redact.
const DROP_KEYS = new Set([
  "email", "phone", "mobile", "tel", "name", "fullname", "firstname", "lastname",
  "candidatename", "applicantname", "username", "rrn", "ssn", "birth", "dob",
  "password", "pass", "passwd", "secret", "token", "accesstoken", "authpass", "apikey",
  "resume", "resumetext", "text", "body", "content", "html", "metadata", "address",
  "note", "memo", "comment", "message", "query", "q",
]);

function scrubValue(v: unknown, depth: number): unknown {
  if (depth > 3) return "[depth]";
  if (typeof v === "string") return scrubString(v);
  if (typeof v === "number" || typeof v === "boolean" || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrubValue(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const norm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
      out[k] = DROP_KEYS.has(norm) ? "[redacted]" : scrubValue(val, depth + 1);
    }
    return out;
  }
  return undefined;
}

function scrubContext(ctx: ErrorContext): ErrorContext {
  return scrubValue(ctx, 0) as ErrorContext;
}

// Drizzle/@libsql 은 실제 SQLite 에러를 `error.cause` 에 감싸므로 최상위 message 에는
// "Failed query: ..." 만 남는다. cause 체인을 평탄화해 진짜 원인(SQLITE_BUSY / no such
// table / stream 만료 등 message·code·rawCode)을 Sentry value 에 함께 싣는다.
// (스크럽은 호출부에서 적용 — 여기선 평문 결합만.)
function flattenError(error: Error): string {
  const parts = [error.message];
  let cur: unknown = (error as { cause?: unknown }).cause;
  for (let d = 0; cur && d < 5; d++) {
    const n = cur as {
      message?: unknown;
      code?: unknown;
      rawCode?: unknown;
      cause?: unknown;
    };
    const m = typeof n.message === "string" ? n.message : String(n);
    const code = n.code ?? n.rawCode;
    parts.push(`caused by: ${m}${code != null ? ` [${String(code)}]` : ""}`);
    cur = n.cause;
  }
  return parts.join("\n");
}

function dsnParts(): {
  ingest: string;
  publicKey: string;
  projectId: string;
} | null {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const host = u.host;
    const projectId = u.pathname.slice(1);
    const ingest = `https://${host}/api/${projectId}/envelope/`;
    return { ingest, publicKey, projectId };
  } catch {
    return null;
  }
}

async function sendToSentry(
  err: Error | string,
  context: ErrorContext,
  level: "error" | "fatal" = "error"
): Promise<void> {
  const dsn = dsnParts();
  if (!dsn) return;
  const error =
    err instanceof Error ? err : new Error(typeof err === "string" ? err : String(err));
  // Sentry envelope 는 event_id 가 정확히 32 hex chars 여야 함.
  // node:crypto 대신 글로벌 Web Crypto(randomUUID)를 써서 Node·Edge 양쪽 런타임에서 동작
  // (instrumentation onRequestError 는 edge 런타임에서도 호출될 수 있음).
  const eventId = crypto.randomUUID().replace(/-/g, "");

  const event = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: "node",
    level,
    environment: process.env.NODE_ENV ?? "development",
    server_name: "intervia",
    exception: {
      values: [
        {
          type: error.name ?? "Error",
          value: scrubString(flattenError(error)),
          stacktrace: error.stack
            ? {
                frames: error.stack
                  .split("\n")
                  .slice(1, 20)
                  .map((line) => ({ filename: scrubString(line.trim()) })),
              }
            : undefined,
        },
      ],
    },
    extra: scrubContext(context),
  };

  const envelope =
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }) +
    "\n" +
    JSON.stringify({ type: "event", content_type: "application/json" }) +
    "\n" +
    JSON.stringify(event);

  try {
    await fetch(dsn.ingest, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7,sentry_key=${dsn.publicKey},sentry_client=intervia/1.0`,
      },
      body: envelope,
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    // 비치명적 — Sentry 자체가 다운된 경우
    log.warn("sentry.send_failed", { reason: e instanceof Error ? e.message : String(e) });
  }
}

async function sendToSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* 비치명적 */
  }
}

export function captureError(err: unknown, context: ErrorContext = {}): void {
  log.error("captured", err, context);
  void sendToSentry(
    err instanceof Error ? err : String(err),
    context,
    "error"
  );
}

export function captureCritical(err: unknown, context: ErrorContext = {}): void {
  log.error("critical", err, context);
  const errMsg = err instanceof Error ? err.message : String(err);
  void sendToSentry(err instanceof Error ? err : errMsg, context, "fatal");
  void sendToSlack(
    `🚨 *Intervia critical*: ${scrubString(errMsg)}\nContext: \`${JSON.stringify(scrubContext(context)).slice(0, 500)}\``
  );
}

/**
 * 전송 완료까지 await 가능한 캡처 — instrumentation `onRequestError` 처럼
 * 응답 후 함수가 동결돼 fire-and-forget 이 잘릴 수 있는 컨텍스트용.
 * (Next 문서 권고: onRequestError 내 async 작업은 await 할 것.)
 */
export async function reportError(
  err: unknown,
  context: ErrorContext = {}
): Promise<void> {
  log.error("captured", err, context);
  await sendToSentry(err instanceof Error ? err : String(err), context, "error");
}

/**
 * 운영 알림 — 예외가 아닌 "느린 장애"(큐 적체·실패율 급증 등) 통지. Slack 으로만 보낸다
 * (Sentry 는 에러 추적용이라 비-에러 지표로 오염시키지 않음). 메일 통지는 호출부(cron)가
 * mailer 로 별도 처리 — 이 모듈은 edge-safe(글로벌 fetch만) 유지해야 하므로 mailer 미import.
 */
export async function notifyOps(text: string): Promise<void> {
  log.warn("ops_alert", { text: text.slice(0, 500) });
  await sendToSlack(`📟 *Intervia 운영 알림*\n${text}`);
}

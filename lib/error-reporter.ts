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
          value: error.message,
          stacktrace: error.stack
            ? {
                frames: error.stack
                  .split("\n")
                  .slice(1, 20)
                  .map((line) => ({ filename: line.trim() })),
              }
            : undefined,
        },
      ],
    },
    extra: context,
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
    `🚨 *Intervia critical*: ${errMsg}\nContext: \`${JSON.stringify(context).slice(0, 500)}\``
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

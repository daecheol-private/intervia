import { captureError } from "@/lib/error-reporter";

export const runtime = "nodejs";

/**
 * 클라이언트 에러 바운더리(app/error.tsx)가 보내는 렌더 크래시 비콘 수신.
 * 서버에서 captureError 로 넘겨 Sentry 전송(+PII 스크럽). 운영에서 클라이언트
 * 페이지가 깨지면 사용자가 신고하기 전에 알림으로 먼저 알게 하는 용도.
 *
 * 인증 없는 same-origin 비콘 — captureError 는 Slack 을 울리지 않고 Sentry 로만
 * 보내므로(=captureCritical 아님) 알림 폭주 위험은 Sentry 자체 quota 로 한정.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      message?: unknown;
      stack?: unknown;
      digest?: unknown;
      url?: unknown;
    };
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.slice(0, 500)
        : "unknown client error";
    const err = new Error(`[client] ${message}`);
    // 클라이언트 stack 을 실어 Sentry 스택트레이스가 서버가 아닌 실제 크래시 프레임을 가리키게 함.
    if (typeof body.stack === "string") err.stack = body.stack.slice(0, 8000);
    captureError(err, {
      source: "client-error-boundary",
      url: typeof body.url === "string" ? body.url.slice(0, 500) : undefined,
      digest: typeof body.digest === "string" ? body.digest : undefined,
    });
  } catch {
    /* 리포팅 실패는 무시 — 비콘은 best-effort */
  }
  return new Response(null, { status: 204 });
}

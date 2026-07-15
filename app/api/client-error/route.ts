import { after } from "next/server";
import { captureError, alertError } from "@/lib/error-reporter";

export const runtime = "nodejs";

/**
 * 클라이언트 에러 바운더리(app/error.tsx)가 보내는 렌더 크래시 비콘 수신.
 * 서버에서 captureError 로 넘겨 Sentry 전송(+PII 스크럽). 운영에서 클라이언트
 * 페이지가 깨지면 사용자가 신고하기 전에 알림으로 먼저 알게 하는 용도.
 *
 * 인증 없는 same-origin 비콘이라 남용(POST 폭탄) 위험이 있어, Sentry 는 전량 전송하되
 * Slack 경보(alertError)는 전역 30분당 1회로 스로틀한다 — 첫 크래시만 즉시 알리고
 * 상세는 Sentry 에서 확인. 폭주 위험은 스로틀 + Sentry 자체 quota 로 이중 한정.
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
    // 화면이 깨진 사용자 — 신고 전에 먼저 인지하도록 Slack 경보(전역 30분당 1회).
    // 공개 비콘이라 url 별로 키를 쪼개지 않고 단일 키로 묶어 남용 시에도 30분 1건 상한.
    after(() =>
      alertError(
        "🖥 화면 오류 — 사용자 페이지 렌더 크래시",
        err,
        "client-error",
        30 * 60_000
      ).catch(() => {})
    );
  } catch {
    /* 리포팅 실패는 무시 — 비콘은 best-effort */
  }
  return new Response(null, { status: 204 });
}

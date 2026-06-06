import type { Instrumentation } from "next";

/**
 * 전역 서버 에러 캡처 (Next 16 instrumentation).
 *
 * Next 가 라우트 핸들러·서버 컴포넌트·cron 핸들러에서 잡은(=처리되지 않은) 모든 예외를
 * 여기로 넘긴다 → Sentry 자동 전송. 이게 없으면 error-reporter 가 audit.ts 한 곳에서만
 * 호출돼 LLM·메일·cron·라우트의 실패가 모니터링에 안 잡히고 Vercel 로그에만 묻혔다.
 * 라우트별 try/catch 추가 없이 한 파일로 전 라우트를 커버한다.
 *
 * - reportError 는 await — onRequestError 는 응답 후 함수가 동결될 수 있어
 *   fire-and-forget 전송이 잘릴 위험이 있다(Next 문서 권고).
 * - error-reporter 는 글로벌 Web Crypto + fetch 만 써서 Node·Edge 양쪽에서 동작.
 * - redirect()/notFound() 등 Next 제어 흐름 throw(digest 가 NEXT_ 로 시작)는 에러가
 *   아니므로 보고에서 제외(노이즈 방지).
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  const digest = (err as { digest?: unknown })?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_")) return;
  try {
    const { reportError } = await import("@/lib/error-reporter");
    await reportError(err, {
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
    });
  } catch {
    // 리포팅 자체 실패가 앱 흐름에 영향 주지 않도록 무시.
  }
};

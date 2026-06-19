"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * 전역 클라이언트 에러 바운더리. app/ 하위 어떤 페이지든 렌더 중 throw 하면
 * (예: Hook 규칙 위반, 예기치 못한 런타임 에러) 빈 "page couldn't load" 대신
 * 이 한글 안내가 뜨고, 동시에 서버로 비콘을 보내 Sentry 알림이 발생한다.
 *
 * Next.js 규약: 같은 세그먼트 layout 은 살아 있고 page 부분만 이 폴백으로 대체된다.
 * reset() 은 해당 세그먼트를 재렌더(일시적 오류면 복구).
 */
export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 콘솔 + 서버 비콘. 비콘은 best-effort (실패해도 UI 에 영향 없음).
    // eslint-disable-next-line no-console
    console.error("[error-boundary]", error);
    try {
      const payload = JSON.stringify({
        message: error?.message,
        stack: error?.stack,
        digest: error?.digest,
        url: typeof window !== "undefined" ? window.location.href : undefined,
      });
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/client-error",
          new Blob([payload], { type: "application/json" })
        );
      } else {
        void fetch("/api/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
    } catch {
      /* 리포팅 실패 무시 */
    }
  }, [error]);

  return (
    <main className="max-w-lg mx-auto w-full px-4 sm:px-6 py-16 sm:py-24">
      <div className="rounded-2xl border border-border-default bg-card p-6 sm:p-8 text-center shadow-sm">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-lg font-bold text-ink">
          일시적인 문제가 발생했습니다
        </h1>
        <p className="mt-2 text-sm text-ink-muted leading-relaxed">
          페이지를 표시하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
          문제가 계속되면 새로고침하거나 대시보드로 돌아가 주세요.
        </p>
        {error?.digest && (
          <p className="mt-2 text-[11px] text-ink-muted">오류 코드: {error.digest}</p>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium"
          >
            다시 시도
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg border border-border-strong text-sm text-ink-soft hover:bg-surface-alt"
          >
            대시보드로
          </Link>
        </div>
      </div>
    </main>
  );
}

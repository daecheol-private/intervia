"use client";

import { useRouter } from "next/navigation";

/**
 * 뒤로가기 링크 — 직전 화면으로 복귀.
 * 히스토리가 있으면 router.back()(예: 이력서 업로드 화면 → 본 페이지 → 뒤로 = 업로드 화면),
 * 직접 URL 접근 등 히스토리가 없으면 fallbackHref 로 이동.
 */
export function BackLink({
  fallbackHref = "/",
  label = "← 뒤로",
  className,
}: {
  fallbackHref?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className={className ?? "text-xs text-ink-muted hover:underline"}
    >
      {label}
    </button>
  );
}

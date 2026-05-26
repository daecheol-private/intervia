"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname() ?? "";
  // 후보자 토큰 페이지에서는 면접/일정 UI 가 viewport 를 꽉 채워야 하므로 푸터 숨김.
  if (
    pathname.startsWith("/interview/") ||
    pathname.startsWith("/schedule/")
  ) {
    return null;
  }
  return (
    <footer className="border-t border-border-default bg-surface-alt mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-ink-soft">
        <div>© {new Date().getFullYear()} Intervia · 대표 강대철</div>
        <div className="flex gap-4">
          <Link href="/privacy" className="hover:text-ink hover:underline">
            개인정보 처리방침
          </Link>
          <Link href="/terms" className="hover:text-ink hover:underline">
            이용약관
          </Link>
          <Link
            href="/legal/ai-evaluation-disclosure"
            className="hover:text-ink hover:underline"
          >
            AI 평가 사전공개
          </Link>
        </div>
      </div>
    </footer>
  );
}

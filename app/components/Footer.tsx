"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COMPANY_INFO } from "@/lib/site-info";

export function Footer({ loggedIn = false }: { loggedIn?: boolean }) {
  const pathname = usePathname() ?? "";
  // 후보자 토큰 페이지에서는 면접/일정/지원 UI 가 viewport 를 꽉 채워야 하므로 푸터 숨김.
  if (
    pathname.startsWith("/interview/") ||
    pathname.startsWith("/schedule/") ||
    pathname.startsWith("/apply/")
  ) {
    return null;
  }
  return (
    <footer className="border-t border-border-default bg-surface-alt mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-ink-soft">
        <div>
          © {new Date().getFullYear()} {COMPANY_INFO.serviceName} · 상호{" "}
          {COMPANY_INFO.name} · 대표 {COMPANY_INFO.representative} · 사업자등록번호{" "}
          {COMPANY_INFO.bizRegistrationNo}
        </div>
        <div className="flex gap-4">
          {loggedIn && (
            <Link href="/support" className="hover:text-ink hover:underline">
              고객센터
            </Link>
          )}
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

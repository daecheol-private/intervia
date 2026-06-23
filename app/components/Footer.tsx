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
    pathname.startsWith("/apply/") ||
    // 후보자 상세·공고 상세(/jobs/<숫자>)는 AppShell 을 쓰므로 전역 푸터 숨김.
    pathname.startsWith("/candidates/") ||
    /^\/jobs\/\d+(\/|$)/.test(pathname)
  ) {
    return null;
  }
  return (
    <footer className="border-t border-border-default bg-surface-alt mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-3 text-xs text-ink-soft">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            © {new Date().getFullYear()} {COMPANY_INFO.serviceName}
          </div>
          <div className="flex gap-4 flex-wrap">
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

        {/* 전자상거래법 §10 사업자 신원정보 — 통신판매(유료) 개시 시 표시 의무.
            통신판매업 신고 후 이 줄에 '통신판매업신고 {번호}' 추가. 전화는 추후 050 교체. */}
        <div className="text-ink-muted leading-relaxed border-t border-border-default pt-3">
          상호 {COMPANY_INFO.name} · 대표 {COMPANY_INFO.representative} · 사업자등록번호{" "}
          {COMPANY_INFO.bizRegistrationNo} · 주소 {COMPANY_INFO.address} · 전화{" "}
          <a
            href={`tel:${COMPANY_INFO.phone.replace(/-/g, "")}`}
            className="hover:text-ink hover:underline"
          >
            {COMPANY_INFO.phone}
          </a>{" "}
          · 이메일{" "}
          <a
            href={`mailto:${COMPANY_INFO.email}`}
            className="hover:text-ink hover:underline"
          >
            {COMPANY_INFO.email}
          </a>
        </div>
      </div>
    </footer>
  );
}

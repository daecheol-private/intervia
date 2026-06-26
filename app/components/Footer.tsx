"use client";

import type { ReactNode } from "react";
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
    pathname.startsWith("/invite/")
  ) {
    return null;
  }
  // AppShell(좌측 레일)을 쓰는 인증 영역에서는 전역 푸터 숨김. 로그인 상태에서만
  // (비로그인이면 공개 랜딩/리다이렉트 대상이라 푸터 유지).
  const usesAppShell =
    pathname === "/" ||
    pathname.startsWith("/candidates/") ||
    pathname.startsWith("/jobs") ||
    pathname.startsWith("/org") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/support");
  if (loggedIn && usesAppShell) {
    return null;
  }
  // 전자상거래법 §10 사업자 신원정보 — 각 항목을 묶어 두어 줄바꿈 시 구분점(·)이
  // 줄 앞에 떨어지지 않게 한다. 통신판매업 신고 후 '통신판매업신고 {번호}' 항목 추가.
  const bizFields: ReactNode[] = [
    `상호 ${COMPANY_INFO.name}`,
    `대표 ${COMPANY_INFO.representative}`,
    `사업자등록번호 ${COMPANY_INFO.bizRegistrationNo}`,
    `통신판매업신고 ${COMPANY_INFO.mailOrderSalesNo}`,
    `주소 ${COMPANY_INFO.address}`,
    <>
      전화{" "}
      <a
        href={`tel:${COMPANY_INFO.phone.replace(/-/g, "")}`}
        className="hover:text-ink hover:underline"
      >
        {COMPANY_INFO.phone}
      </a>
    </>,
    <>
      이메일{" "}
      <a
        href={`mailto:${COMPANY_INFO.email}`}
        className="hover:text-ink hover:underline"
      >
        {COMPANY_INFO.email}
      </a>
    </>,
  ];

  return (
    <footer className="border-t border-border-default bg-surface-alt mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6 text-xs text-ink-soft">
        {/* 상단: 브랜드 + 정책 링크 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-sm font-semibold text-ink">
            {COMPANY_INFO.serviceName}
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
          </nav>
        </div>

        {/* 하단: 사업자 정보 + 저작권 */}
        <div className="flex flex-col gap-2 border-t border-border-default pt-5 text-ink-muted">
          <div className="flex flex-wrap items-center gap-y-1">
            {bizFields.map((field, i) => (
              <span key={i}>
                {i > 0 && (
                  <span aria-hidden className="mx-2 text-border-strong">
                    ·
                  </span>
                )}
                {field}
              </span>
            ))}
          </div>
          <div>
            © {new Date().getFullYear()} {COMPANY_INFO.serviceName}
          </div>
        </div>
      </div>
    </footer>
  );
}

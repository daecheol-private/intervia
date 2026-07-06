"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { COMPANY_INFO, SITE_INFO } from "@/lib/site-info";

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
    pathname.startsWith("/insights") ||
    pathname.startsWith("/jobs") ||
    pathname.startsWith("/org") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/support");
  if (loggedIn && usesAppShell) {
    return null;
  }

  // 사이트맵 3그룹 — 로그인 없이 접근 가능한 공개 링크만 노출.
  //   제품: 랜딩 섹션 앵커가 아니라 독립 상세 페이지로 이동한다
  //         (/how-it-works · /features · /pricing — 각 페이지가 app/ 아래 별도 라우트).
  const productLinks = [
    { label: "작동 방식", href: "/how-it-works" },
    { label: "전체 기능", href: "/features" },
    { label: "요금", href: "/pricing" },
  ];
  const legalLinks = [
    { label: "개인정보 처리방침", href: "/privacy" },
    { label: "이용약관", href: "/terms" },
    { label: "AI 평가 사전공개", href: "/legal/ai-evaluation-disclosure" },
    { label: "보안·데이터 보호", href: "/security" },
    { label: "지원자 동의 템플릿", href: "/legal/applicant-consent-template" },
  ];
  // 지원 — 고객센터는 인증 영역이라 로그인 상태에서만. '무료로 시작하기/로그인'은
  // 랜딩 히어로·헤더에 이미 있어 중복이라 footer 에선 뺀다.
  const supportLinks = [
    { label: "자주 묻는 질문", href: "/faq" },
    { label: "도입 문의", href: `mailto:${COMPANY_INFO.email}` },
    ...(loggedIn ? [{ label: "고객센터", href: "/support" }] : []),
  ];

  // 전자상거래법 §10 사업자 신원정보. 구분점(·)은 각 항목 '뒤'에 붙여, 줄바꿈 시
  // 다음 줄 맨 앞에 구분점이 떨어지지 않게 한다. 통신판매업 신고 후 '통신판매업신고 {번호}' 항목 추가.
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
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-8 text-xs text-ink-soft">
        {/* 상단: 브랜드 + 사이트맵 3그룹 */}
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="sm:max-w-xs">
            <div className="text-base font-bold text-ink">
              {COMPANY_INFO.serviceName}
            </div>
            <p className="mt-2 leading-relaxed text-ink-soft">
              {SITE_INFO.serviceDescription}
            </p>
            <a
              href="https://instagram.com/intervia.kr"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Intervia 인스타그램"
              className="mt-4 inline-flex items-center gap-1.5 text-ink-soft transition-colors hover:text-ink"
            >
              <InstagramIcon className="w-4 h-4" />
              <span className="text-xs">@intervia.kr</span>
            </a>
          </div>
          <nav className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 sm:gap-x-12">
            <FooterColumn title="제품" links={productLinks} />
            <FooterColumn title="회사·정책" links={legalLinks} />
            <FooterColumn title="지원" links={supportLinks} />
          </nav>
        </div>

        {/* 하단: 사업자 정보 + 저작권 */}
        <div className="flex flex-col gap-2 border-t border-border-default pt-6 text-ink-muted">
          <div className="flex flex-wrap items-center gap-y-1">
            {bizFields.map((field, i) => (
              <span key={i}>
                {field}
                {i < bizFields.length - 1 && (
                  <span aria-hidden className="mx-2 text-border-strong">
                    ·
                  </span>
                )}
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

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <div className="mb-3 text-xs font-semibold text-ink">{title}</div>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            <FooterLink href={l.href}>{l.label}</FooterLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  const cls = "text-ink-soft hover:text-ink hover:underline transition-colors";
  // mailto/외부 링크는 <a>, 내부 경로·해시 앵커는 next/link.
  if (href.startsWith("mailto:") || href.startsWith("http")) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

// 인스타그램 글리프 — lucide 1.16 에서 브랜드 아이콘이 제거되어 인라인 SVG 로 유지.
// (lucide 의 옛 Instagram 과 동일한 stroke path — 나머지 아이콘과 톤 일치)
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

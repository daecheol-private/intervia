"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Building2,
  LayoutDashboard,
  Shield,
  ChevronDown,
  Coins,
  Users,
  Users2,
  DollarSign,
  BarChart3,
  ScrollText,
  Lock,
  Scale,
  ShieldCheck,
  Settings,
  Menu,
  X,
  Home,
  LifeBuoy,
  Megaphone,
  Mail,
} from "lucide-react";
import { LogoMark } from "./Logo";
import LogoutButton from "../logout-button";
import { NotificationBell } from "./NotificationBell";

type Role = "system_admin" | "org_admin" | "member" | null;

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

type NavSection = {
  label: string | null; // null = 섹션 헤더 없는 단독 항목 묶음
  items: NavItem[];
};

/**
 * 역할별 메뉴 구성을 한 곳에서 정의 — 데스크톱 드롭다운과 모바일 햄버거가 공유.
 * 메뉴 추가/변경 시 여기만 고치면 양쪽 모두 반영.
 */
function buildSections(role: Role): NavSection[] {
  const sections: NavSection[] = [];
  // 시스템관리자의 홈("/")은 운영 대시보드로 리다이렉트되므로 "대시보드"="운영" 중복.
  // 데스크톱과 동일하게 sysadmin 에겐 "대시보드" 항목을 두지 않고 "운영"만 노출.
  if (role !== "system_admin") {
    sections.push({
      label: null,
      items: [
        { href: "/", label: "대시보드", Icon: Home },
        { href: "/support", label: "고객센터", Icon: LifeBuoy },
      ],
    });
  }
  if (role === "org_admin") {
    sections.push({
      label: "법인",
      items: [
        { href: "/org/dashboard", label: "채용 현황", Icon: BarChart3 },
        { href: "/org/tokens", label: "토큰 지갑", Icon: Coins },
        { href: "/org/members", label: "멤버", Icon: Users },
        { href: "/org/settings", label: "법인 설정", Icon: Settings },
        // 메일 서버 설정은 데스크톱 전용 — 모바일 메뉴에서 숨김
      ],
    });
  }
  if (role === "system_admin") {
    sections.push({
      label: null,
      items: [{ href: "/admin/dashboard", label: "운영", Icon: LayoutDashboard }],
    });
    sections.push({
      label: "관리",
      items: [
        { href: "/admin/orgs", label: "법인", Icon: Building2 },
        { href: "/admin/users", label: "사용자", Icon: Users2 },
        { href: "/admin/candidates", label: "후보자", Icon: Users },
        { href: "/admin/announcements", label: "공지", Icon: Megaphone },
        { href: "/admin/marketing", label: "마케팅 메일", Icon: Mail },
        { href: "/admin/pricing", label: "단가", Icon: DollarSign },
        { href: "/admin/metrics", label: "메트릭", Icon: BarChart3 },
        { href: "/admin/audit", label: "감사 로그", Icon: ScrollText },
        { href: "/admin/appeals", label: "이의제기", Icon: Scale },
        { href: "/admin/inquiries", label: "문의함", Icon: LifeBuoy },
        { href: "/admin/locks", label: "잠금", Icon: Lock },
      ],
    });
  }
  return sections;
}

export function NavBar({
  userName,
  isAdmin,
  role,
  isDev,
}: {
  userName: string | null;
  isAdmin: boolean;
  role: Role;
  isDev: boolean;
}) {
  const pathname = usePathname() ?? "";
  // 외부 후보자 토큰 페이지(/interview/*, /schedule/*) 에서는 네비바 숨김.
  // 로그인한 HR 이 우연히 같은 브라우저로 방문해도 후보자 입장의 화면을 보장.
  if (
    pathname.startsWith("/interview/") ||
    pathname.startsWith("/schedule/") ||
    pathname.startsWith("/unsubscribe/")
  ) {
    return null;
  }
  // "법인"(/org/*) 드롭다운은 자기 소속 법인을 운영하는 org_admin 전용.
  // 시스템관리자는 전체 법인을 "관리 > 법인"(/admin/orgs)에서 통제하므로 제외 — 메뉴 중복 방지.
  const canManageOrg = role === "org_admin";
  const isSystemAdmin = role === "system_admin";

  return (
    <header className="sticky top-0 z-40 bg-card/85 backdrop-blur border-b border-border-default">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/"
            aria-label="Intervia 대시보드"
            title="대시보드"
            className="flex items-center gap-2 group"
          >
            <LogoMark size={32} />
            <span className="font-semibold text-ink group-hover:text-primary transition-colors tracking-tight">
              Intervia
            </span>
          </Link>
          {isDev && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-warning-soft text-warning border border-warning/20 uppercase tracking-wide">
              개발 환경
            </span>
          )}
        </div>

        {userName ? (
          <>
            {/* 데스크톱 (≥ sm): 기존 가로 메뉴 */}
            <div className="hidden sm:flex items-center gap-1.5">
              {canManageOrg && (
                <Dropdown
                  label="법인"
                  Icon={Building2}
                  items={[
                    { href: "/org/dashboard", label: "채용 현황", Icon: BarChart3 },
                    { href: "/org/tokens", label: "토큰 지갑", Icon: Coins },
                    { href: "/org/members", label: "멤버", Icon: Users },
                    // 메일 서버·줌 연동은 법인 설정 > 외부 연동으로 이동 (첫 화면 단순화)
                    { href: "/org/settings", label: "법인 설정", Icon: Settings },
                    { href: "/support", label: "고객센터", Icon: LifeBuoy },
                  ]}
                />
              )}
              {isSystemAdmin && (
                <>
                  <NavLink
                    href="/admin/dashboard"
                    label="운영"
                    Icon={LayoutDashboard}
                  />
                  <Dropdown
                    label="관리"
                    Icon={Shield}
                    items={[
                      { href: "/admin/orgs", label: "법인", Icon: Building2 },
                      { href: "/admin/users", label: "사용자", Icon: Users2 },
                      { href: "/admin/candidates", label: "후보자", Icon: Users },
                      { href: "/admin/announcements", label: "공지", Icon: Megaphone },
                      { href: "/admin/marketing", label: "마케팅 메일", Icon: Mail },
                      { href: "/admin/pricing", label: "단가", Icon: DollarSign },
                      { href: "/admin/metrics", label: "메트릭", Icon: BarChart3 },
                      { href: "/admin/audit", label: "감사 로그", Icon: ScrollText },
                      { href: "/admin/appeals", label: "이의제기", Icon: Scale },
                      { href: "/admin/inquiries", label: "문의함", Icon: LifeBuoy },
                      { href: "/admin/locks", label: "잠금", Icon: Lock },
                    ]}
                  />
                </>
              )}
              <NotificationBell />
              <ProfilePill userName={userName} isAdmin={isAdmin} />
              <LogoutButton />
            </div>

            {/* 모바일 (< sm): 알림벨 + 햄버거 */}
            <div className="flex sm:hidden items-center gap-1">
              <NotificationBell />
              <MobileMenu
                userName={userName}
                isAdmin={isAdmin}
                sections={buildSections(role)}
                currentPath={pathname}
              />
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}

function MobileMenu({
  userName,
  isAdmin,
  sections,
  currentPath,
}: {
  userName: string;
  isAdmin: boolean;
  sections: NavSection[];
  currentPath: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 포털 대상(document.body)은 클라이언트에서만 — SSR 가드
  useEffect(() => {
    setMounted(true);
  }, []);

  // 라우트 변경 시 자동 닫기 (Link 클릭 후)
  useEffect(() => {
    setOpen(false);
  }, [currentPath]);

  // 패널 열렸을 때: body 스크롤 잠금 + Esc 닫기 + 초기 포커스 이동 + 간단 포커스 트랩
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 패널 내 첫 포커스 가능한 요소로 포커스 이동 (F-1)
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    // 다음 프레임에 포커스 — 포털 마운트 직후
    const t = setTimeout(() => focusables()[0]?.focus(), 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // Tab 트랩 — 패널 경계에서 순환
      if (e.key === "Tab") {
        const els = focusables();
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="메뉴 열기"
        aria-expanded={open}
        className="flex items-center justify-center w-9 h-9 rounded-lg text-ink-soft hover:text-ink hover:bg-surface-alt transition-colors"
      >
        <Menu className="w-5 h-5" />
      </button>

      {open && mounted &&
        createPortal(
        <div className="fixed inset-0 z-[100] sm:hidden">
          {/* 배경 오버레이 */}
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* 슬라이드 패널 */}
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="메뉴"
            className="absolute right-0 top-0 h-full w-[82%] max-w-[320px] bg-card shadow-xl flex flex-col pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-between h-14 px-4 border-b border-border-default">
              <span className="font-semibold text-ink tracking-tight">메뉴</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="메뉴 닫기"
                className="flex items-center justify-center w-9 h-9 rounded-lg text-ink-soft hover:text-ink hover:bg-surface-alt transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 프로필 */}
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-border-default hover:bg-surface-alt transition-colors"
            >
              <span className="w-9 h-9 rounded-full bg-primary-soft text-primary-deep flex items-center justify-center text-sm font-bold shrink-0">
                {initial}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink truncate">
                  {userName}
                </span>
                <span className="block text-xs text-ink-muted">계정 설정</span>
              </span>
              {isAdmin && (
                <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-ink text-surface tracking-wide shrink-0">
                  <ShieldCheck className="w-3 h-3" />
                  ADMIN
                </span>
              )}
            </Link>

            {/* 메뉴 항목 */}
            <nav className="flex-1 overflow-y-auto py-2">
              {sections.map((section, i) => (
                <div key={i} className="py-1">
                  {section.label && (
                    <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      {section.label}
                    </div>
                  )}
                  {section.items.map((it) => {
                    const active =
                      it.href === "/"
                        ? currentPath === "/"
                        : currentPath.startsWith(it.href);
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        onClick={() => setOpen(false)}
                        className={
                          "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors " +
                          (active
                            ? "text-primary font-semibold bg-primary-soft/50"
                            : "text-ink-soft hover:bg-surface-alt hover:text-ink")
                        }
                      >
                        <it.Icon className="w-4 h-4 shrink-0" />
                        <span>{it.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>

            {/* 로그아웃 */}
            <div className="p-4 border-t border-border-default">
              <LogoutButton variant="full" />
            </div>
          </div>
        </div>,
          document.body
        )}
    </>
  );
}

function NavLink({
  href,
  label,
  Icon,
  highlight,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors " +
        (highlight
          ? "text-primary font-semibold hover:bg-primary-soft"
          : "text-ink-soft hover:text-ink hover:bg-surface-alt")
      }
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </Link>
  );
}

type DropdownItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

function Dropdown({
  label,
  Icon,
  items,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  items: DropdownItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${label} 메뉴 열기`}
        title={`${label} 메뉴`}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-ink-soft hover:text-ink hover:bg-surface-alt transition-colors"
      >
        <Icon className="w-4 h-4" />
        <span>{label}</span>
        <ChevronDown
          className={
            "w-3.5 h-3.5 transition-transform " + (open ? "rotate-180" : "")
          }
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 min-w-[180px] bg-card border border-border-default rounded-xl shadow-lg py-1 overflow-hidden"
        >
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-soft hover:bg-surface-alt hover:text-ink"
            >
              <it.Icon className="w-4 h-4 shrink-0 text-ink-muted" />
              <span>{it.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfilePill({
  userName,
  isAdmin,
}: {
  userName: string;
  isAdmin: boolean;
}) {
  const initial = userName.trim().charAt(0).toUpperCase() || "?";
  return (
    <Link
      href="/account"
      title="계정 설정"
      className="flex items-center gap-2 px-2 py-1 ml-1 rounded-lg text-sm text-ink hover:bg-surface-alt transition-colors"
    >
      <span className="w-6 h-6 rounded-full bg-primary-soft text-primary-deep flex items-center justify-center text-[11px] font-bold">
        {initial}
      </span>
      <span className="hidden sm:inline">{userName}</span>
      {isAdmin && (
        <span
          title="시스템 관리자"
          className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-ink text-surface tracking-wide"
        >
          <ShieldCheck className="w-3 h-3" />
          ADMIN
        </span>
      )}
    </Link>
  );
}

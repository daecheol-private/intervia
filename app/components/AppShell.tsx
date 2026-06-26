"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home,
  CalendarClock,
  BarChart3,
  ClipboardList,
  Coins,
  Users,
  Settings,
  LifeBuoy,
  Building2,
  LayoutDashboard,
  Users2,
  Megaphone,
  Mail,
  DollarSign,
  ScrollText,
  Scale,
  Lock,
  Bell,
  Menu,
  ChevronLeft,
  Ticket,
} from "lucide-react";
import { LogoMark } from "./Logo";

type Role = "system_admin" | "org_admin" | "member" | null;

type NavItem = {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};
type NavSection = { label: string | null; items: NavItem[] };

/**
 * 좌측 레일 메뉴 — 역할별. 실제 존재하는 라우트에만 매핑한다(깨진 링크 방지).
 */
function buildSections(role: Role): NavSection[] {
  const sections: NavSection[] = [];
  if (role !== "system_admin") {
    sections.push({
      label: null,
      items: [
        { href: "/", label: "대시보드", Icon: Home },
        // 내 면접 공고 — 면접관으로 지정된 공고만(멤버도 확인 가능)
        { href: "/jobs?mine=1", label: "내 면접 공고", Icon: ClipboardList },
        // 공고를 가로지르는 뷰 — member=면접관 공고, org_admin=법인 전체(페이지에서 차등)
        { href: "/candidates", label: "후보자", Icon: Users },
        { href: "/interviews", label: "면접 일정", Icon: CalendarClock },
      ],
    });
  }
  if (role === "org_admin") {
    sections.push({
      label: "법인",
      items: [
        { href: "/org/tokens", label: "토큰 지갑", Icon: Coins },
        { href: "/org/members", label: "멤버", Icon: Users },
        { href: "/org/settings", label: "법인 설정", Icon: Settings },
      ],
    });
  }
  if (role === "system_admin") {
    sections.push({
      label: null,
      items: [
        { href: "/admin/dashboard", label: "운영", Icon: LayoutDashboard },
      ],
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
        { href: "/admin/coupons", label: "쿠폰", Icon: Ticket },
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

function isActive(pathname: string, href: string): boolean {
  // 쿼리스트링(예: /jobs?mine=1)은 경로 비교에서 제외 — pathname 엔 쿼리가 없다.
  const base = href.split("?")[0];
  return base === "/" ? pathname === "/" : pathname.startsWith(base);
}

const navItemClass = (active: boolean, collapsed = false) =>
  "flex items-center rounded-lg text-sm transition-colors " +
  (collapsed ? "justify-center px-0 py-2 " : "gap-2.5 px-3 py-2 ") +
  (active
    ? "bg-primary-soft text-primary-deep font-semibold"
    : "text-ink-soft hover:bg-surface-alt hover:text-ink");

/** 알림 — 사이드바 항목 + 미확인 배지(60초 폴링). 클릭 시 /notifications 전체 페이지. */
function NavNotifications({
  pathname,
  onNavigate,
  collapsed = false,
}: {
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const fetchCount = async () => {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { unread?: number };
        if (alive) setUnread(d.unread ?? 0);
      } catch {
        /* ignore */
      }
    };
    void fetchCount();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void fetchCount();
    }, 60_000);
    const onFocus = () => void fetchCount();
    window.addEventListener("focus", onFocus);
    window.addEventListener("intervia:notifications-refresh", onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("intervia:notifications-refresh", onFocus);
    };
  }, []);
  return (
    <Link
      href="/notifications"
      onClick={onNavigate}
      title={collapsed ? "알림" : undefined}
      className={
        navItemClass(isActive(pathname, "/notifications"), collapsed) +
        (collapsed ? " relative" : "")
      }
    >
      <Bell className="w-[18px] h-[18px] shrink-0" />
      {collapsed ? (
        unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center tabular-nums leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )
      ) : (
        <>
          <span className="flex-1">알림</span>
          {unread > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center tabular-nums leading-none">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </>
      )}
    </Link>
  );
}

/** 하단 사용자 메뉴 — 아바타·이름·역할. 클릭하면 계정 설정(로그아웃 포함)으로 이동. */
function UserMenu({
  userName,
  role,
  isAdmin,
  onNavigate,
  collapsed = false,
}: {
  userName: string;
  role: Role;
  isAdmin: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const initial = userName.trim().charAt(0).toUpperCase() || "?";
  const roleLabel = isAdmin
    ? "system_admin"
    : role === "org_admin"
      ? "org_admin"
      : "member";
  return (
    <Link
      href="/account"
      onClick={onNavigate}
      title={collapsed ? `${userName} · 계정 설정` : "계정 설정"}
      className={
        "w-full flex items-center rounded-lg hover:bg-surface-alt transition-colors " +
        (collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-3 py-2")
      }
    >
      <span className="w-7 h-7 rounded-full bg-primary-soft text-primary-deep flex items-center justify-center text-[11px] font-bold shrink-0">
        {initial}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 text-left leading-tight">
            <span className="block text-[13px] font-medium text-ink truncate">
              {userName}
            </span>
            <span className="block text-[10px] text-ink-muted">{roleLabel}</span>
          </span>
          <Settings className="w-4 h-4 text-ink-muted shrink-0" />
        </>
      )}
    </Link>
  );
}

function SidebarInner({
  role,
  userName,
  isAdmin,
  isDev,
  pathname,
  onNavigate,
  collapsed = false,
}: {
  role: Role;
  userName: string;
  isAdmin: boolean;
  isDev: boolean;
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const sections = buildSections(role);
  return (
    <div className="flex flex-col h-full">
      <div
        className={
          "flex items-center py-4 " +
          (collapsed ? "justify-center px-0" : "gap-2 px-3")
        }
      >
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2"
          aria-label="Intervia 대시보드"
        >
          <LogoMark size={28} />
          {!collapsed && (
            <span className="font-bold text-ink tracking-tight">Intervia</span>
          )}
        </Link>
        {isDev && !collapsed && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-warning-soft text-warning border border-warning/20 uppercase tracking-wide">
            DEV
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <nav className="flex flex-col gap-1">
          {sections.map((section, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              {section.label &&
                (collapsed ? (
                  i > 0 && <div className="mx-2 my-1 border-t border-border-default" />
                ) : (
                  <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                    {section.label}
                  </div>
                ))}
              {section.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={onNavigate}
                  title={collapsed ? it.label : undefined}
                  aria-current={isActive(pathname, it.href) ? "page" : undefined}
                  className={navItemClass(isActive(pathname, it.href), collapsed)}
                >
                  <it.Icon className="w-[18px] h-[18px] shrink-0" />
                  {!collapsed && <span className="truncate">{it.label}</span>}
                </Link>
              ))}
            </div>
          ))}
          <div className="flex flex-col gap-0.5 mt-1 pt-1 border-t border-border-default">
            <NavNotifications
              pathname={pathname}
              onNavigate={onNavigate}
              collapsed={collapsed}
            />
            <Link
              href="/support"
              onClick={onNavigate}
              title={collapsed ? "고객센터" : undefined}
              className={navItemClass(isActive(pathname, "/support"), collapsed)}
            >
              <LifeBuoy className="w-[18px] h-[18px] shrink-0" />
              {!collapsed && <span>고객센터</span>}
            </Link>
          </div>
        </nav>
      </div>

      <div className="px-2 pb-2 pt-2 border-t border-border-default">
        <UserMenu
          userName={userName}
          role={role}
          isAdmin={isAdmin}
          onNavigate={onNavigate}
          collapsed={collapsed}
        />
      </div>
    </div>
  );
}

/**
 * 인증 영역 전용 앱 셸 — 좌측 레일 네비(상단 로고 / 알림·고객센터 / 하단 사용자 메뉴).
 * 상단 유틸바는 두지 않는다 — 콘텐츠가 페이지 헤더(뒤로가기 등)를 직접 렌더한다.
 * 모바일은 햄버거용 슬림 상단바만. 셸을 쓰는 라우트에서는 전역 NavBar/Footer 를 숨긴다.
 */
export function AppShell({
  userName,
  role,
  isAdmin,
  isDev,
  defaultCollapsed = false,
  children,
}: {
  userName: string;
  role: Role;
  isAdmin: boolean;
  isDev: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);
  // 초기값은 서버가 쿠키로 넘겨준다 — 첫 렌더부터 올바른 너비라 깜빡임 없음.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // 접힘 상태는 쿠키로 유지 — 서버가 다음 렌더에서 같은 값을 읽어 넘긴다.
  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `iv_rail_collapsed=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });

  return (
    <div className="flex min-h-screen bg-surface">
      {/* 데스크톱 좌측 레일 — 인쇄 시 숨김(공고 리포트 PDF 가 셸 없이 출력되도록) */}
      <aside
        className={
          "hidden lg:flex print:hidden sticky top-0 h-screen shrink-0 flex-col bg-card border-r border-border-default transition-[width] duration-200 ease-in-out " +
          (collapsed ? "w-[64px]" : "w-[228px]")
        }
      >
        <SidebarInner
          role={role}
          userName={userName}
          isAdmin={isAdmin}
          isDev={isDev}
          pathname={pathname}
          collapsed={collapsed}
        />
        {/* 세로 구분자에 살짝 튀어나온 토글 손잡이 — 클릭 시 아이콘만 남기고 접기/펼치기 */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          aria-expanded={!collapsed}
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className="absolute top-1/2 -right-3 -translate-y-1/2 z-10 flex items-center justify-center w-3 h-14 rounded-r-md bg-card border border-l-0 border-border-default text-ink-muted shadow-sm hover:text-ink hover:bg-surface-alt transition-colors"
        >
          <ChevronLeft
            className={
              "w-3 h-3 transition-transform duration-200 " +
              (collapsed ? "rotate-180" : "")
            }
          />
        </button>
      </aside>

      {/* 모바일 드로어 */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-0 h-full w-[260px] bg-card shadow-xl">
            <SidebarInner
              role={role}
              userName={userName}
              isAdmin={isAdmin}
              isDev={isDev}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* 본문 영역 — data-iv-content-area: 사이드바 접힘 시 폭이 변하는 컨테이너. 본문이 max-w
          에 걸려 재중앙정렬만 될 때 위치 변화를 감지하려는 자손(예: 후보자 세로 탭 레일)이 관찰한다. */}
      <div data-iv-content-area className="flex-1 flex flex-col min-w-0">
        {/* 모바일 전용 상단바 — 햄버거 + 로고 (데스크톱은 좌측 레일이 상시 노출이라 불필요) */}
        <header className="lg:hidden print:hidden sticky top-0 z-30 flex items-center gap-2 px-4 h-14 bg-card/90 backdrop-blur border-b border-border-default">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="메뉴 열기"
            className="flex items-center justify-center w-9 h-9 -ml-1 rounded-lg text-ink-soft hover:bg-surface-alt"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <LogoMark size={24} />
            <span className="font-bold text-ink tracking-tight">Intervia</span>
          </Link>
        </header>

        <main className="flex-1 flex flex-col min-w-0">{children}</main>
      </div>
    </div>
  );
}

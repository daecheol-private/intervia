"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Building2,
  LayoutDashboard,
  Shield,
  ChevronDown,
  Coins,
  Users,
  UserPlus,
  Mail,
  Users2,
  DollarSign,
  BarChart3,
  ScrollText,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { LogoMark } from "./Logo";
import LogoutButton from "../logout-button";
import { NotificationBell } from "./NotificationBell";

type Role = "system_admin" | "org_admin" | "member" | null;

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
    pathname.startsWith("/schedule/")
  ) {
    return null;
  }
  const canManageOrg = role === "system_admin" || role === "org_admin";
  const isSystemAdmin = role === "system_admin";

  return (
    <header className="sticky top-0 z-40 bg-card/85 backdrop-blur border-b border-border-default">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/" className="flex items-center gap-2 group">
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
          <div className="flex items-center gap-1.5">
            {canManageOrg && (
              <Dropdown
                label="법인"
                Icon={Building2}
                items={[
                  { href: "/org/tokens", label: "토큰 지갑", Icon: Coins },
                  { href: "/org/members", label: "멤버", Icon: Users },
                  { href: "/org/join-requests", label: "합류 요청", Icon: UserPlus },
                  { href: "/org/smtp", label: "메일 서버", Icon: Mail },
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
                    { href: "/admin/pricing", label: "단가", Icon: DollarSign },
                    { href: "/admin/metrics", label: "메트릭", Icon: BarChart3 },
                    { href: "/admin/audit", label: "감사 로그", Icon: ScrollText },
                    { href: "/admin/locks", label: "잠금", Icon: Lock },
                  ]}
                />
              </>
            )}
            <NotificationBell />
            <ProfilePill userName={userName} isAdmin={isAdmin} />
            <LogoutButton />
          </div>
        ) : null}
      </div>
    </header>
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

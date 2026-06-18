"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  Bell,
  MessageSquare,
  UserPlus,
  Coins,
  Building2,
  AlertTriangle,
  CheckCheck,
  Megaphone,
  LifeBuoy,
  Reply,
  type LucideIcon,
} from "lucide-react";

type NotificationType =
  | "ai_interview_done"
  | "round1_decision"
  | "join_request"
  | "low_balance"
  | "new_org"
  | "candidate_appeal"
  | "announcement"
  | "new_inquiry"
  | "inquiry_replied";

type Notification = {
  id: number;
  type: NotificationType;
  title: string;
  href: string;
  readAt: string | null;
  createdAt: string;
};

const ICON_MAP: Record<NotificationType, LucideIcon> = {
  ai_interview_done: MessageSquare,
  round1_decision: CheckCheck,
  join_request: UserPlus,
  low_balance: Coins,
  new_org: Building2,
  candidate_appeal: AlertTriangle,
  announcement: Megaphone,
  new_inquiry: LifeBuoy,
  inquiry_replied: Reply,
};

const POLL_MS = 60_000; // 60초마다 폴링

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { items: Notification[]; unread: number };
      setItems(d.items);
      setUnread(d.unread);
    } catch {
      /* ignore */
    }
  }, []);

  // 초기 로드 + 폴링 + 창 포커스 시 즉시 갱신 + 'intervia:notifications-refresh' 커스텀 이벤트
  useEffect(() => {
    void fetchNotifications();
    // 백그라운드 탭은 스킵 — focus 핸들러가 복귀 시 즉시 갱신한다.
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void fetchNotifications();
    }, POLL_MS);
    const onFocus = () => void fetchNotifications();
    const onRefresh = () => void fetchNotifications();
    window.addEventListener("focus", onFocus);
    window.addEventListener("intervia:notifications-refresh", onRefresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("intervia:notifications-refresh", onRefresh);
    };
  }, [fetchNotifications]);

  // 외부 클릭 / Esc 닫기
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

  // 드롭다운 열릴 때 신선한 데이터 한 번 더
  useEffect(() => {
    if (open) void fetchNotifications();
  }, [open, fetchNotifications]);

  const handleItemClick = async (n: Notification) => {
    setOpen(false);
    if (!n.readAt) {
      // optimistic update
      setItems((arr) =>
        arr.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))
      );
      setUnread((c) => Math.max(0, c - 1));
      void fetch(`/api/notifications/${n.id}/read`, { method: "POST" });
    }
  };

  const handleReadAll = async () => {
    setLoading(true);
    setItems((arr) => arr.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await fetch("/api/notifications/read-all", { method: "POST" });
    setLoading(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`알림${unread > 0 ? ` (미확인 ${unread})` : ""}`}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-ink-soft hover:text-ink hover:bg-surface-alt transition-colors"
      >
        <Bell className="w-[18px] h-[18px]" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center tabular-nums leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-[360px] max-w-[calc(100vw-32px)] bg-card border border-border-default rounded-xl shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-default">
            <div className="text-sm font-semibold text-ink">알림</div>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={handleReadAll}
                  disabled={loading}
                  className="text-[11px] text-ink-soft hover:text-primary hover:underline disabled:opacity-50"
                >
                  모두 읽음
                </button>
              )}
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="text-[11px] text-ink-soft hover:text-primary hover:underline"
              >
                전체 보기
              </Link>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3.5 py-10 text-center text-xs text-ink-muted">
                새 알림이 없습니다.
              </div>
            ) : (
              <ul>
                {items.map((n) => {
                  const Icon = ICON_MAP[n.type] ?? Bell;
                  const isUnread = !n.readAt;
                  return (
                    <li key={n.id}>
                      <Link
                        href={n.href}
                        onClick={() => handleItemClick(n)}
                        className={
                          "flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-surface-alt border-b border-border-default/50 last:border-0 " +
                          (isUnread ? "bg-primary-soft/40" : "")
                        }
                      >
                        <span
                          className={
                            "shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center " +
                            (isUnread
                              ? "bg-primary text-white"
                              : "bg-surface-alt text-ink-muted")
                          }
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className={
                              "text-sm leading-snug whitespace-pre-line " +
                              (isUnread ? "text-ink font-medium" : "text-ink-soft")
                            }
                          >
                            {n.title}
                          </div>
                          <div className="text-[11px] text-ink-muted mt-0.5">
                            {formatRelative(n.createdAt)}
                          </div>
                        </div>
                        {isUnread && (
                          <span
                            aria-hidden
                            className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-primary"
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  // SQLite CURRENT_TIMESTAMP 형식: 'YYYY-MM-DD HH:MM:SS' (UTC). new Date 파싱을 위해 'T' + 'Z' 보정.
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "방금 전";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}일 전`;
  return d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

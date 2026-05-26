import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listMyNotifications } from "@/lib/notifications";
import { ReadAllButton } from "./read-all-button";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login?next=/notifications");
  const items = await listMyNotifications(me.id, 100);
  const unread = items.filter((i) => !i.readAt).length;

  return (
    <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">알림</h1>
          <p className="text-sm text-ink-soft mt-1">
            최근 100건. 클릭하면 해당 항목으로 이동합니다.
          </p>
        </div>
        {unread > 0 && <ReadAllButton />}
      </div>

      {items.length === 0 ? (
        <div className="bg-card border border-border-default rounded-2xl p-12 text-center text-sm text-ink-muted">
          새 알림이 없습니다.
        </div>
      ) : (
        <ul className="bg-card border border-border-default rounded-2xl overflow-hidden">
          {items.map((n) => {
            const isUnread = !n.readAt;
            return (
              <li
                key={n.id}
                className="border-b border-border-default/60 last:border-0"
              >
                <Link
                  href={n.href}
                  className={
                    "flex items-start gap-3 px-5 py-4 hover:bg-surface-alt " +
                    (isUnread ? "bg-primary-soft/30" : "")
                  }
                >
                  <span
                    aria-hidden
                    className={
                      "shrink-0 mt-2 w-2 h-2 rounded-full " +
                      (isUnread ? "bg-primary" : "bg-transparent")
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div
                      className={
                        "text-sm leading-snug " +
                        (isUnread ? "text-ink font-medium" : "text-ink-soft")
                      }
                    >
                      {n.title}
                    </div>
                    <div className="text-[11px] text-ink-muted mt-1">
                      {formatAbsolute(n.createdAt)}
                    </div>
                  </div>
                  <span className="text-xs text-ink-muted shrink-0">
                    {n.readAt ? "읽음" : "미확인"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

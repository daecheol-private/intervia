"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone, Bell } from "lucide-react";

export default function AdminAnnouncementsPage() {
  const [title, setTitle] = useState("");
  const [href, setHref] = useState("");
  const [activeUsers, setActiveUsers] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [sentCount, setSentCount] = useState<number | null>(null);

  // 예상 수신자(활성 사용자) 수 — 발송 전 확인용.
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/admin/announcements", { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { activeUsers: number };
          setActiveUsers(d.activeUsers);
        }
      } catch {
        /* 비치명적 — 수만 못 보일 뿐 발송은 가능 */
      }
    })();
  }, []);

  const send = async () => {
    setErr("");
    setSentCount(null);
    const t = title.trim();
    const h = href.trim();
    if (t.length < 2) {
      setErr("공지 내용은 2자 이상 입력하세요.");
      return;
    }
    if (h && !h.startsWith("/")) {
      setErr("링크는 '/' 로 시작하는 내부 경로만 입력하세요. (예: /org/tokens)");
      return;
    }
    const count = activeUsers ?? 0;
    if (
      !confirm(
        `전체 활성 사용자${count ? ` ${count}명` : ""}에게 공지 알림을 발송합니다.\n\n"${t}"\n\n발송 후에는 회수할 수 없습니다. 진행하시겠습니까?`
      )
    )
      return;

    setSending(true);
    let res: Response;
    try {
      res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, href: h || undefined }),
      });
    } catch {
      setSending(false);
      setErr("네트워크 오류로 발송하지 못했습니다.");
      return;
    }
    setSending(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const d = (await res.json()) as { sent: number };
    setSentCount(d.sent);
    setTitle("");
    setHref("");
  };

  return (
    <main className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/admin/dashboard" className="text-xs text-slate-500 hover:underline">
          ← 운영 대시보드
        </Link>
        <div className="flex items-center gap-2.5 mt-2">
          <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary-deep flex items-center justify-center shrink-0">
            <Megaphone className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">공지 발송</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              전체 활성 사용자에게 알림을 보냅니다. 알림 벨과 알림 목록에 표시됩니다.
            </p>
          </div>
        </div>
      </div>

      {sentCount !== null && (
        <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
          공지를 <strong>{sentCount}명</strong>에게 발송했습니다.
        </div>
      )}
      {err && (
        <div className="mb-4 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3.5 py-2.5">
          {err}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            공지 내용 <span className="text-danger">*</span>
          </label>
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            rows={3}
            placeholder="예) 6/10(화) 02:00~03:00 시스템 점검이 예정되어 있습니다."
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="text-[11px] text-slate-400 mt-1 text-right">
            {title.length}/200
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            연결 링크 <span className="text-slate-400 font-normal">(선택)</span>
          </label>
          <input
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="/org/tokens (미입력 시 알림 목록으로 이동)"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            클릭 시 이동할 내부 경로. 보안상 <code>/</code> 로 시작하는 경로만 가능합니다.
          </p>
        </div>

        {/* 미리보기 — 알림 벨에 보일 모습 */}
        {title.trim() && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
              미리보기
            </div>
            <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
              <span className="shrink-0 mt-0.5 w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center">
                <Megaphone className="w-3.5 h-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-snug text-slate-900 font-medium break-words whitespace-pre-line">
                  {title.trim()}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">방금 전</div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
          <span className="text-xs text-slate-500 inline-flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" />
            예상 수신자{" "}
            <strong className="text-slate-700">
              {activeUsers === null ? "…" : `${activeUsers}명`}
            </strong>{" "}
            (활성 사용자 전원)
          </span>
          <button
            onClick={send}
            disabled={sending || title.trim().length < 2}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-deep disabled:opacity-50 font-medium"
          >
            {sending ? "발송 중…" : "공지 발송"}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
        · 발송 시점의 활성 사용자에게만 전달됩니다(이후 가입자는 받지 않음). · 발송 후 회수
        기능은 없습니다 — 내용을 확인하고 보내세요. · 읽은 공지는 30일 후 자동 정리됩니다.
      </p>
    </main>
  );
}

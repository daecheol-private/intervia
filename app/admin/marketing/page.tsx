"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Mail, Send, Trash2 } from "lucide-react";

type Recipient = {
  id: number;
  email: string;
  status: "active" | "unsubscribed";
  lastSentAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminMarketingPage() {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/marketing", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { recipients: Recipient[] };
        setRows(d.recipients);
      }
    } catch {
      /* 목록 로드 실패 — 새로고침으로 복구 */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = rows.filter((r) => r.status === "active").length;
  const unsubCount = rows.length - activeCount;

  const add = async () => {
    setErr("");
    setNotice("");
    if (!emails.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      const d = (await r.json()) as {
        added: number;
        skipped: number;
        invalid: number;
      };
      setNotice(
        `${d.added}명 등록 완료` +
          (d.skipped ? ` · 중복 ${d.skipped}건 제외` : "") +
          (d.invalid ? ` · 형식 오류 ${d.invalid}건 제외` : "")
      );
      setEmails("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const send = async (ids?: number[]) => {
    setErr("");
    setNotice("");
    const count = ids ? ids.length : activeCount;
    if (count === 0) {
      setErr("발송할 수신자가 없습니다.");
      return;
    }
    if (
      !confirm(
        `${count}명에게 브로셔 메일을 발송합니다.\n제목: (광고) Intervia — ...\n\n진행하시겠습니까?`
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      const d = (await r.json()) as {
        sent: number;
        failed: Array<{ email: string; error: string }>;
        remaining: number;
      };
      let msg = `${d.sent}명 발송 완료`;
      if (d.failed.length)
        msg += ` · 실패 ${d.failed.length}건 (${d.failed
          .map((f) => f.email)
          .join(", ")})`;
      if (d.remaining > 0)
        msg += ` · 남은 ${d.remaining}명은 "전체 발송"을 다시 눌러 이어서 발송하세요.`;
      setNotice(msg);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Recipient) => {
    if (!confirm(`${r.email} 을(를) 목록에서 삭제합니까?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/marketing", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id }),
      });
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link
          href="/admin/dashboard"
          className="text-xs text-slate-500 hover:underline"
        >
          ← 운영 대시보드
        </Link>
        <div className="flex items-center gap-2.5 mt-2">
          <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary-deep flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">마케팅 메일</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              수신자를 등록하고 Intervia 소개 브로셔를 발송합니다. 수신거부는
              메일 하단 링크로 자동 처리됩니다.
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
          {notice}
        </div>
      )}
      {err && (
        <div className="mb-4 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3.5 py-2.5">
          {err}
        </div>
      )}

      {/* 수신자 등록 */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6 mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          수신자 등록
        </label>
        <textarea
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          rows={3}
          placeholder={"hr@company-a.co.kr\nrecruit@company-b.com (줄바꿈·쉼표로 여러 개 입력)"}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex items-center justify-between mt-3">
          <p className="text-[11px] text-slate-400">
            중복·형식 오류는 자동으로 걸러집니다. 한 번에 최대 500개.
          </p>
          <button
            onClick={add}
            disabled={busy || !emails.trim()}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-deep disabled:opacity-50 font-medium"
          >
            등록
          </button>
        </div>
      </div>

      {/* 목록 + 발송 */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="text-sm text-slate-600">
            수신 가능 <strong className="text-slate-900">{activeCount}</strong>명
            · 수신거부{" "}
            <strong className="text-slate-900">{unsubCount}</strong>명
          </div>
          <button
            onClick={() => send()}
            disabled={busy || activeCount === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-deep disabled:opacity-50 font-medium"
          >
            <Send className="w-3.5 h-3.5" />
            {busy ? "처리 중…" : `전체 발송 (${activeCount}명)`}
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-10">
            등록된 수신자가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 px-5 py-3 text-sm"
              >
                <span
                  className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                    r.status === "active"
                      ? "bg-primary-soft text-primary-deep"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {r.status === "active" ? "수신중" : "수신거부"}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    r.status === "active"
                      ? "text-slate-900"
                      : "text-slate-400 line-through"
                  }`}
                >
                  {r.email}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                  {r.status === "unsubscribed"
                    ? `거부 ${fmtDate(r.unsubscribedAt)}`
                    : r.lastSentAt
                      ? `발송 ${fmtDate(r.lastSentAt)}`
                      : "미발송"}
                </span>
                {r.status === "active" && (
                  <button
                    onClick={() => send([r.id])}
                    disabled={busy}
                    title="이 수신자에게 발송"
                    className="shrink-0 p-1.5 rounded-md text-primary hover:bg-primary-soft disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => remove(r)}
                  disabled={busy}
                  title="삭제"
                  className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-danger hover:bg-danger-soft disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
        · 제목에 <code>(광고)</code>가 자동으로 붙습니다 (정보통신망법). · 본문
        템플릿은 <code>lib/marketing-brochure.ts</code> 에서 수정합니다 — 발송
        전 푸터의 회사 정보를 채워주세요. · 수신거부한 주소는 발송 대상에서
        자동 제외되며, 재발송하지 마세요.
      </p>
    </main>
  );
}

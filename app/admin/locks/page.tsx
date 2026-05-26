"use client";

import { useCallback, useEffect, useState } from "react";

type Lock = {
  identifier: string;
  kind: "email" | "ip";
  failCount: number;
  oldestAt: string;
};

export default function AdminLocksPage() {
  const [rows, setRows] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const res = await fetch("/api/admin/locks");
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setRows(await res.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unlock = async (l: Lock) => {
    const key = l.kind + ":" + l.identifier;
    setBusy(key);
    const body = l.kind === "email" ? { email: l.identifier } : { ip: l.identifier };
    const res = await fetch("/api/admin/locks/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy("");
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    await load();
  };

  return (
    <main className="flex-1 p-6 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-bold text-slate-900 mb-1">계정 잠금 관리</h1>
        <p className="text-sm text-slate-500 mb-4">
          로그인 5회 이상 실패한 이메일 또는 IP. 운영자 확인 후 강제 해제 가능.
        </p>

        {err && (
          <div className="text-sm text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-3">
            {err}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-6 text-sm text-slate-400">불러오는 중...</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">현재 잠긴 계정/IP가 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">구분</th>
                  <th className="px-4 py-2">식별자</th>
                  <th className="px-4 py-2">실패 횟수</th>
                  <th className="px-4 py-2">최초 실패</th>
                  <th className="px-4 py-2 text-right">조치</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = r.kind + ":" + r.identifier;
                  return (
                    <tr key={key} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        <span
                          className={
                            "text-xs px-2 py-0.5 rounded-full " +
                            (r.kind === "email"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-rose-50 text-rose-700 border border-rose-200")
                          }
                        >
                          {r.kind === "email" ? "이메일" : "IP"}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{r.identifier}</td>
                      <td className="px-4 py-2">{r.failCount}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{r.oldestAt} UTC</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => unlock(r)}
                          disabled={busy === key}
                          className="text-xs bg-primary hover:bg-primary-deep disabled:opacity-50 text-white px-3 py-1 rounded"
                        >
                          {busy === key ? "처리 중..." : "잠금 해제"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}

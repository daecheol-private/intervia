"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type JoinRequest = {
  id: number;
  orgId: number;
  userId: number;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  userEmail: string;
  userName: string;
  orgName: string;
};

export default function JoinRequestsPage() {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">(
    "pending"
  );
  const [rows, setRows] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const res = await fetch(`/api/orgs/join-requests?status=${filter}`);
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setRows(await res.json());
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: number, action: "approve" | "reject") => {
    setBusyId(id);
    const res = await fetch(`/api/orgs/join-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    // 헤더 알림 배지 즉시 재조회 — 서버에서 관련 join_request 알림을 읽음 처리했으므로
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("intervia:notifications-refresh"));
    }
    void load();
  };

  return (
    <main className="max-w-4xl mx-auto w-full px-6 py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">합류 요청 관리</h1>
        <p className="text-sm text-slate-500 mt-1">
          법인에 합류를 요청한 사용자를 승인하거나 거절합니다.
        </p>
      </div>

      <div className="flex gap-2 mb-4">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-lg border ${
              filter === s
                ? "bg-primary text-white border-primary-deep"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {s === "pending" ? "대기" : s === "approved" ? "승인됨" : "거절됨"}
          </button>
        ))}
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
        {loading && <div className="p-6 text-sm text-slate-400">불러오는 중...</div>}
        {!loading && rows.length === 0 && (
          <div className="p-6 text-sm text-slate-400">요청이 없습니다.</div>
        )}
        {rows.map((r) => (
          <div key={r.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium text-slate-900">
                {r.userName}{" "}
                <span className="text-xs text-slate-500">{r.userEmail}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {r.orgName} · {new Date(r.createdAt).toLocaleString("ko-KR")}
              </div>
            </div>
            {r.status === "pending" ? (
              <div className="flex gap-2">
                <button
                  onClick={() => decide(r.id, "approve")}
                  disabled={busyId === r.id}
                  className="px-3 py-1.5 text-xs bg-primary hover:bg-primary-deep text-white rounded-lg disabled:opacity-50"
                >
                  승인
                </button>
                <button
                  onClick={() => decide(r.id, "reject")}
                  disabled={busyId === r.id}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg disabled:opacity-50"
                >
                  거절
                </button>
              </div>
            ) : (
              <span
                className={`text-xs px-2 py-1 rounded ${
                  r.status === "approved"
                    ? "bg-primary-soft text-primary-deep"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {r.status === "approved" ? "승인됨" : "거절됨"}
              </span>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Member = {
  id: number;
  email: string;
  name: string;
  role: "system_admin" | "org_admin" | "member";
  status: "active" | "pending" | "disabled";
  createdAt: string;
  orgName: string | null;
};

export default function OrgMembersPage() {
  const [rows, setRows] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const res = await fetch("/api/orgs/members");
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

  const update = async (
    id: number,
    body: { role?: Member["role"]; status?: "active" | "disabled" }
  ) => {
    setBusyId(id);
    setErr("");
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    void load();
  };

  return (
    <main className="max-w-5xl mx-auto w-full px-6 py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">법인 멤버 관리</h1>
        <p className="text-sm text-slate-500 mt-1">
          멤버 권한을 부여하거나 비활성화할 수 있습니다.
        </p>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">이름</th>
              <th className="text-left px-4 py-3 font-medium">이메일</th>
              <th className="text-left px-4 py-3 font-medium">권한</th>
              <th className="text-left px-4 py-3 font-medium">상태</th>
              <th className="text-right px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                  불러오는 중...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                  멤버가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{m.name}</td>
                <td className="px-4 py-3 text-slate-600">{m.email}</td>
                <td className="px-4 py-3">
                  <RoleBadge role={m.role} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={m.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 justify-end">
                    {m.role === "member" && m.status === "active" && (
                      <button
                        onClick={() => update(m.id, { role: "org_admin" })}
                        disabled={busyId === m.id}
                        className={btnPrimary}
                      >
                        관리자 부여
                      </button>
                    )}
                    {m.role === "org_admin" && (
                      <button
                        onClick={() => update(m.id, { role: "member" })}
                        disabled={busyId === m.id}
                        className={btnSecondary}
                      >
                        일반으로
                      </button>
                    )}
                    {m.status === "active" && m.role !== "system_admin" && (
                      <button
                        onClick={() => {
                          if (confirm(`${m.name} 님을 비활성화합니다.`))
                            void update(m.id, { status: "disabled" });
                        }}
                        disabled={busyId === m.id}
                        className={btnDanger}
                      >
                        비활성화
                      </button>
                    )}
                    {m.status === "disabled" && (
                      <button
                        onClick={() => update(m.id, { status: "active" })}
                        disabled={busyId === m.id}
                        className={btnSecondary}
                      >
                        활성화
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function RoleBadge({ role }: { role: Member["role"] }) {
  const map = {
    system_admin: { label: "시스템 관리자", cls: "bg-amber-50 text-amber-700" },
    org_admin: { label: "법인 관리자", cls: "bg-primary-soft text-primary-deep" },
    member: { label: "일반", cls: "bg-slate-100 text-slate-700" },
  };
  const { label, cls } = map[role];
  return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}

function StatusBadge({ status }: { status: Member["status"] }) {
  const map = {
    active: { label: "활성", cls: "bg-primary-soft text-primary-deep" },
    pending: { label: "승인대기", cls: "bg-amber-50 text-amber-700" },
    disabled: { label: "비활성", cls: "bg-slate-100 text-slate-500" },
  };
  const { label, cls } = map[status];
  return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}

const btnPrimary =
  "px-2.5 py-1 text-xs bg-primary hover:bg-primary-deep text-white rounded disabled:opacity-50";
const btnSecondary =
  "px-2.5 py-1 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded disabled:opacity-50";
const btnDanger =
  "px-2.5 py-1 text-xs bg-danger-soft border border-danger/30 hover:bg-danger-soft/70 text-danger rounded disabled:opacity-50 transition-colors";

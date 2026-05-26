"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Member = {
  id: number;
  name: string;
  email: string;
  role: "system_admin" | "org_admin" | "member";
  status: "active" | "pending" | "disabled";
};

export default function TransferAdminForm({
  orgId,
  members,
}: {
  orgId: number;
  members: Member[];
}) {
  const router = useRouter();
  const currentAdmins = members.filter(
    (m) => m.role === "org_admin" && m.status === "active"
  );
  const candidates = members.filter(
    (m) => m.role !== "system_admin" && m.status === "active"
  );

  const [toUserId, setToUserId] = useState<number | "">("");
  const [fromUserId, setFromUserId] = useState<number | "">(
    currentAdmins[0]?.id ?? ""
  );
  const [demoteFrom, setDemoteFrom] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!toUserId) {
      setErr("새 관리자(toUser)를 선택하세요.");
      return;
    }
    if (reason.trim().length < 5) {
      setErr("이전 사유는 5자 이상 입력하세요.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/admin/orgs/${orgId}/transfer-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toUserId,
        fromUserId: demoteFrom && fromUserId ? fromUserId : null,
        reason: reason.trim(),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    alert("관리자 이전 완료. 감사 로그에 기록되었습니다.");
    router.push("/admin/orgs");
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          새 관리자 (org_admin 으로 승격)
        </label>
        <select
          value={toUserId}
          onChange={(e) =>
            setToUserId(e.target.value ? Number(e.target.value) : "")
          }
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">선택...</option>
          {candidates.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} &lt;{m.email}&gt; ({m.role})
            </option>
          ))}
        </select>
      </div>

      <div className="border-t border-slate-100 pt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={demoteFrom}
            onChange={(e) => setDemoteFrom(e.target.checked)}
          />
          기존 관리자를 member 로 강등
        </label>
        {demoteFrom && (
          <select
            value={fromUserId}
            onChange={(e) =>
              setFromUserId(e.target.value ? Number(e.target.value) : "")
            }
            className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">선택...</option>
            {currentAdmins.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} &lt;{m.email}&gt;
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          이전 사유 (5자+, 감사 로그)
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="예: 기존 관리자 퇴사 - 후임자에게 이전"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        />
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="flex-1 bg-primary hover:bg-primary-deep disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg"
        >
          이전 실행
        </button>
      </div>
    </div>
  );
}

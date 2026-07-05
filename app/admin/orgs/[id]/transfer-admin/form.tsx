"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Member = {
  id: number;
  name: string;
  email: string;
  role: "system_admin" | "org_admin" | "member";
  status: "active" | "pending" | "disabled";
  emailVerifiedAt: string | null;
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
  // 승격 대상: system_admin 제외 + disabled 아닌 모두 (active + pending).
  // pending = 담당자 공석 법인에 합류 요청을 넣고 대기 중인 신청자 — 이 화면이 유일한 승계
  // 경로이므로 대상에 포함한다. 승격 시 서버가 활성화 + 이메일 인증까지 함께 처리한다.
  const candidates = members.filter(
    (m) => m.role !== "system_admin" && m.status !== "disabled"
  );

  const [toUserId, setToUserId] = useState<number | "">("");
  const [fromUserId, setFromUserId] = useState<number | "">(
    currentAdmins[0]?.id ?? ""
  );
  const [demoteFrom, setDemoteFrom] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const selectedPending =
    candidates.find((m) => m.id === toUserId)?.status === "pending";

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
    <div className="bg-card border border-border-default rounded-2xl shadow-sm p-6 space-y-4">
      <div>
        <label className="block text-sm font-medium text-ink-soft mb-1.5">
          새 관리자 (org_admin 으로 승격)
        </label>
        <select
          value={toUserId}
          onChange={(e) =>
            setToUserId(e.target.value ? Number(e.target.value) : "")
          }
          className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm bg-card"
        >
          <option value="">선택...</option>
          {candidates.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} &lt;{m.email}&gt;
              {m.status === "pending"
                ? m.emailVerifiedAt
                  ? " — 합류 승인 대기 (이메일 인증됨)"
                  : " — 합류 승인 대기 (이메일 미인증)"
                : ` (${m.role})`}
            </option>
          ))}
        </select>
        {selectedPending && (
          <p className="mt-1.5 text-[11px] text-warning">
            이 신청자는 <strong>합류 승인 대기(pending)</strong> 상태입니다. 승격하면 계정이 즉시
            활성화·이메일 인증 처리되어 바로 로그인할 수 있으니, 신원·재직을 먼저 확인하세요.
          </p>
        )}
      </div>

      <div className="border-t border-border-default pt-4">
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
            className="mt-2 w-full border border-border-strong rounded-lg px-3 py-2 text-sm bg-card"
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

      <div className="border-t border-border-default pt-4">
        <label className="block text-sm font-medium text-ink-soft mb-1.5">
          이전 사유 (5자+, 감사 로그)
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="예: 기존 관리자 퇴사 - 후임자에게 이전"
          className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm bg-card"
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
          className="flex-1 bg-primary hover:bg-primary-deep disabled:opacity-50 text-surface text-sm font-medium py-2.5 rounded-lg"
        >
          이전 실행
        </button>
      </div>
    </div>
  );
}

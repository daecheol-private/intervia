"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useStepUpFetch } from "@/app/components/StepUpModal";
import { formatLocalDateTime } from "@/lib/utils";

type Order = {
  id: number;
  amountKrw: number;
  tokens: number;
  status: "pending" | "paid" | "failed" | "cancelled";
  provider: string | null;
  providerRef: string | null;
  createdAt: string;
  byName: string | null;
  byEmail: string | null;
};

const STATUS: Record<Order["status"], { label: string; cls: string }> = {
  pending: { label: "대기", cls: "bg-surface-alt text-ink-muted border-border-strong" },
  paid: { label: "결제완료", cls: "bg-success-soft text-success border-success/30" },
  failed: { label: "실패", cls: "bg-danger-soft text-danger border-danger/30" },
  cancelled: { label: "취소됨", cls: "bg-warning-soft text-warning border-warning/30" },
};

export default function AdminOrgPaymentsPage() {
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const [orgName, setOrgName] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const { ensureFetch, modal: stepUpModal } = useStepUpFetch();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/orgs/${orgId}/payments`);
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const data = await res.json();
    setOrgName(data.orgName ?? "");
    setOrders(data.orders ?? []);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (o: Order) => {
    const reason = prompt(
      `결제 #${o.id} (${o.amountKrw.toLocaleString()}원) 을 취소·환불합니다.\n\n` +
        `· 카드사로 ${o.amountKrw.toLocaleString()}원이 실제 환불됩니다.\n` +
        `· 지급했던 ${o.tokens.toLocaleString()} 토큰이 회수됩니다 (이미 사용했으면 잔액이 음수가 될 수 있음).\n\n` +
        `사유 (5자 이상, 감사 로그 기록):`
    );
    if (reason === null) return;
    if (reason.trim().length < 5) {
      setErr("환불 사유는 5자 이상 입력하세요.");
      return;
    }
    setErr("");
    setBusy(o.id);
    let res: Response;
    try {
      res = await ensureFetch(
        `/api/admin/payments/${o.id}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
        `결제 #${o.id} (${o.amountKrw.toLocaleString()}원) 을 카드사로 환불하고 ${o.tokens.toLocaleString()} 토큰을 회수합니다.`
      );
    } catch {
      setBusy(null);
      return; // step-up 취소
    }
    setBusy(null);
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("application/json")
      ? await res.json()
      : { ok: false, message: await res.text() };
    if (!res.ok || !data.ok) {
      setErr(data.message || "결제 취소에 실패했습니다.");
      return;
    }
    alert(
      `환불 완료 — ${data.refundedKrw.toLocaleString()}원 카드 환불, ${data.reversedTokens.toLocaleString()} 토큰 회수. 잔액 ${data.balance.toLocaleString()} 토큰.`
    );
    void load();
  };

  return (
    <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {stepUpModal}
      <div className="mb-6">
        <Link href="/admin/orgs" className="text-xs text-ink-muted hover:underline">
          ← 법인 관리
        </Link>
        <h1 className="text-2xl font-bold text-ink mt-2">
          결제 내역{orgName ? ` — ${orgName}` : ""}
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          토큰 충전 결제 내역. 결제완료 건은 카드 환불(전액)할 수 있습니다.
        </p>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-surface-alt text-ink-soft text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">일시</th>
                <th className="text-right px-4 py-2.5 font-medium">금액</th>
                <th className="text-right px-4 py-2.5 font-medium">토큰</th>
                <th className="text-left px-4 py-2.5 font-medium">상태</th>
                <th className="text-left px-4 py-2.5 font-medium">결제자</th>
                <th className="text-right px-4 py-2.5 font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {loading && (
                <tr>
                  <td className="px-4 py-6 text-ink-muted" colSpan={6}>
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && orders.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-ink-muted" colSpan={6}>
                    결제 내역이 없습니다.
                  </td>
                </tr>
              )}
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2.5 text-xs text-ink-muted">
                    {formatLocalDateTime(o.createdAt, {
                      format: { second: "2-digit" },
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {o.amountKrw.toLocaleString()}원
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-soft">
                    {o.tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${STATUS[o.status].cls}`}
                    >
                      {STATUS[o.status].label}
                    </span>
                  </td>
                  <td
                    className="px-4 py-2.5 text-xs text-ink-soft"
                    title={o.byEmail ?? undefined}
                  >
                    {o.byName || "-"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {o.status === "paid" ? (
                      <button
                        onClick={() => cancel(o)}
                        disabled={busy !== null}
                        className="px-2.5 py-1 text-xs bg-card border border-warning/40 hover:bg-warning-soft text-warning rounded disabled:opacity-50"
                      >
                        {busy === o.id ? "처리 중..." : "환불"}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

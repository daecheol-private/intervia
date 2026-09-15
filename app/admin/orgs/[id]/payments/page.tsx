"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useStepUpFetch } from "@/app/components/StepUpModal";
import { formatLocalDateTime } from "@/lib/utils";
import { withVat } from "@/lib/beta";

type Order = {
  id: number;
  amountKrw: number;
  tokens: number;
  status: "pending" | "paid" | "failed" | "cancelled";
  provider: string | null;
  providerRef: string | null;
  depositNotifiedAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
  byName: string | null;
  byEmail: string | null;
};

type Result = {
  ok?: boolean;
  message?: string;
  granted?: boolean;
  tokens?: number;
  balance?: number | null;
  refundedKrw?: number;
  reversedTokens?: number;
  manualRefund?: boolean;
};

const STATUS: Record<Order["status"], { label: string; cls: string }> = {
  pending: { label: "대기", cls: "bg-surface-alt text-ink-muted border-border-strong" },
  paid: { label: "결제완료", cls: "bg-success-soft text-success border-success/30" },
  failed: { label: "실패", cls: "bg-danger-soft text-danger border-danger/30" },
  cancelled: { label: "취소됨", cls: "bg-warning-soft text-warning border-warning/30" },
};

const isTransfer = (o: Order) => o.provider === "transfer";

function statusBadge(o: Order): { label: string; cls: string } {
  if (!isTransfer(o)) return STATUS[o.status];
  if (o.status === "pending")
    return o.depositNotifiedAt
      ? { label: "확인 요청됨", cls: "bg-warning-soft text-warning border-warning/30" }
      : { label: "입금 대기", cls: STATUS.pending.cls };
  if (o.status === "paid") return { label: "입금확인", cls: STATUS.paid.cls };
  return STATUS[o.status];
}

async function readResult(res: Response): Promise<Result> {
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json")
    ? ((await res.json()) as Result)
    : { ok: false, message: await res.text() };
}

export default function AdminOrgPaymentsPage() {
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const [orgName, setOrgName] = useState("");
  const [orgBizNo, setOrgBizNo] = useState<string | null>(null);
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
    setOrgBizNo(data.orgBizNo ?? null);
    setOrders(data.orders ?? []);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (o: Order, url: string, init: RequestInit, stepUpMessage: string) => {
    setErr("");
    setBusy(o.id);
    let res: Response;
    try {
      res = await ensureFetch(url, init, stepUpMessage);
    } catch {
      setBusy(null);
      return null; // step-up 취소
    }
    setBusy(null);
    const data = await readResult(res);
    if (!res.ok || !data.ok) {
      setErr(data.message || "처리에 실패했습니다.");
      return null;
    }
    return data;
  };

  const confirmDeposit = async (o: Order) => {
    const pay = withVat(o.amountKrw).toLocaleString();
    if (
      !confirm(
        `주문 #${o.id} — 입금자명 IV${o.id}, ${pay}원 입금을 통장에서 확인했나요?\n\n` +
          `확인하면 ${o.tokens.toLocaleString()} 토큰이 바로 지급되고 고객에게 충전 완료 메일이 갑니다.`
      )
    )
      return;
    const data = await run(
      o,
      `/api/admin/payments/${o.id}/confirm-transfer`,
      { method: "POST" },
      `주문 #${o.id} (${pay}원) 입금을 확인하고 ${o.tokens.toLocaleString()} 토큰을 지급합니다.`
    );
    if (!data) return;
    alert(
      data.granted
        ? `입금확인 완료 — ${(data.tokens ?? o.tokens).toLocaleString()} 토큰 지급. 법인 잔액 ${(data.balance ?? 0).toLocaleString()} 토큰.`
        : "이미 입금확인된 주문입니다."
    );
    void load();
  };

  const cancel = async (o: Order) => {
    const pay = withVat(o.amountKrw).toLocaleString();
    const transfer = isTransfer(o);
    const guide = !transfer
      ? `결제 #${o.id} (${pay}원) 을 취소·환불합니다.\n\n` +
        `· 카드사로 ${pay}원이 실제 환불됩니다.\n` +
        `· 지급했던 ${o.tokens.toLocaleString()} 토큰이 회수됩니다 (이미 사용했으면 잔액이 음수가 될 수 있음).\n\n`
      : o.status === "pending"
        ? `계좌이체 신청 #${o.id} (${pay}원) 을 취소합니다. 입금 전이라 지급·회수할 토큰은 없습니다.\n\n`
        : `계좌이체 #${o.id} (${pay}원) 을 취소합니다.\n\n` +
          `· 자동 환불이 없습니다 — 고객 계좌로 ${pay}원을 직접 송금해 환불해 주세요.\n` +
          `· 지급했던 ${o.tokens.toLocaleString()} 토큰이 회수됩니다 (이미 사용했으면 잔액이 음수가 될 수 있음).\n\n`;
    const reason = prompt(`${guide}사유 (5자 이상, 감사 로그 기록):`);
    if (reason === null) return;
    if (reason.trim().length < 5) {
      setErr("사유는 5자 이상 입력하세요.");
      return;
    }
    const data = await run(
      o,
      `/api/admin/payments/${o.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      },
      transfer
        ? `계좌이체 #${o.id} (${pay}원) 을 취소합니다.`
        : `결제 #${o.id} (${pay}원) 을 카드사로 환불하고 ${o.tokens.toLocaleString()} 토큰을 회수합니다.`
    );
    if (!data) return;
    const balance = data.balance != null ? ` 잔액 ${data.balance.toLocaleString()} 토큰.` : "";
    alert(
      !transfer
        ? `환불 완료 — ${(data.refundedKrw ?? 0).toLocaleString()}원 카드 환불, ${(data.reversedTokens ?? 0).toLocaleString()} 토큰 회수.${balance}`
        : data.manualRefund
          ? `취소 완료 — ${(data.reversedTokens ?? 0).toLocaleString()} 토큰 회수.${balance}\n고객 계좌로 ${(data.refundedKrw ?? 0).toLocaleString()}원을 직접 송금해 주세요.`
          : "계좌이체 신청을 취소했습니다."
    );
    void load();
  };

  const hasPaidTransfer = orders.some((o) => isTransfer(o) && o.status === "paid");

  return (
    <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {stepUpModal}
      <div className="mb-6">
        <Link href="/admin/orgs" className="text-xs text-ink-muted hover:underline">
          ← 법인 관리
        </Link>
        <h1 className="text-2xl font-bold text-ink mt-2">
          결제 내역{orgName ? ` — ${orgName}` : ""}
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          토큰 충전 결제 내역. 카드 결제는 환불, 계좌이체는 입금확인·취소를 할 수 있습니다.
        </p>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      {hasPaidTransfer && (
        <div className="mb-4 rounded-2xl border border-border-default bg-card px-4 py-3 text-xs text-ink-soft">
          <div className="text-sm font-semibold text-ink mb-1">세금계산서 발행 정보 (계좌이체)</div>
          <div>
            상호 <strong className="text-ink">{orgName || "-"}</strong> · 사업자등록번호{" "}
            <strong className="text-ink">{orgBizNo ?? "미등록 — 고객에게 요청"}</strong>
          </div>
          <div className="mt-1 text-ink-muted">
            공급가액 = 주문 금액, 세액 = 10%. 홈택스에서 발행한 뒤 신청자 메일(결제자에 마우스를 올리면 표시)로 보내 주세요.
          </div>
        </div>
      )}

      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-surface-alt text-ink-soft text-xs">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">일시</th>
                <th className="text-left px-4 py-2.5 font-medium">수단</th>
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
                  <td className="px-4 py-6 text-ink-muted" colSpan={7}>
                    불러오는 중...
                  </td>
                </tr>
              )}
              {!loading && orders.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-ink-muted" colSpan={7}>
                    결제 내역이 없습니다.
                  </td>
                </tr>
              )}
              {orders.map((o) => {
                const badge = statusBadge(o);
                const transfer = isTransfer(o);
                return (
                  <tr key={o.id}>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">
                      {formatLocalDateTime(o.createdAt, {
                        format: { second: "2-digit" },
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">
                      {transfer ? "계좌이체" : "카드"}
                      {transfer && (
                        <div className="text-[11px] text-ink-muted">입금자명 IV{o.id}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {withVat(o.amountKrw).toLocaleString()}원
                      {transfer && (
                        <div className="text-[11px] text-ink-muted">
                          공급가 {o.amountKrw.toLocaleString()} · 세액{" "}
                          {(withVat(o.amountKrw) - o.amountKrw).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-soft">
                      {o.tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                      {transfer && o.status === "pending" && o.depositNotifiedAt && (
                        <div className="text-[11px] text-ink-muted mt-0.5">
                          요청 {formatLocalDateTime(o.depositNotifiedAt)}
                        </div>
                      )}
                      {o.confirmedBy && (
                        <div className="text-[11px] text-ink-muted mt-0.5">
                          {o.confirmedBy.startsWith("slack:") ? "Slack" : "관리자 화면"}에서 확인
                        </div>
                      )}
                    </td>
                    <td
                      className="px-4 py-2.5 text-xs text-ink-soft"
                      title={o.byEmail ?? undefined}
                    >
                      {o.byName || "-"}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {transfer && o.status === "pending" ? (
                        <div className="inline-flex gap-1.5">
                          <button
                            onClick={() => confirmDeposit(o)}
                            disabled={busy !== null}
                            className="px-2.5 py-1 text-xs bg-primary hover:bg-primary-deep text-surface rounded disabled:opacity-50"
                          >
                            {busy === o.id ? "처리 중..." : "입금확인"}
                          </button>
                          <button
                            onClick={() => cancel(o)}
                            disabled={busy !== null}
                            className="px-2.5 py-1 text-xs bg-card border border-border-strong hover:bg-surface-alt text-ink-soft rounded disabled:opacity-50"
                          >
                            취소
                          </button>
                        </div>
                      ) : o.status === "paid" ? (
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

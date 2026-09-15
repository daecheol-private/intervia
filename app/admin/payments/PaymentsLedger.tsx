"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { buttonClass } from "@/app/components/ui";
import { formatLocalDate, formatLocalDateTime } from "@/lib/utils";

type View = "paid" | "invoice" | "all";

type Row = {
  id: number;
  orgId: number;
  orgName: string | null;
  orgBizNo: string | null;
  amountKrw: number;
  payKrw: number;
  vatKrw: number;
  tokens: number;
  status: "pending" | "paid" | "failed" | "cancelled";
  provider: string | null;
  createdAt: string;
  paidAt: string | null;
  depositNotifiedAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  taxInvoiceIssuedAt: string | null;
  byName: string | null;
  byEmail: string | null;
};

type Totals = {
  count: number;
  payKrw: number;
  supplyKrw: number;
  vatKrw: number;
  cardPayKrw: number;
  transferPayKrw: number;
  refundedCount: number;
  invoicePending: number;
  invoicePendingAll: number;
};

const TABS: Array<[View, string]> = [
  ["paid", "결제 완료"],
  ["invoice", "세금계산서"],
  ["all", "전체 기록"],
];

const thisMonth = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(
    new Date()
  );

function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const won = (n: number) => `${n.toLocaleString()}원`;
const isTransfer = (r: Row) => r.provider === "transfer";

function statusLabel(r: Row): string {
  if (r.status === "cancelled") return r.paidAt ? "환불" : "취소";
  if (r.status === "paid") return isTransfer(r) ? "입금확인" : "결제완료";
  if (r.status === "pending")
    return isTransfer(r) ? (r.depositNotifiedAt ? "확인 요청됨" : "입금 대기") : "결제 대기";
  return "실패";
}

function evidenceLabel(r: Row): string {
  if (!r.paidAt) return "-";
  if (!isTransfer(r)) return "카드 매출전표";
  return r.taxInvoiceIssuedAt ? "세금계산서 발행" : "세금계산서 미발행";
}

export function PaymentsLedger({ initialView }: { initialView: View }) {
  const [month, setMonth] = useState(thisMonth);
  const [view, setView] = useState<View>(initialView);
  const [data, setData] = useState<{ totals: Totals; orders: Row[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/payments?month=${month}&view=${view}`);
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setErr("");
    setData(await res.json());
  }, [month, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleInvoice = async (r: Row, issued: boolean) => {
    setBusyId(r.id);
    const res = await fetch(`/api/admin/payments/${r.id}/tax-invoice`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issued }),
    });
    setBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    void load();
  };

  const downloadCsv = () => {
    if (!data) return;
    const header = [
      "결제일시", "법인", "사업자등록번호", "결제자", "이메일", "수단", "주문번호",
      "공급가", "세액", "합계", "토큰", "상태", "증빙", "세금계산서 발행일",
    ];
    const lines = data.orders.map((r) => [
      r.paidAt ? formatLocalDateTime(r.paidAt) : "",
      r.orgName ?? "",
      r.orgBizNo ?? "",
      r.byName ?? "",
      r.byEmail ?? "",
      isTransfer(r) ? "계좌이체" : "카드",
      `IV${r.id}`,
      r.amountKrw,
      r.vatKrw,
      r.payKrw,
      r.tokens,
      statusLabel(r),
      evidenceLabel(r),
      r.taxInvoiceIssuedAt ? formatLocalDate(r.taxInvoiceIssuedAt) : "",
    ]);
    const cell = (v: string | number) => {
      const s = String(v);
      // 엑셀 수식 주입 방지 — =,+,-,@ 로 시작하는 문자열은 텍스트로 고정
      const safe = typeof v === "string" && /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = "﻿" + [header, ...lines].map((cols) => cols.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `intervia-payments-${month}-${view}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [y, mo] = month.split("-").map(Number);
  const t = data?.totals;

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">결제·세금계산서</h1>
          <p className="text-sm text-ink-muted mt-1">
            전 법인 토큰 충전 결제 내역입니다. 카드는 카드 매출전표가 증빙이라 세금계산서를 따로
            발행하지 않고, 계좌이체는 홈택스에서 발행한 뒤 체크해 둡니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="이전 달"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="rounded-md border border-border-default bg-card p-1.5 text-ink-soft hover:bg-surface-alt"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="min-w-[6.5rem] text-center text-sm font-semibold text-ink tabular-nums">
            {y}년 {mo}월
          </span>
          <button
            type="button"
            aria-label="다음 달"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="rounded-md border border-border-default bg-card p-1.5 text-ink-soft hover:bg-surface-alt"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={!data || data.orders.length === 0}
            className={buttonClass({ size: "sm", variant: "secondary" })}
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>
      </div>

      {t && (
        <div className="mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="결제 합계 (VAT 포함)"
            value={won(t.payKrw)}
            sub={`${t.count}건${t.refundedCount ? ` · 환불 ${t.refundedCount}건 제외` : ""}`}
          />
          <Stat label="공급가액" value={won(t.supplyKrw)} sub={`세액 ${won(t.vatKrw)}`} />
          <Stat label="카드" value={won(t.cardPayKrw)} sub={`계좌이체 ${won(t.transferPayKrw)}`} />
          <Stat
            label="세금계산서 미발행"
            value={`${t.invoicePendingAll}건`}
            sub={t.invoicePendingAll > 0 ? `이번 달 ${t.invoicePending}건` : "모두 발행됨"}
            warn={t.invoicePendingAll > 0}
          />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {TABS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              view === v
                ? "border-primary bg-primary text-surface"
                : "border-border-default bg-card text-ink-soft hover:bg-surface-alt"
            }`}
          >
            {label}
            {v === "invoice" && t && t.invoicePendingAll > 0 ? ` · 미발행 ${t.invoicePendingAll}` : ""}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ink-muted">
          {view === "invoice"
            ? "입금확인된 계좌이체 — 미발행 건은 달과 관계없이 모두 표시"
            : view === "all"
              ? "입금 대기·결제 실패 포함 모든 주문"
              : "카드 승인·계좌이체 입금확인이 된 결제"}
        </span>
      </div>

      {err && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {err}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border-default bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface-alt text-xs text-ink-soft whitespace-nowrap">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">결제일시</th>
                <th className="px-4 py-2.5 text-left font-medium">법인</th>
                <th className="px-4 py-2.5 text-left font-medium">결제자</th>
                <th className="px-4 py-2.5 text-left font-medium">수단</th>
                <th className="px-4 py-2.5 text-right font-medium">금액</th>
                <th className="px-4 py-2.5 text-right font-medium">토큰</th>
                <th className="px-4 py-2.5 text-left font-medium">상태</th>
                <th className="px-4 py-2.5 text-left font-medium">증빙</th>
                <th className="px-4 py-2.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {loading && !data && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-ink-muted">
                    불러오는 중...
                  </td>
                </tr>
              )}
              {data && data.orders.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-ink-muted">
                    {view === "invoice" ? "발행할 세금계산서가 없습니다." : "이 달의 결제 내역이 없습니다."}
                  </td>
                </tr>
              )}
              {data?.orders.map((r) => (
                <tr key={r.id} className={r.status === "cancelled" ? "text-ink-muted" : undefined}>
                  <td className="px-4 py-2.5 text-xs text-ink-soft whitespace-nowrap">
                    {formatLocalDateTime(r.paidAt ?? r.createdAt)}
                    {!r.paidAt && <div className="text-[11px] text-ink-muted">주문 시각</div>}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <div className="font-medium text-ink">{r.orgName ?? `법인#${r.orgId}`}</div>
                    {isTransfer(r) && (
                      <div className="text-[11px] text-ink-muted tabular-nums">
                        사업자 {r.orgBizNo ?? "미등록"}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-soft" title={r.byEmail ?? undefined}>
                    {r.byName ?? "-"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-soft whitespace-nowrap">
                    {isTransfer(r) ? "계좌이체" : "카드"}
                    <div className="text-[11px] text-ink-muted">IV{r.id}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                    {won(r.payKrw)}
                    <div className="text-[11px] text-ink-muted">
                      공급가 {r.amountKrw.toLocaleString()} · 세액 {r.vatKrw.toLocaleString()}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-soft">
                    {r.tokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap">{statusLabel(r)}</td>
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                    {!r.paidAt ? (
                      <span className="text-ink-muted">-</span>
                    ) : !isTransfer(r) ? (
                      <span className="text-ink-muted">카드 매출전표</span>
                    ) : (
                      <>
                        <label className="inline-flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={!!r.taxInvoiceIssuedAt}
                            disabled={busyId === r.id}
                            onChange={(e) => toggleInvoice(r, e.target.checked)}
                          />
                          {r.taxInvoiceIssuedAt ? (
                            <span className="text-success">
                              발행 {formatLocalDate(r.taxInvoiceIssuedAt)}
                            </span>
                          ) : (
                            <span className="font-medium text-warning">세금계산서 미발행</span>
                          )}
                        </label>
                        {r.status === "cancelled" && r.taxInvoiceIssuedAt && (
                          <div className="text-[11px] text-danger">환불됨 — 수정세금계산서 확인</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/admin/orgs/${r.orgId}/payments`}
                      className="text-xs text-primary hover:underline whitespace-nowrap"
                    >
                      법인 내역
                    </Link>
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

function Stat({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        warn ? "border-warning/40 bg-warning-soft" : "border-border-default bg-card"
      }`}
    >
      <div className="text-[11px] font-medium text-ink-muted">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${warn ? "text-warning" : "text-ink"}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-muted">{sub}</div>}
    </div>
  );
}

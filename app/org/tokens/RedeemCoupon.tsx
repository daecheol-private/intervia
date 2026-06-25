"use client";

import { useState } from "react";
import { Ticket, Loader2 } from "lucide-react";

/** 16자리 숫자만 추출해 4-4-4-4 로 표시. 붙여넣기·대시 입력도 자동 정리. */
function formatInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, "$1-");
}

export default function RedeemCoupon({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const digits = code.replace(/\D/g, "");
  const ready = digits.length === 16;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setErr("");
    setOk("");
    const res = await fetch("/api/orgs/coupons/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: digits }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      setErr(d?.error ?? "쿠폰을 등록하지 못했습니다.");
      return;
    }
    const d = (await res.json()) as { granted: number; groupName: string };
    setOk(`${d.groupName} — ${d.granted.toLocaleString()} 토큰이 지급되었습니다.`);
    setCode("");
    onRedeemed();
  };

  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold text-ink mb-3">쿠폰 등록</h2>
      <form
        onSubmit={submit}
        className="bg-card border border-border-default rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-center"
      >
        <div className="relative flex-1">
          <Ticket
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted"
            strokeWidth={2.25}
          />
          <input
            value={code}
            onChange={(e) => setCode(formatInput(e.target.value))}
            inputMode="numeric"
            placeholder="0000-0000-0000-0000"
            className="w-full border border-border-strong rounded-lg pl-9 pr-3 py-2.5 text-sm font-mono tracking-wider"
          />
        </div>
        <button
          type="submit"
          disabled={!ready || busy}
          className="bg-primary hover:bg-primary-deep disabled:opacity-50 disabled:cursor-not-allowed text-surface text-sm font-medium px-6 py-2.5 rounded-lg shadow-sm shrink-0"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "등록"}
        </button>
      </form>
      {err && (
        <p className="mt-2 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {err}
        </p>
      )}
      {ok && (
        <p className="mt-2 text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
          {ok}
        </p>
      )}
      <p className="mt-2 text-[11px] text-ink-muted">
        16자리 쿠폰 코드를 입력하면 토큰이 즉시 지급됩니다. 같은 쿠폰은 법인당 1개만 등록할 수 있습니다.
      </p>
    </section>
  );
}

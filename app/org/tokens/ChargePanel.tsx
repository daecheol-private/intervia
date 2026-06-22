"use client";

import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { CHARGE_PACKAGES } from "@/lib/beta";

// 토스 v2 표준결제 SDK(CDN)가 노출하는 전역. npm 의존 없이 스크립트로 로드.
type TossPaymentInstance = {
  requestPayment: (opts: Record<string, unknown>) => Promise<void>;
};
type TossInstance = { payment: (opts: { customerKey: string }) => TossPaymentInstance };
type TossPaymentsFn = (clientKey: string) => TossInstance;

declare global {
  interface Window {
    TossPayments?: TossPaymentsFn;
  }
}

const SDK_URL = "https://js.tosspayments.com/v2/standard";

/** 토스 SDK 를 1회만 로드(중복 주입 방지)하고 전역 함수를 반환. */
function loadTossSdk(): Promise<TossPaymentsFn> {
  return new Promise((resolve, reject) => {
    if (window.TossPayments) return resolve(window.TossPayments);
    const done = () =>
      window.TossPayments
        ? resolve(window.TossPayments)
        : reject(new Error("결제 모듈을 불러오지 못했습니다."));
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_URL}"]`
    );
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () =>
        reject(new Error("결제 모듈을 불러오지 못했습니다."))
      );
      return;
    }
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = done;
    s.onerror = () => reject(new Error("결제 모듈을 불러오지 못했습니다."));
    document.head.appendChild(s);
  });
}

export default function ChargePanel() {
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState("");

  async function charge(krw: number) {
    if (!clientKey) return;
    setErr("");
    setBusy(krw);
    try {
      // 1) 서버에 pending 주문 생성 → orderId 발급 (금액 검증은 서버에서).
      const res = await fetch("/api/orgs/tokens/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountKrw: krw }),
      });
      if (!res.ok) {
        setErr(await res.text());
        setBusy(null);
        return;
      }
      const order = (await res.json()) as {
        orderId: string;
        amount: number;
        orderName: string;
        customerEmail: string;
        customerName: string;
      };

      // 2) 토스 결제창 — 성공 시 successUrl 로 리다이렉트(아래 코드는 도달 안 함).
      const TossPayments = await loadTossSdk();
      const payment = TossPayments(clientKey).payment({ customerKey: "ANONYMOUS" });
      await payment.requestPayment({
        method: "CARD",
        amount: { value: order.amount, currency: "KRW" },
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: `${window.location.origin}/org/tokens/success`,
        failUrl: `${window.location.origin}/org/tokens/fail`,
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        card: { useCardPoint: false, cardInstallmentPlan: 0 },
      });
    } catch (e) {
      // 사용자가 결제창을 닫으면 reject(USER_CANCEL) — 조용히 복구. 그 외는 표시.
      const code = (e as { code?: string })?.code ?? "";
      const msg = e instanceof Error ? e.message : "결제를 시작할 수 없습니다.";
      if (code !== "USER_CANCEL" && !/취소|cancel/i.test(`${code} ${msg}`))
        setErr(msg);
      setBusy(null);
    }
  }

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-ink">충전하기</h2>
        <span className="text-[11px] text-ink-muted">
          100원 = 1 토큰 (VAT 별도) · 많이 충전할수록 보너스 ↑
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {CHARGE_PACKAGES.map((p) => {
          const base = Math.floor(p.krw / 100);
          const bonus = Math.floor((base * p.bonusPct) / 100);
          const total = base + bonus;
          const isBusy = busy === p.krw;
          return (
            <button
              key={p.krw}
              type="button"
              onClick={() => charge(p.krw)}
              disabled={busy !== null || !clientKey}
              className={`relative rounded-xl p-3 border text-center transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                p.popular
                  ? "bg-gradient-to-b from-primary-soft to-card border-primary/40 shadow-sm hover:border-primary"
                  : "bg-card border-border-default hover:border-primary/50"
              }`}
            >
              {p.popular && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-2 py-0.5 rounded-full bg-primary text-surface whitespace-nowrap">
                  추천
                </span>
              )}
              <div className="text-xs text-ink-muted">
                {(p.krw / 10_000).toLocaleString()}만원
              </div>
              <div className="text-base font-bold text-ink mt-1 tabular-nums">
                {isBusy ? (
                  <Loader2 className="w-4 h-4 mx-auto animate-spin" />
                ) : (
                  total.toLocaleString()
                )}
              </div>
              <div className="text-[10px] text-ink-muted mt-0.5">토큰</div>
              {p.bonusPct > 0 ? (
                <div className="mt-2 inline-block text-[10px] font-semibold text-primary-deep bg-primary-soft px-1.5 py-0.5 rounded">
                  +{p.bonusPct}% 보너스
                </div>
              ) : (
                <div className="mt-2 text-[10px] text-ink-muted">보너스 없음</div>
              )}
            </button>
          );
        })}
      </div>

      {err && (
        <p className="mt-3 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {err}
        </p>
      )}

      {clientKey ? (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-muted">
          <CreditCard className="w-3.5 h-3.5" strokeWidth={2.25} />
          신용·체크카드로 즉시 충전됩니다. 카드를 누르면 결제창이 열립니다.
        </p>
      ) : (
        <p className="mt-3 text-xs text-ink-soft bg-surface-alt border border-border-default rounded-lg px-3 py-2">
          결제 연동 준비 중입니다 (관리자 키 미설정). 잠시만 기다려 주세요.
        </p>
      )}
    </section>
  );
}

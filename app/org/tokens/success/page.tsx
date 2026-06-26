"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

type Result =
  | { phase: "loading" }
  | {
      phase: "ok";
      granted: number;
      balance: number;
      amountKrw: number;
      paidAmountKrw: number;
    }
  | { phase: "error"; message: string };

function SuccessInner() {
  const params = useSearchParams();
  const [result, setResult] = useState<Result>({ phase: "loading" });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // dev StrictMode 이중 실행 방지(서버도 멱등이지만 깔끔하게)
    ran.current = true;

    const paymentKey = params.get("paymentKey");
    const orderId = params.get("orderId");
    const amount = params.get("amount");
    if (!paymentKey || !orderId || !amount) {
      setResult({ phase: "error", message: "결제 정보가 누락되었습니다." });
      return;
    }

    void (async () => {
      try {
        const res = await fetch("/api/orgs/tokens/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentKey,
            orderId,
            amount: Number(amount),
          }),
        });
        const ct = res.headers.get("content-type") ?? "";
        const data = ct.includes("application/json")
          ? await res.json()
          : { ok: false, message: await res.text() };
        if (res.ok && data.ok) {
          setResult({
            phase: "ok",
            granted: data.granted ?? 0,
            balance: data.balance ?? 0,
            amountKrw: data.amountKrw ?? Number(amount),
            paidAmountKrw: data.paidAmountKrw ?? Number(amount),
          });
        } else {
          setResult({
            phase: "error",
            message: data.message || "결제 승인에 실패했습니다.",
          });
        }
      } catch {
        setResult({
          phase: "error",
          message:
            "결제 승인 처리 중 오류가 발생했습니다. 토큰 페이지에서 잔액을 확인해 주세요.",
        });
      }
    })();
  }, [params]);

  return (
    <main className="max-w-md mx-auto px-4 py-16">
      <div className="rounded-2xl border border-border-default bg-card p-8 text-center shadow-sm">
        {result.phase === "loading" && (
          <>
            <Loader2 className="w-10 h-10 mx-auto text-primary animate-spin" />
            <h1 className="text-base font-semibold text-ink mt-4">
              결제를 확인하는 중입니다…
            </h1>
            <p className="text-sm text-ink-muted mt-2">
              창을 닫지 말고 잠시만 기다려 주세요.
            </p>
          </>
        )}

        {result.phase === "ok" && (
          <>
            <CheckCircle2 className="w-12 h-12 mx-auto text-primary" />
            <h1 className="text-lg font-bold text-ink mt-4">충전 완료</h1>
            <p className="text-sm text-ink-soft mt-2">
              {result.paidAmountKrw.toLocaleString()}원 결제(VAT 포함)로{" "}
              <strong className="text-primary-deep">
                {result.granted.toLocaleString()} 토큰
              </strong>
              이 지급되었습니다.
            </p>
            <div className="mt-4 rounded-xl bg-primary-soft/60 border border-primary/20 px-4 py-3">
              <div className="text-xs text-ink-muted">현재 잔액</div>
              <div className="text-2xl font-bold text-ink tabular-nums mt-0.5">
                {result.balance.toLocaleString()}{" "}
                <span className="text-sm font-normal text-ink-muted">토큰</span>
              </div>
            </div>
            <Link
              href="/org/tokens"
              className="mt-6 inline-block text-sm px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface font-medium transition-colors"
            >
              토큰 페이지로
            </Link>
          </>
        )}

        {result.phase === "error" && (
          <>
            <XCircle className="w-12 h-12 mx-auto text-danger" />
            <h1 className="text-lg font-bold text-ink mt-4">
              결제를 완료하지 못했습니다
            </h1>
            <p className="text-sm text-ink-soft mt-2 whitespace-pre-wrap">
              {result.message}
            </p>
            <p className="text-xs text-ink-muted mt-3">
              카드 결제가 승인됐는데 토큰이 반영되지 않았다면, 잠시 후 토큰
              페이지를 새로고침하거나 관리자에게 문의해 주세요.
            </p>
            <Link
              href="/org/tokens"
              className="mt-6 inline-block text-sm px-5 py-2.5 rounded-lg bg-surface-alt border border-border-strong text-ink font-medium hover:bg-card transition-colors"
            >
              토큰 페이지로
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function ChargeSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-md mx-auto px-4 py-16 text-center text-sm text-ink-muted">
          불러오는 중…
        </main>
      }
    >
      <SuccessInner />
    </Suspense>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, Landmark, Loader2, Sparkles } from "lucide-react";
import {
  CHARGE_PACKAGES,
  CHARGE_BONUS_BOOSTED,
  BETA_BONUS_MULTIPLIER,
  withVat,
} from "@/lib/beta";

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

const CARD_PACKAGES = CHARGE_PACKAGES.filter((p) => p.method === "card");
const TRANSFER_PACKAGES = CHARGE_PACKAGES.filter((p) => p.method === "transfer");

/** 공급가 → 지급 토큰(기본 + 보너스). 서버 calcTokensForKrw 와 같은 정수 계산. */
function tokensFor(p: (typeof CHARGE_PACKAGES)[number]) {
  const base = Math.floor(p.krw / 100);
  const bonus = Math.floor((base * p.bonusPct) / 100);
  return { base, bonus, total: base + bonus };
}

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

/** enabled: 서버 게이트(canChargeByCard) — 키 미설정이거나 심사용 테스트 키에서 허용되지 않은 법인이면 false. */
export default function ChargePanel({ enabled }: { enabled: boolean }) {
  const clientKey = enabled ? process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY : undefined;
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
          100원 = 1 토큰 · 결제 시 VAT 10% 별도
        </span>
      </div>

      <div className="rounded-2xl border border-border-default bg-card p-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <CreditCard className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden />
          카드 결제
          <span className="font-normal text-ink-muted">
            · 1회 결제 10만원(VAT 포함) 이하
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {CARD_PACKAGES.map((p) => {
            const t = tokensFor(p);
            const isBusy = busy === p.krw;
            return (
              <button
                key={p.krw}
                type="button"
                onClick={() => charge(p.krw)}
                disabled={busy !== null || !clientKey}
                className="rounded-xl p-3 border text-center transition-colors bg-card border-border-default hover:border-primary/50 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="text-xs text-ink-muted">
                  {(p.krw / 10_000).toLocaleString()}만원
                </div>
                <div className="text-[10px] text-ink-muted/80 tabular-nums">
                  결제 {withVat(p.krw).toLocaleString()}원
                </div>
                <div className="text-base font-bold text-ink mt-1 tabular-nums">
                  {isBusy ? (
                    <Loader2 className="w-4 h-4 mx-auto animate-spin" />
                  ) : (
                    t.total.toLocaleString()
                  )}
                </div>
                <div className="text-[10px] text-ink-muted mt-0.5">토큰</div>
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
          <>
            <p className="mt-3 text-[11px] text-ink-muted">
              신용·체크카드로 즉시 충전됩니다. 표시 금액에 VAT 10%가 더해진 금액이 결제됩니다.
            </p>
            {/* 결제 전 거래조건 고지 — 이용기간·환불 기준(약관 §7-1·§7-2)을 결제 화면에서 바로 확인. */}
            <p className="mt-1 text-[11px] text-ink-muted">
              충전 토큰의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내입니다.
              사용하지 않은 충전분은 결제한 수단으로 환불되며, 일부라도 사용했다면
              이용계약 해지·서비스 종료 시에만 미사용 잔액이 환불됩니다. 토큰은 다른
              법인에 양도할 수 없습니다.{" "}
              <Link href="/terms#refund-policy" className="text-primary hover:underline">
                환불 정책 보기
              </Link>
            </p>
          </>
        ) : (
          <p className="mt-3 text-xs text-ink-soft bg-surface-alt border border-border-default rounded-lg px-3 py-2">
            카드 결제 준비 중입니다. 지금 충전이 필요하면 고객센터로 문의해 주세요.
          </p>
        )}
      </div>

      <TransferRequest />
    </section>
  );
}

/**
 * 10만원 이상 — 계좌이체 충전 신청. 카드 1회 결제 한도(토스 충전업종) 밖이라 카드로 팔지 않는다.
 * 고객센터 문의(billing)로 접수 → 운영자 메일·Slack 알림 → 입금 계좌·세금계산서 안내 후 수동 충전.
 */
function TransferRequest() {
  const [selected, setSelected] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [err, setErr] = useState("");
  const pkg = TRANSFER_PACKAGES.find((p) => p.krw === selected) ?? null;

  async function submit() {
    if (!pkg) return;
    setErr("");
    setState("sending");
    const t = tokensFor(pkg);
    const message = [
      "[계좌이체 충전 신청]",
      `충전 금액: ${pkg.krw.toLocaleString()}원 (VAT 별도)`,
      `입금 금액: ${withVat(pkg.krw).toLocaleString()}원 (VAT 포함)`,
      `지급 토큰: ${t.total.toLocaleString()} 토큰` +
        (t.bonus > 0
          ? ` (기본 ${t.base.toLocaleString()} + 보너스 ${t.bonus.toLocaleString()}, ${pkg.bonusPct}%)`
          : ""),
      "입금 계좌와 세금계산서 발행 안내를 부탁드립니다.",
    ].join("\n");
    try {
      const res = await fetch("/api/support/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "billing", message }),
      });
      if (!res.ok) {
        setErr(await res.text());
        setState("idle");
        return;
      }
      setState("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "신청을 보내지 못했습니다.");
      setState("idle");
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-border-default bg-card p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Landmark className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden />
          10만원 이상 계좌이체
          <span className="font-normal text-ink-muted">· 세금계산서 발행</span>
        </div>
        {CHARGE_BONUS_BOOSTED && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-soft border border-accent/40 text-[10px] font-semibold text-accent-deep">
            <Sparkles className="w-3 h-3" strokeWidth={2.5} aria-hidden />
            오픈베타 보너스 {BETA_BONUS_MULTIPLIER}배
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        {TRANSFER_PACKAGES.map((p) => {
          const t = tokensFor(p);
          const active = selected === p.krw;
          return (
            <button
              key={p.krw}
              type="button"
              aria-pressed={active}
              disabled={state === "sending"}
              onClick={() => {
                setSelected(p.krw);
                setState("idle");
                setErr("");
              }}
              className={`relative rounded-xl p-3 border text-center transition-colors disabled:opacity-60 ${
                active
                  ? "border-primary bg-primary-soft"
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
              <div className="text-[10px] text-ink-muted/80 tabular-nums">
                입금 {withVat(p.krw).toLocaleString()}원
              </div>
              <div className="text-base font-bold text-ink mt-1 tabular-nums">
                {t.total.toLocaleString()}
              </div>
              <div className="text-[10px] text-ink-muted mt-0.5">토큰</div>
              {p.bonusPct > 0 && (
                <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-accent-deep bg-accent-soft px-1.5 py-0.5 rounded tabular-nums">
                  {CHARGE_BONUS_BOOSTED && (
                    <>
                      <span className="line-through opacity-60">+{p.listBonusPct}%</span>
                      <span aria-hidden>→</span>
                    </>
                  )}
                  <span>+{p.bonusPct}% 보너스</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {state === "done" ? (
        <p className="mt-3 text-xs text-ink bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
          신청이 접수됐습니다. 입금 계좌와 세금계산서 발행 안내를 메일로 보내드리고,
          입금이 확인되면 토큰을 충전해 드립니다.{" "}
          <Link href="/support" className="text-primary hover:underline">
            문의 내역 보기
          </Link>
        </p>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-ink-muted">
            금액을 고르고 신청하면 입금 계좌를 안내해 드립니다. 세금계산서는{" "}
            <Link href="/org/settings" className="text-primary hover:underline">
              법인 설정
            </Link>
            의 사업자등록번호로 발행됩니다.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={!pkg || state === "sending"}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state === "sending" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {pkg
              ? `${(pkg.krw / 10_000).toLocaleString()}만원 계좌이체 신청`
              : "금액을 선택하세요"}
          </button>
        </div>
      )}

      {err && (
        <p className="mt-2 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {err}
        </p>
      )}
    </div>
  );
}

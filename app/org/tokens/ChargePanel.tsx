"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, CreditCard, Landmark, Loader2, Sparkles } from "lucide-react";
import {
  CHARGE_PACKAGES,
  CHARGE_BONUS_BOOSTED,
  BETA_BONUS_MULTIPLIER,
  withVat,
} from "@/lib/beta";
import { formatLocalDate, formatLocalDateTime } from "@/lib/utils";
import { Badge, buttonClass } from "@/app/components/ui";

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

type TransferOrder = {
  id: number;
  amountKrw: number;
  payKrw: number;
  tokens: number;
  status: "pending" | "paid" | "failed" | "cancelled";
  depositorName: string;
  dueAt: string;
  depositNotifiedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
};

type TransferInfo = {
  account: { bank: string; number: string; holder: string };
  depositDays: number;
  bizRegistrationNo: string | null;
  orders: TransferOrder[];
};

/**
 * 10만원 이상 — 계좌이체 충전. 카드 1회 결제 한도(토스 충전업종) 밖이라 카드로 팔지 않는다.
 * 신청 → 입금 안내(화면·메일) → 입금 후 "확인 요청" → 담당자가 Slack 에서 입금확인 → 토큰 충전·메일.
 */
function TransferRequest() {
  const [info, setInfo] = useState<TransferInfo | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const pkg = TRANSFER_PACKAGES.find((p) => p.krw === selected) ?? null;

  const load = useCallback(async () => {
    const res = await fetch("/api/orgs/tokens/transfer");
    if (res.ok) setInfo((await res.json()) as TransferInfo);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!pkg) return;
    setErr("");
    setNotice("");
    setSending(true);
    try {
      const res = await fetch("/api/orgs/tokens/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountKrw: pkg.krw }),
      });
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      setSelected(null);
      setNotice("신청이 접수됐습니다. 아래 안내대로 입금해 주세요. 같은 내용을 메일로도 보내 드렸습니다.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "신청을 보내지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  async function requestCheck(o: TransferOrder) {
    setErr("");
    setNotice("");
    setBusyId(o.id);
    try {
      const res = await fetch(`/api/orgs/tokens/transfer/${o.id}/notify`, { method: "POST" });
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      const d = (await res.json()) as { sent: boolean };
      setNotice(
        d.sent
          ? "담당자에게 입금 확인을 요청했습니다. 확인되면 토큰이 충전되고 메일로 알려 드립니다."
          : "이미 확인을 요청했습니다. 담당자가 확인하고 있으니 잠시만 기다려 주세요."
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "요청을 보내지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = info?.orders.filter((o) => o.status === "pending") ?? [];
  const paid = info?.orders.filter((o) => o.status === "paid").slice(0, 3) ?? [];

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

      {info &&
        pending.map((o) => (
          <TransferGuide
            key={o.id}
            order={o}
            info={info}
            busy={busyId === o.id}
            onRequestCheck={() => requestCheck(o)}
          />
        ))}

      {notice && (
        <p className="mt-3 text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
          {notice}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        {TRANSFER_PACKAGES.map((p) => {
          const t = tokensFor(p);
          const active = selected === p.krw;
          return (
            <button
              key={p.krw}
              type="button"
              aria-pressed={active}
              disabled={sending}
              onClick={() => {
                setSelected(p.krw);
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

      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[11px] text-ink-muted">
          금액을 고르고 신청하면 입금 계좌를 바로 안내해 드립니다(메일로도 발송). 입금 후 확인을
          요청하시면 담당자가 확인하는 대로 토큰이 충전됩니다.
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={!pkg || sending}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {pkg
            ? `${(pkg.krw / 10_000).toLocaleString()}만원 계좌이체 신청`
            : "금액을 선택하세요"}
        </button>
      </div>

      {err && (
        <p className="mt-2 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {err}
        </p>
      )}

      {paid.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px] text-ink-muted">
          {paid.map((o) => (
            <li key={o.id} className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success" strokeWidth={2.5} aria-hidden />
              {formatLocalDate(o.confirmedAt ?? o.createdAt)} ·{" "}
              {o.payKrw.toLocaleString()}원 입금확인 · {o.tokens.toLocaleString()} 토큰 충전
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TransferGuide({
  order,
  info,
  busy,
  onRequestCheck,
}: {
  order: TransferOrder;
  info: TransferInfo;
  busy: boolean;
  onRequestCheck: () => void;
}) {
  const requested = order.depositNotifiedAt != null;
  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-primary-soft/40 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold text-ink">
          {(order.amountKrw / 10_000).toLocaleString()}만원 계좌이체 충전 ·{" "}
          {order.tokens.toLocaleString()} 토큰
        </div>
        <Badge tone={requested ? "info" : "warning"} dot>
          {requested ? "입금 확인 중" : "입금 대기"}
        </Badge>
      </div>

      <ol className="mt-3 space-y-4 text-xs text-ink-soft">
        <li>
          <p className="font-semibold text-ink">1. 아래 계좌로 입금해 주세요</p>
          <dl className="mt-2 grid grid-cols-[4.5rem_1fr] items-center gap-x-3 gap-y-2 rounded-lg border border-border-default bg-card px-3 py-2.5">
            <dt className="text-ink-muted">입금 계좌</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink tabular-nums">
                {info.account.bank} {info.account.number}
              </span>
              <CopyButton value={info.account.number} label="계좌번호" />
            </dd>
            <dt className="text-ink-muted">예금주</dt>
            <dd className="text-ink">{info.account.holder}</dd>
            <dt className="text-ink-muted">입금액</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink tabular-nums">
                {order.payKrw.toLocaleString()}원
              </span>
              <span className="text-ink-muted">VAT 포함</span>
              <CopyButton value={String(order.payKrw)} label="입금액" />
            </dd>
            <dt className="text-ink-muted">입금자명</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{order.depositorName}</span>
              <CopyButton value={order.depositorName} label="입금자명" />
              <span className="text-ink-muted">받는 분 통장 표시에 적어 주세요</span>
            </dd>
            <dt className="text-ink-muted">입금 기한</dt>
            <dd className="text-ink">{formatLocalDate(order.dueAt)}까지</dd>
          </dl>
        </li>
        <li>
          <p className="font-semibold text-ink">2. 입금한 뒤 확인을 요청해 주세요</p>
          {requested ? (
            <p className="mt-1 leading-relaxed">
              {formatLocalDateTime(order.depositNotifiedAt!)}에 확인을 요청했습니다. 담당자가
              입금을 확인하는 대로 충전됩니다.{" "}
              <button
                type="button"
                onClick={onRequestCheck}
                disabled={busy}
                className="text-primary hover:underline disabled:opacity-50"
              >
                다시 요청
              </button>
            </p>
          ) : (
            <button
              type="button"
              onClick={onRequestCheck}
              disabled={busy}
              className={buttonClass({ size: "sm", className: "mt-2" })}
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
              )}
              입금 완료 · 확인 요청
            </button>
          )}
        </li>
        <li>
          <p className="font-semibold text-ink">3. 확인되면 토큰이 바로 충전됩니다</p>
          <p className="mt-1 leading-relaxed">
            충전되면 메일로 알려 드립니다.{" "}
            {info.bizRegistrationNo ? (
              <>세금계산서는 사업자등록번호 {info.bizRegistrationNo}로 발행해 메일로 보내 드립니다.</>
            ) : (
              <>
                세금계산서 발행을 위해{" "}
                <Link href="/org/settings" className="text-primary hover:underline">
                  법인 설정
                </Link>
                에 사업자등록번호를 등록해 주세요.
              </>
            )}
          </p>
        </li>
      </ol>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`${label} 복사`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* 클립보드 권한 없음 — 무시 */
        }
      }}
      className="inline-flex items-center gap-1 rounded border border-border-default bg-card px-1.5 py-0.5 text-[10px] text-ink-soft hover:bg-surface-alt"
    >
      {copied ? <Check className="w-3 h-3" strokeWidth={2.5} /> : <Copy className="w-3 h-3" />}
      {copied ? "복사됨" : "복사"}
    </button>
  );
}

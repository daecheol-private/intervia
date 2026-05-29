"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatLocalDateTime } from "@/lib/utils";
import { CreditCard } from "lucide-react";

type Pricing = { job_post: number; resume_upload: number; interview: number };

type LedgerRow = {
  id: number;
  delta: number;
  reason:
    | "charge"
    | "job_post"
    | "resume_upload"
    | "interview"
    | "job_extend"
    | "refund"
    | "admin_adjust";
  refType: string | null;
  refId: number | null;
  balanceAfter: number;
  memo: string | null;
  createdAt: string;
};

type Data = {
  orgId: number;
  balance: number;
  lowBalance: boolean;
  pricing: Pricing;
  ledger: LedgerRow[];
};

export default function TokensPage() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/orgs/tokens");
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      setData(await res.json());
    })();
  }, []);

  if (err)
    return (
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="rounded-2xl border border-border-default bg-card p-8 text-center">
          <div className="text-3xl mb-3">🔒</div>
          <h1 className="text-base font-semibold text-ink mb-2">
            법인 관리자만 볼 수 있는 페이지입니다
          </h1>
          <p className="text-sm text-ink-soft mb-5 whitespace-pre-wrap">{err}</p>
          <Link
            href="/"
            className="inline-block text-xs px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface font-medium transition-colors"
          >
            대시보드로 돌아가기
          </Link>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="max-w-4xl mx-auto px-6 py-8 text-slate-400 text-sm">
        불러오는 중...
      </main>
    );

  return (
    <main className="max-w-4xl mx-auto w-full px-6 py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">토큰</h1>
        <p className="text-sm text-slate-500 mt-1">법인의 토큰 잔액 및 사용 내역.</p>
      </div>

      {/* 잔액 카드 — 큰 숫자 + KRW 환산 */}
      <div
        className={`mb-6 rounded-2xl p-6 ${
          data.balance < 0
            ? "bg-rose-50 border border-rose-200"
            : data.lowBalance
              ? "bg-amber-50 border border-amber-200"
              : "bg-gradient-to-br from-primary-soft to-primary-soft/60 border border-primary/20"
        }`}
      >
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              현재 잔액
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className={`text-4xl font-bold tabular-nums ${
                  data.balance < 0 ? "text-rose-600" : "text-slate-900"
                }`}
              >
                {data.balance.toLocaleString()}
              </span>
              <span className="text-sm text-slate-500">토큰</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              ≈ {(data.balance * 100).toLocaleString()}원
            </div>
          </div>
          {data.balance > 0 && (
            <div className="text-right text-xs text-slate-600 space-y-0.5">
              <div>
                남은 이력서 평가{" "}
                <strong className="text-slate-900">
                  {Math.floor(data.balance / data.pricing.resume_upload).toLocaleString()}
                </strong>
                건
              </div>
              <div>
                남은 AI 면접{" "}
                <strong className="text-slate-900">
                  {Math.floor(data.balance / data.pricing.interview).toLocaleString()}
                </strong>
                회
              </div>
            </div>
          )}
        </div>
        {data.balance < 0 && (
          <p className="text-xs text-rose-700 mt-3 bg-white/60 rounded-lg px-3 py-2">
            ⚠️ 잔액이 마이너스입니다. 신규 이력서 업로드·평가·면접·이메일 발송이 차단됩니다. 시스템 관리자에게 충전을 요청해 주세요.
          </p>
        )}
        {data.lowBalance && data.balance >= 0 && (
          <p className="text-xs text-amber-700 mt-3 bg-white/60 rounded-lg px-3 py-2">
            잔액이 0에 가깝습니다. 미리 충전해 주세요.
          </p>
        )}
      </div>

      {/* 기능별 단가 — 큰 카드 3개 */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">기능별 단가</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <PriceCard
            icon="📋"
            label="공고 등록"
            tokens={data.pricing.job_post}
            hint="공고 1건 등록 시"
          />
          <PriceCard
            icon="📄"
            label="이력서 평가"
            tokens={data.pricing.resume_upload}
            hint="이력서 1건 AI 서류평가"
          />
          <PriceCard
            icon="💬"
            label="AI 면접"
            tokens={data.pricing.interview}
            hint="면접 링크 1회 발급"
          />
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          1 토큰 = 100원 기준. 결제 시점 단가로 차감 (이후 가격 변동 영향 없음).
        </p>
      </section>

      {/* 충전 정책 — 카드 그리드 */}
      <section className="mb-6">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-900">충전 가격</h2>
          <span className="text-[11px] text-slate-500">
            100원 = 1 토큰 · 많이 충전할수록 보너스 ↑
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <ChargeCard krw={50_000} base={500} bonusPct={0} />
          <ChargeCard krw={100_000} base={1_000} bonusPct={5} />
          <ChargeCard krw={300_000} base={3_000} bonusPct={10} popular />
          <ChargeCard krw={500_000} base={5_000} bonusPct={15} />
          <ChargeCard krw={1_000_000} base={10_000} bonusPct={20} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 bg-surface-alt border border-border-default rounded-xl px-4 py-3">
          <div className="text-xs text-ink-soft leading-relaxed">
            <div className="font-medium text-ink mb-0.5">신용카드 결제 (준비 중)</div>
            저장된 카드 또는 새 카드로 즉시 충전할 수 있게 준비 중입니다.
          </div>
          <button
            type="button"
            disabled
            title="신용카드 결제 시스템 연동 준비 중입니다"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs bg-surface-alt border border-border-strong text-ink-muted rounded-lg shrink-0 font-medium cursor-not-allowed"
          >
            <CreditCard className="w-3.5 h-3.5" strokeWidth={2.25} />
            결제하기
          </button>
        </div>
      </section>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 text-sm font-semibold">
          최근 사용 내역
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">시각</th>
              <th className="text-left px-4 py-2 font-medium">사유</th>
              <th className="text-left px-4 py-2 font-medium">메모</th>
              <th className="text-right px-4 py-2 font-medium">변동</th>
              <th className="text-right px-4 py-2 font-medium">잔액</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.ledger.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                  내역이 없습니다.
                </td>
              </tr>
            )}
            {data.ledger.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {formatLocalDateTime(r.createdAt, { format: { second: "2-digit" } })}
                </td>
                <td className="px-4 py-2 text-xs">{reasonLabel(r.reason)}</td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {r.memo || "-"}
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono ${
                    r.delta >= 0 ? "text-primary-deep" : "text-danger"
                  }`}
                >
                  {r.delta >= 0 ? "+" : ""}
                  {r.delta.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono text-slate-700">
                  {r.balanceAfter.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function PriceCard({
  icon,
  label,
  tokens,
  hint,
  accent,
}: {
  icon: string;
  label: string;
  tokens: number;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-4 border ${
        accent
          ? "bg-primary-soft border-primary/30"
          : "bg-white border-slate-200 shadow-sm"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <div className="text-xs font-medium text-slate-600">{label}</div>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">
          {tokens.toLocaleString()}
        </span>
        <span className="text-xs text-slate-500">토큰</span>
        <span className="text-[11px] text-slate-400 ml-auto">
          {(tokens * 100).toLocaleString()}원
        </span>
      </div>
      <p className="text-[11px] text-slate-500 mt-1.5">{hint}</p>
    </div>
  );
}

function ChargeCard({
  krw,
  base,
  bonusPct,
  popular,
}: {
  krw: number;
  base: number;
  bonusPct: number;
  popular?: boolean;
}) {
  const bonus = Math.floor((base * bonusPct) / 100);
  const total = base + bonus;
  return (
    <div
      className={`relative rounded-xl p-3 border text-center ${
        popular
          ? "bg-gradient-to-b from-primary-soft to-card border-primary/40 shadow-sm"
          : "bg-card border-border-default"
      }`}
    >
      {popular && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-2 py-0.5 rounded-full bg-primary text-surface whitespace-nowrap">
          추천
        </span>
      )}
      <div className="text-xs text-slate-500">
        {krw >= 1_000_000 ? `${krw / 10_000}만원` : `${krw / 10_000}만원`}
      </div>
      <div className="text-base font-bold text-slate-900 mt-1 tabular-nums">
        {total.toLocaleString()}
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">토큰</div>
      {bonusPct > 0 ? (
        <div className="mt-2 inline-block text-[10px] font-semibold text-primary-deep bg-primary-soft px-1.5 py-0.5 rounded">
          +{bonusPct}% 보너스
        </div>
      ) : (
        <div className="mt-2 text-[10px] text-slate-400">보너스 없음</div>
      )}
    </div>
  );
}

function reasonLabel(r: LedgerRow["reason"]): string {
  switch (r) {
    case "job_post":
      return "공고 등록";
    case "resume_upload":
      return "이력서 평가";
    case "interview":
      return "AI 면접 링크 발급";
    case "job_extend":
      return "공고 연장";
    case "refund":
      return "환불";
    case "admin_adjust":
      return "관리자 조정";
    case "charge":
      return "충전";
  }
}

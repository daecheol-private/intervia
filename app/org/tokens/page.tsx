"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatLocalDateTime } from "@/lib/utils";
import { BETA, LIST_PRICING } from "@/lib/beta";
import ChargePanel from "./ChargePanel";
import RedeemCoupon from "./RedeemCoupon";

type Pricing = {
  job_post: number;
  resume_upload: number;
  interview: number;
  interview_question_gen: number;
  offline_interview: number;
};

type LedgerRow = {
  id: number;
  delta: number;
  reason:
    | "charge"
    | "job_post"
    | "resume_upload"
    | "interview"
    | "interview_question_gen"
    | "offline_interview"
    | "job_extend"
    | "refund"
    | "admin_adjust";
  refType: string | null;
  refId: number | null;
  balanceAfter: number;
  memo: string | null;
  createdAt: string;
  byName: string | null;
  byEmail: string | null;
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

  const load = async () => {
    const res = await fetch("/api/orgs/tokens");
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setData(await res.json());
  };

  useEffect(() => {
    void load();
  }, []);

  if (err)
    return (
      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
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
      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 text-ink-muted text-sm">
        불러오는 중...
      </main>
    );

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">토큰</h1>
        <p className="text-sm text-ink-soft mt-1">법인의 토큰 잔액 및 사용 내역.</p>
      </div>

      {/* 잔액 카드 — 큰 숫자 + KRW 환산 */}
      <div
        className={`mb-6 rounded-2xl p-6 ${
          data.balance < 0
            ? "bg-danger-soft border border-danger/30"
            : data.lowBalance
              ? "bg-warning-soft border border-warning/30"
              : "bg-gradient-to-br from-primary-soft to-primary-soft/60 border border-primary/20"
        }`}
      >
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-medium text-ink-muted uppercase tracking-wider">
              현재 잔액
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className={`text-4xl font-bold tabular-nums ${
                  data.balance < 0 ? "text-danger" : "text-ink"
                }`}
              >
                {data.balance.toLocaleString()}
              </span>
              <span className="text-sm text-ink-muted">토큰</span>
            </div>
            <div className="text-xs text-ink-muted mt-1">
              ≈ {(data.balance * 100).toLocaleString()}원
            </div>
          </div>
          {data.balance > 0 && (
            <div className="text-right text-xs text-ink-soft space-y-0.5">
              <div>
                남은 이력서 평가{" "}
                <strong className="text-ink">
                  {Math.floor(data.balance / data.pricing.resume_upload).toLocaleString()}
                </strong>
                건
              </div>
              <div>
                남은 AI 면접{" "}
                <strong className="text-ink">
                  {Math.floor(data.balance / data.pricing.interview).toLocaleString()}
                </strong>
                회
              </div>
            </div>
          )}
        </div>
        {data.balance <= 0 && (
          <p className="text-xs text-danger mt-3 bg-card/60 rounded-lg px-3 py-2">
            ⚠️ 잔액이 소진되었습니다. 신규 이력서 업로드·평가·면접·이메일 발송이 차단됩니다. 시스템 관리자에게 충전을 요청해 주세요.
          </p>
        )}
        {data.lowBalance && data.balance > 0 && (
          <p className="text-xs text-warning mt-3 bg-card/60 rounded-lg px-3 py-2">
            잔액이 0에 가깝습니다. 미리 충전해 주세요.
          </p>
        )}
      </div>

      {/* 오픈베타 특가 배너 */}
      {BETA.active && (
        <div className="mb-6 rounded-2xl border border-primary/30 bg-primary-soft/50 px-5 py-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary text-surface">
              {BETA.label}
            </span>
            <span className="text-sm font-semibold text-ink">
              AI 면접 특가 — {BETA.endsAtLabel}까지
            </span>
          </div>
          <p className="text-xs text-ink-soft mt-1.5 leading-relaxed">
            오픈베타 기간 동안 AI 면접·대면 면접 평가를 정가{" "}
            <span className="line-through text-ink-muted">
              {(LIST_PRICING.interview * 100).toLocaleString()}원
            </span>{" "}
            →{" "}
            <strong className="text-primary-deep">
              {(data.pricing.interview * 100).toLocaleString()}원
            </strong>
            에 이용하실 수 있어요. {BETA.note}
          </p>
        </div>
      )}

      {/* 기능별 단가 — 큰 카드 3개 */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-ink mb-3">기능별 단가</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
            listTokens={LIST_PRICING.interview}
            hint="면접 링크 1회 발급"
          />
          <PriceCard
            icon="📝"
            label="면접 문제 생성"
            tokens={data.pricing.interview_question_gen}
            hint="면접 문제 1건 생성 (1·2차 동일)"
          />
          <PriceCard
            icon="🎙️"
            label="대면 면접 평가"
            tokens={data.pricing.offline_interview}
            listTokens={LIST_PRICING.offline_interview}
            hint="녹음·음성 1건 전사 + AI 평가 (1·2차)"
          />
        </div>
        <p className="text-[11px] text-ink-muted mt-2">
          1 토큰 = 100원 기준 (VAT 별도). 결제 시점 단가로 차감 (이후 가격 변동 영향 없음).
        </p>
      </section>

      {/* 충전 — 토스페이먼츠 카드 결제 */}
      <ChargePanel />

      {/* 쿠폰 등록 */}
      <RedeemCoupon onRedeemed={load} />

      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border-default text-sm font-semibold">
          최근 사용 내역
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="bg-surface-alt text-ink-soft text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">시각</th>
              <th className="text-left px-4 py-2 font-medium">사유</th>
              <th className="text-left px-4 py-2 font-medium">처리자</th>
              <th className="text-left px-4 py-2 font-medium">메모</th>
              <th className="text-right px-4 py-2 font-medium">변동</th>
              <th className="text-right px-4 py-2 font-medium">잔액</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {data.ledger.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-ink-muted" colSpan={6}>
                  내역이 없습니다.
                </td>
              </tr>
            )}
            {data.ledger.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 text-xs text-ink-muted">
                  {formatLocalDateTime(r.createdAt, { format: { second: "2-digit" } })}
                </td>
                <td className="px-4 py-2 text-xs">
                  {r.refType === "coupon" ? "쿠폰 등록" : reasonLabel(r.reason)}
                </td>
                <td
                  className="px-4 py-2 text-xs text-ink-soft"
                  title={r.byEmail ?? undefined}
                >
                  {r.byName || "-"}
                </td>
                <td className="px-4 py-2 text-xs text-ink-soft">
                  {r.memo || "-"}
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono ${
                    r.delta >= 0 ? "text-primary-deep" : "text-ink"
                  }`}
                >
                  {r.delta >= 0 ? "+" : ""}
                  {r.delta.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono text-ink-soft">
                  {r.balanceAfter.toLocaleString()}
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

function PriceCard({
  icon,
  label,
  tokens,
  hint,
  listTokens,
  accent,
}: {
  icon: string;
  label: string;
  tokens: number;
  hint: string;
  listTokens?: number;
  accent?: boolean;
}) {
  const discounted = listTokens != null && listTokens > tokens;
  return (
    <div
      className={`rounded-2xl p-4 border ${
        accent
          ? "bg-primary-soft border-primary/30"
          : "bg-card border-border-default shadow-sm"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <div className="text-xs font-medium text-ink-soft">{label}</div>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        {tokens === 0 ? (
          <span className="text-2xl font-bold text-ink">무료</span>
        ) : (
          <>
            {discounted && (
              <span className="text-sm font-medium text-ink-muted line-through tabular-nums">
                {listTokens!.toLocaleString()}
              </span>
            )}
            <span className="text-2xl font-bold text-ink tabular-nums">
              {tokens.toLocaleString()}
            </span>
            <span className="text-xs text-ink-muted">토큰</span>
            <span className="text-[11px] text-ink-muted ml-auto">
              {(tokens * 100).toLocaleString()}원
            </span>
          </>
        )}
      </div>
      <p className="text-[11px] text-ink-muted mt-1.5">{hint}</p>
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
    case "interview_question_gen":
      return "면접 문제 생성";
    case "offline_interview":
      return "대면 면접 평가";
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

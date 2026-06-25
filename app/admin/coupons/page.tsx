"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useStepUpFetch } from "@/app/components/StepUpModal";
import { formatLocalDate } from "@/lib/utils";

type Group = {
  id: number;
  name: string;
  tokenAmount: number;
  validFrom: string | null;
  validUntil: string | null;
  status: "active" | "disabled";
  createdAt: string;
  total: number;
  used: number;
};

export default function AdminCouponsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [err, setErr] = useState("");
  const { ensureFetch, modal: stepUpModal } = useStepUpFetch();

  // 생성 폼
  const [name, setName] = useState("");
  const [tokenAmount, setTokenAmount] = useState(500);
  const [count, setCount] = useState(10);
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");

  const load = async () => {
    const res = await fetch("/api/admin/coupons");
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setGroups((await res.json()).groups);
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setInfo("");
    try {
      const res = await ensureFetch(
        "/api/admin/coupons",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            tokenAmount,
            count,
            validFrom: validFrom || null,
            validUntil: validUntil || null,
          }),
        },
        "쿠폰 발급은 토큰 가치를 생성하는 작업입니다."
      );
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      const d = (await res.json()) as { created: number };
      setInfo(`${d.created.toLocaleString()}개 쿠폰이 생성되었습니다.`);
      setName("");
      await load();
    } catch {
      // step-up 취소
    } finally {
      setBusy(false);
    }
  };

  const disable = async (g: Group) => {
    if (
      !confirm(
        `"${g.name}" 그룹을 비활성화할까요?\n미등록 코드의 신규 등록만 차단되며, 이미 등록된 건과 지급된 토큰엔 영향이 없습니다.`
      )
    )
      return;
    const res = await fetch(`/api/admin/coupons/${g.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable" }),
    });
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    await load();
  };

  return (
    <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {stepUpModal}
      <div className="mb-6">
        <Link href="/admin/dashboard" className="text-xs text-ink-muted hover:underline">
          ← 운영
        </Link>
        <h1 className="text-2xl font-bold text-ink mt-2">쿠폰</h1>
        <p className="text-sm text-ink-muted mt-1">
          쿠폰 그룹을 발급하면 16자리 코드가 생성됩니다. 한 법인은 한 그룹에서 코드를 1개만 등록할 수 있습니다.
        </p>
      </div>

      {/* 생성 폼 */}
      <form
        onSubmit={create}
        className="bg-card border border-border-default rounded-2xl p-6 shadow-sm mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-ink-soft mb-1">
            그룹 이름
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            placeholder="예: 2026 상반기 신규가입 프로모션"
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1">
            토큰 수 (코드 1개당)
          </label>
          <input
            type="number"
            min={1}
            value={tokenAmount}
            onChange={(e) => setTokenAmount(Number(e.target.value) || 0)}
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm text-right font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1">
            생성 개수
          </label>
          <input
            type="number"
            min={1}
            max={10000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 0)}
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm text-right font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1">
            등록 시작일 <span className="text-ink-muted">(선택)</span>
          </label>
          <input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1">
            등록 종료일 <span className="text-ink-muted">(선택, 당일 포함)</span>
          </label>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm"
          />
        </div>

        {err && (
          <div className="sm:col-span-2 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
        {info && (
          <div className="sm:col-span-2 text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
            {info}
          </div>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="bg-primary hover:bg-primary-deep disabled:opacity-50 text-surface text-sm font-medium px-6 py-2.5 rounded-lg shadow-sm"
          >
            {busy ? "생성 중..." : "쿠폰 발급"}
          </button>
        </div>
      </form>

      {/* 그룹 목록 */}
      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border-default text-sm font-semibold">
          쿠폰 그룹
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="bg-surface-alt text-ink-soft text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">그룹</th>
                <th className="text-right px-4 py-2 font-medium">토큰</th>
                <th className="text-right px-4 py-2 font-medium">사용/전체</th>
                <th className="text-left px-4 py-2 font-medium">등록 기간</th>
                <th className="text-center px-4 py-2 font-medium">상태</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {groups?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-ink-muted">
                    아직 발급된 쿠폰이 없습니다.
                  </td>
                </tr>
              )}
              {groups?.map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/coupons/${g.id}`}
                      className="font-medium text-ink hover:text-primary hover:underline"
                    >
                      {g.name}
                    </Link>
                    <div className="text-[11px] text-ink-muted">
                      {formatLocalDate(g.createdAt)} 발급
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {g.tokenAmount.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-soft">
                    {g.used.toLocaleString()}/{g.total.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-soft">
                    {g.validFrom || g.validUntil
                      ? `${g.validFrom ?? "~"} ~ ${g.validUntil ?? "무제한"}`
                      : "무제한"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {g.status === "active" ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary-soft text-primary-deep">
                        활성
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-alt text-ink-muted">
                        비활성
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {g.status === "active" && (
                      <button
                        onClick={() => disable(g)}
                        className="text-xs text-ink-muted hover:text-danger"
                      >
                        비활성화
                      </button>
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

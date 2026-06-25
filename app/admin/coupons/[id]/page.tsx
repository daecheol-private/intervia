"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { formatLocalDateTime } from "@/lib/utils";

type Group = {
  id: number;
  name: string;
  tokenAmount: number;
  validFrom: string | null;
  validUntil: string | null;
  status: "active" | "disabled";
  total: number;
  used: number;
};

type Code = {
  id: number;
  display: string;
  status: "unused" | "used" | "revoked";
  redeemedOrgName: string | null;
  redeemedAt: string | null;
};

export default function CouponGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [group, setGroup] = useState<Group | null>(null);
  const [codes, setCodes] = useState<Code[]>([]);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | "used" | "unused">("all");

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/admin/coupons/${id}`);
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      const d = (await res.json()) as { group: Group; codes: Code[] };
      setGroup(d.group);
      setCodes(d.codes);
    })();
  }, [id]);

  if (err)
    return (
      <main className="max-w-3xl mx-auto px-4 py-8 text-sm text-danger">{err}</main>
    );
  if (!group)
    return (
      <main className="max-w-3xl mx-auto px-4 py-8 text-sm text-ink-muted">
        불러오는 중...
      </main>
    );

  const shown = codes.filter((c) =>
    filter === "all"
      ? true
      : filter === "used"
        ? c.status === "used"
        : c.status === "unused"
  );

  return (
    <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/admin/coupons" className="text-xs text-ink-muted hover:underline">
          ← 쿠폰
        </Link>
        <h1 className="text-2xl font-bold text-ink mt-2">{group.name}</h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft mt-2">
          <span>
            코드 1개당{" "}
            <strong className="text-ink">{group.tokenAmount.toLocaleString()}</strong> 토큰
          </span>
          <span>
            사용{" "}
            <strong className="text-ink">{group.used.toLocaleString()}</strong> /{" "}
            {group.total.toLocaleString()}
          </span>
          <span>
            등록 기간{" "}
            <strong className="text-ink">
              {group.validFrom || group.validUntil
                ? `${group.validFrom ?? "~"} ~ ${group.validUntil ?? "무제한"}`
                : "무제한"}
            </strong>
          </span>
          <span>{group.status === "active" ? "활성" : "비활성"}</span>
        </div>
      </div>

      <div className="flex gap-2 mb-3 text-xs">
        {(["all", "unused", "used"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg border ${
              filter === f
                ? "bg-primary text-surface border-primary"
                : "bg-card text-ink-soft border-border-default hover:border-primary/50"
            }`}
          >
            {f === "all" ? "전체" : f === "unused" ? "미사용" : "사용됨"}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-surface-alt text-ink-soft text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">코드</th>
                <th className="text-center px-4 py-2 font-medium">상태</th>
                <th className="text-left px-4 py-2 font-medium">등록 법인</th>
                <th className="text-left px-4 py-2 font-medium">등록 시각</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {shown.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-mono tracking-wide">{c.display}</td>
                  <td className="px-4 py-2 text-center">
                    {c.status === "used" ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary-soft text-primary-deep">
                        사용됨
                      </span>
                    ) : c.status === "revoked" ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-alt text-ink-muted">
                        회수됨
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-alt text-ink-soft">
                        미사용
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-ink-soft">
                    {c.redeemedOrgName || "-"}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-muted">
                    {c.redeemedAt ? formatLocalDateTime(c.redeemedAt) : "-"}
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

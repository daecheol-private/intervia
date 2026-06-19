"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatLocalDateTime } from "@/lib/utils";

type AppealRow = {
  id: number;
  candidateId: number;
  candidateName: string | null;
  orgId: number | null;
  orgName: string | null;
  jobTitle: string | null;
  email: string;
  reason: string;
  status: "pending" | "reviewed" | "resolved" | "rejected";
  response: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<AppealRow["status"], string> = {
  pending: "대기",
  reviewed: "검토중",
  resolved: "완료",
  rejected: "반려",
};

const STATUS_STYLE: Record<AppealRow["status"], string> = {
  pending: "bg-warning-soft text-warning border-warning/30",
  reviewed: "bg-primary-soft text-primary-deep border-primary/30",
  resolved: "bg-success-soft text-success border-success/30",
  rejected: "bg-surface-alt text-ink-soft border-border-default",
};

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "전체" },
  { value: "pending", label: "대기" },
  { value: "reviewed", label: "검토중" },
  { value: "resolved", label: "완료" },
  { value: "rejected", label: "반려" },
];

export default function AdminAppealsPage() {
  const [rows, setRows] = useState<AppealRow[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    const url = new URL("/api/admin/appeals", window.location.origin);
    if (filter) url.searchParams.set("status", filter);
    const r = await fetch(url);
    if (!r.ok) {
      setErr(await r.text());
      setRows([]);
      return;
    }
    const data = (await r.json()) as {
      results: AppealRow[];
      pendingCount: number;
    };
    setRows(data.results);
    setPendingCount(data.pendingCount);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const fmt = (s: string) => formatLocalDateTime(s);

  return (
    <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold text-ink">
        자동화 의사결정 이의제기
      </h1>
      <p className="text-sm text-ink-soft mt-1 leading-relaxed">
        개인정보 보호법 §37의2 에 따라 접수된 이의제기·설명 요청입니다. 각 건은{" "}
        <strong>법정 기한 내(자체 기준 7영업일)</strong> 검토·회신해야 합니다.
        &quot;검토&quot;를 눌러 후보자 상세에서 상태를 변경하고 후보자에게
        회신하세요.
      </p>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {pendingCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warning bg-warning-soft border border-warning/40 rounded-lg px-3 py-1.5">
            ⏳ 미처리 {pendingCount}건
          </span>
        )}
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                filter === f.value
                  ? "bg-ink text-surface border-ink"
                  : "bg-card text-ink-soft border-border-default hover:bg-surface-alt"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="mt-4 text-sm text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <div className="mt-4 overflow-x-auto border border-border-default rounded-xl bg-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt text-ink-muted text-xs">
            <tr>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">후보자</th>
              <th className="px-3 py-2 text-left">법인 / 공고</th>
              <th className="px-3 py-2 text-left">사유</th>
              <th className="px-3 py-2 text-left">접수일</th>
              <th className="px-3 py-2 text-right">처리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {rows === null && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-muted">
                  불러오는 중…
                </td>
              </tr>
            )}
            {rows !== null && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-muted">
                  이의제기가 없습니다.
                </td>
              </tr>
            )}
            {rows?.map((r) => {
              const purged = !r.candidateName;
              return (
                <tr
                  key={r.id}
                  className={r.status === "pending" ? "bg-warning-soft/40" : ""}
                >
                  <td className="px-3 py-2 align-top">
                    <span
                      className={`inline-block text-[11px] px-2 py-0.5 rounded border font-medium ${STATUS_STYLE[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-ink">
                      {r.candidateName ?? (
                        <span className="text-ink-muted">(폐기됨)</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-muted">{r.email}</div>
                  </td>
                  <td className="px-3 py-2 align-top text-ink-soft">
                    <div>{r.orgName ?? "—"}</div>
                    <div className="text-xs text-ink-muted">
                      {r.jobTitle ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-ink-soft max-w-xs">
                    <div className="line-clamp-3 whitespace-pre-wrap">
                      {r.reason}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-ink-muted whitespace-nowrap">
                    {fmt(r.createdAt)}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    {purged ? (
                      <span className="text-xs text-ink-muted">검토 불가</span>
                    ) : (
                      <Link
                        href={`/candidates/${r.candidateId}`}
                        className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
                      >
                        검토 →
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

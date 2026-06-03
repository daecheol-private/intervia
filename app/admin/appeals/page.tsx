"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  reviewed: "bg-blue-100 text-blue-800 border-blue-200",
  resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-slate-100 text-slate-600 border-slate-200",
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

  const fmt = (s: string) => new Date(s).toLocaleString("ko-KR");

  return (
    <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold text-slate-900">
        자동화 의사결정 이의제기
      </h1>
      <p className="text-sm text-slate-600 mt-1 leading-relaxed">
        개인정보 보호법 §37의2 에 따라 접수된 이의제기·설명 요청입니다. 각 건은{" "}
        <strong>법정 기한 내(자체 기준 7영업일)</strong> 검토·회신해야 합니다.
        &quot;검토&quot;를 눌러 후보자 상세에서 상태를 변경하고 후보자에게
        회신하세요.
      </p>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {pendingCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
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
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="mt-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <div className="mt-4 overflow-x-auto border border-slate-200 rounded-xl bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">후보자</th>
              <th className="px-3 py-2 text-left">법인 / 공고</th>
              <th className="px-3 py-2 text-left">사유</th>
              <th className="px-3 py-2 text-left">접수일</th>
              <th className="px-3 py-2 text-right">처리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows === null && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  불러오는 중…
                </td>
              </tr>
            )}
            {rows !== null && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  이의제기가 없습니다.
                </td>
              </tr>
            )}
            {rows?.map((r) => {
              const purged = !r.candidateName;
              return (
                <tr
                  key={r.id}
                  className={r.status === "pending" ? "bg-amber-50/40" : ""}
                >
                  <td className="px-3 py-2 align-top">
                    <span
                      className={`inline-block text-[11px] px-2 py-0.5 rounded border font-medium ${STATUS_STYLE[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-slate-900">
                      {r.candidateName ?? (
                        <span className="text-slate-400">(폐기됨)</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">{r.email}</div>
                  </td>
                  <td className="px-3 py-2 align-top text-slate-700">
                    <div>{r.orgName ?? "—"}</div>
                    <div className="text-xs text-slate-500">
                      {r.jobTitle ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-slate-600 max-w-xs">
                    <div className="line-clamp-3 whitespace-pre-wrap">
                      {r.reason}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-slate-500 whitespace-nowrap">
                    {fmt(r.createdAt)}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    {purged ? (
                      <span className="text-xs text-slate-400">검토 불가</span>
                    ) : (
                      <Link
                        href={`/candidates/${r.candidateId}`}
                        className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap"
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/app/components/Modal";
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  SOURCE_LABEL,
  INQUIRY_STATUSES,
  type InquiryStatus,
  type InquirySource,
} from "@/lib/inquiry";

type InquiryRow = {
  id: number;
  source: InquirySource;
  category: string;
  message: string;
  contactEmail: string;
  status: InquiryStatus;
  adminNote: string | null;
  orgId: number | null;
  orgName: string | null;
  candidateId: number | null;
  candidateName: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

const STATUS_STYLE: Record<InquiryStatus, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-200",
  in_progress: "bg-blue-100 text-blue-800 border-blue-200",
  resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const SOURCE_STYLE: Record<InquirySource, string> = {
  org_user: "bg-indigo-100 text-indigo-700 border-indigo-200",
  candidate: "bg-slate-100 text-slate-600 border-slate-200",
};

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "전체" },
  { value: "open", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

const fmt = (s: string) => new Date(s).toLocaleString("ko-KR");

function StatusBadge({ status }: { status: InquiryStatus }) {
  return (
    <span
      className={`inline-block text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function InquiriesInbox() {
  const [rows, setRows] = useState<InquiryRow[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<InquiryRow | null>(null);

  const load = useCallback(async () => {
    setErr("");
    const url = new URL("/api/admin/inquiries", window.location.origin);
    if (filter) url.searchParams.set("status", filter);
    const r = await fetch(url);
    if (!r.ok) {
      setErr(await r.text());
      setRows([]);
      return;
    }
    const data = (await r.json()) as {
      results: InquiryRow[];
      openCount: number;
    };
    setRows(data.results);
    setOpenCount(data.openCount);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold text-slate-900">고객센터 문의함</h1>
      <p className="text-sm text-slate-600 mt-1 leading-relaxed">
        고객(법인)과 후보자가 접수한 문의·불편사항입니다. 행을 클릭해 상세를 열고
        상태·답변을 남기면 고객의 &quot;내 문의 내역&quot;에 반영됩니다.
      </p>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {openCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            ⏳ 미처리 {openCount}건
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
              <th className="px-3 py-2.5 text-left w-16">상태</th>
              <th className="px-3 py-2.5 text-left w-16">출처</th>
              <th className="px-3 py-2.5 text-left w-24">분류</th>
              <th className="px-3 py-2.5 text-left">내용</th>
              <th className="px-3 py-2.5 text-left w-36">법인 / 연락처</th>
              <th className="px-3 py-2.5 text-left w-36">접수일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows === null && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                  불러오는 중…
                </td>
              </tr>
            )}
            {rows !== null && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                  문의가 없습니다.
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr
                key={r.id}
                onClick={() => setDetail(r)}
                className={`cursor-pointer transition-colors ${
                  r.status === "open"
                    ? "bg-amber-50/40 hover:bg-amber-50"
                    : "hover:bg-slate-50"
                }`}
              >
                <td className="px-3 py-2.5 align-top">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2.5 align-top">
                  <span
                    className={`inline-block text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap ${SOURCE_STYLE[r.source]}`}
                  >
                    {SOURCE_LABEL[r.source]}
                  </span>
                </td>
                <td className="px-3 py-2.5 align-top text-slate-700 whitespace-nowrap">
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </td>
                <td className="px-3 py-2.5 align-top text-slate-800 max-w-0">
                  <div className="truncate">{r.message}</div>
                  {r.adminNote && (
                    <span className="text-[11px] text-emerald-600">
                      ↳ 답변 완료
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top text-xs text-slate-600 max-w-0">
                  <div className="truncate">{r.orgName ?? "—"}</div>
                  <div className="truncate text-slate-400">{r.contactEmail}</div>
                </td>
                <td className="px-3 py-2.5 align-top text-xs text-slate-500 whitespace-nowrap">
                  {fmt(r.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InquiryDetailModal
        row={detail}
        onClose={() => setDetail(null)}
        onSaved={() => {
          setDetail(null);
          void load();
        }}
      />
    </main>
  );
}

function InquiryDetailModal({
  row,
  onClose,
  onSaved,
}: {
  row: InquiryRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<InquiryStatus>("open");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // 모달이 새 행으로 열릴 때마다 편집 상태 초기화.
  useEffect(() => {
    if (row) {
      setStatus(row.status);
      setNote(row.adminNote ?? "");
    }
  }, [row]);

  const dirty =
    row !== null && (status !== row.status || note !== (row.adminNote ?? ""));

  const save = async () => {
    if (!row) return;
    setBusy(true);
    const res = await fetch(`/api/admin/inquiries/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, adminNote: note }),
    });
    setBusy(false);
    if (res.ok) onSaved();
  };

  return (
    <Modal
      open={row !== null}
      onClose={onClose}
      title="문의 상세 / 처리"
      maxWidth="max-w-xl"
    >
      {row && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-block text-[11px] px-2 py-0.5 rounded border font-medium ${SOURCE_STYLE[row.source]}`}
            >
              {SOURCE_LABEL[row.source]}
            </span>
            <span className="text-xs font-medium text-slate-700">
              {CATEGORY_LABEL[row.category] ?? row.category}
            </span>
            <StatusBadge status={row.status} />
            <span className="text-[11px] text-slate-400">
              {fmt(row.createdAt)}
            </span>
          </div>

          <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>법인: {row.orgName ?? "—"}</span>
            {row.source === "candidate" && (
              <span>후보자: {row.candidateName ?? "(폐기됨)"}</span>
            )}
            <a
              href={`mailto:${row.contactEmail}`}
              className="text-blue-600 hover:underline"
            >
              {row.contactEmail}
            </a>
          </div>

          <div>
            <div className="text-[11px] font-medium text-slate-500 mb-1">
              문의 내용
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3">
              {row.message}
            </p>
          </div>

          <div className="pt-1 border-t border-slate-100">
            <label className="block text-[11px] font-medium text-slate-500 mb-1 mt-3">
              운영팀 답변 (고객에게 노출됨)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed"
              placeholder="처리 결과나 안내를 작성하면 고객의 문의 내역에 답변으로 표시됩니다."
            />
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              ✉️ <span className="font-medium text-slate-500">완료</span>로
              변경하거나 답변을 작성해 저장하면, 문의자({row.contactEmail})에게
              처리 상태·답변이 이메일로 발송됩니다.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1.5">
              {INQUIRY_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    status === s
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="text-xs px-4 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                닫기
              </button>
              <button
                onClick={save}
                disabled={busy || !dirty}
                className="text-xs px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-white font-medium disabled:opacity-40"
              >
                {busy ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

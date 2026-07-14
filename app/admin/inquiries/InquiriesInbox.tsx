"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/app/components/Modal";
import { formatLocalDateTime } from "@/lib/utils";
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
  contactPhone: string | null;
  status: InquiryStatus;
  adminNote: string | null;
  orgId: number | null;
  orgName: string | null;
  candidateId: number | null;
  candidateName: string | null;
  jobId: number | null;
  jobTitle: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

const STATUS_STYLE: Record<InquiryStatus, string> = {
  open: "bg-warning-soft text-warning border-warning/30",
  in_progress: "bg-primary-soft text-primary-deep border-primary/30",
  resolved: "bg-success-soft text-success border-success/30",
};

const SOURCE_STYLE: Record<InquirySource, string> = {
  org_user: "bg-surface-alt text-ink-soft border-border-default",
  candidate: "bg-surface-alt text-ink-soft border-border-default",
  applicant: "bg-surface-alt text-ink-soft border-border-default",
};

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "전체" },
  { value: "open", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

const fmt = (s: string) => formatLocalDateTime(s);

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
      <h1 className="text-xl font-bold text-ink">고객센터 문의함</h1>
      <p className="text-sm text-ink-soft mt-1 leading-relaxed">
        고객(법인)과 후보자가 접수한 문의·불편사항입니다. 행을 클릭해 상세를 열고
        상태·답변을 남기면 고객의 &quot;내 문의 내역&quot;에 반영됩니다.
      </p>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {openCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warning bg-warning-soft border border-warning/30 rounded-lg px-3 py-1.5">
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
              <th className="px-3 py-2.5 text-left w-16">상태</th>
              <th className="px-3 py-2.5 text-left w-16">출처</th>
              <th className="px-3 py-2.5 text-left w-24">분류</th>
              <th className="px-3 py-2.5 text-left">내용</th>
              <th className="px-3 py-2.5 text-left w-36">법인 / 연락처</th>
              <th className="px-3 py-2.5 text-left w-36">접수일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {rows === null && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-ink-muted">
                  불러오는 중…
                </td>
              </tr>
            )}
            {rows !== null && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-ink-muted">
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
                    ? "bg-warning-soft/40 hover:bg-warning-soft"
                    : "hover:bg-surface-alt"
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
                <td className="px-3 py-2.5 align-top text-ink-soft whitespace-nowrap">
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </td>
                <td className="px-3 py-2.5 align-top text-ink max-w-0">
                  <div className="truncate">{r.message}</div>
                  {r.adminNote && (
                    <span className="text-[11px] text-success">
                      ↳ 답변 완료
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top text-xs text-ink-soft max-w-0">
                  <div className="truncate">{r.orgName ?? "—"}</div>
                  <div className="truncate text-ink-muted">{r.contactEmail}</div>
                </td>
                <td className="px-3 py-2.5 align-top text-xs text-ink-muted whitespace-nowrap">
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

  const remove = async () => {
    if (!row) return;
    if (
      !confirm(
        "이 문의를 삭제합니까?\n고객의 문의 내역에서도 사라지며 복구할 수 없습니다."
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/admin/inquiries/${row.id}`, {
      method: "DELETE",
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
            <span className="text-xs font-medium text-ink-soft">
              {CATEGORY_LABEL[row.category] ?? row.category}
            </span>
            <StatusBadge status={row.status} />
            <span className="text-[11px] text-ink-muted">
              {fmt(row.createdAt)}
            </span>
          </div>

          <div className="text-xs text-ink-muted flex flex-wrap gap-x-3 gap-y-0.5">
            <span>법인: {row.orgName ?? "—"}</span>
            {row.source === "candidate" && (
              <span>후보자: {row.candidateName ?? "(폐기됨)"}</span>
            )}
            {row.source === "applicant" && (
              <span>공고: {row.jobTitle ?? "(삭제됨)"}</span>
            )}
            <a
              href={`mailto:${row.contactEmail}`}
              className="text-primary hover:underline"
            >
              {row.contactEmail}
            </a>
            {row.contactPhone && (
              <a
                href={`tel:${row.contactPhone}`}
                className="text-primary hover:underline"
              >
                {row.contactPhone}
              </a>
            )}
          </div>

          <div>
            <div className="text-[11px] font-medium text-ink-muted mb-1">
              문의 내용
            </div>
            <p className="text-sm text-ink-soft whitespace-pre-wrap leading-relaxed bg-surface-alt border border-border-default rounded-lg p-3">
              {row.message}
            </p>
          </div>

          <div className="pt-1 border-t border-border-default">
            <label className="block text-[11px] font-medium text-ink-muted mb-1 mt-3">
              운영팀 답변 (고객에게 노출됨)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed"
              placeholder="처리 결과나 안내를 작성하면 고객의 문의 내역에 답변으로 표시됩니다."
            />
            <p className="text-[11px] text-ink-muted mt-1.5 leading-relaxed">
              ✉️ <span className="font-medium text-ink-muted">완료</span>로
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
                      ? "bg-ink text-surface border-ink"
                      : "bg-card text-ink-soft border-border-default hover:bg-surface-alt"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={remove}
                disabled={busy}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-danger/30 text-danger hover:bg-danger-soft disabled:opacity-40"
              >
                <Trash2 size={13} />
                삭제
              </button>
              <button
                onClick={onClose}
                className="text-xs px-4 py-1.5 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt"
              >
                닫기
              </button>
              <button
                onClick={save}
                disabled={busy || !dirty}
                className="text-xs px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface font-medium disabled:opacity-40"
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

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/app/components/Modal";
import { formatLocalDateTime } from "@/lib/utils";
import {
  ORG_CATEGORIES,
  CATEGORY_LABEL,
  STATUS_LABEL,
  MESSAGE_MAX,
  MESSAGE_MIN,
  type InquiryStatus,
} from "@/lib/inquiry";

type MyInquiry = {
  id: number;
  category: string;
  message: string;
  status: InquiryStatus;
  adminNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

const STATUS_STYLE: Record<InquiryStatus, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-200",
  in_progress: "bg-blue-100 text-blue-800 border-blue-200",
  resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

function StatusBadge({ status }: { status: InquiryStatus }) {
  return (
    <span
      className={`inline-block text-[11px] px-2 py-0.5 rounded border font-medium whitespace-nowrap ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const fmt = (s: string) => formatLocalDateTime(s);

export default function SupportPage() {
  const [rows, setRows] = useState<MyInquiry[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<MyInquiry | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/support/inquiries");
    if (!r.ok) return;
    const data = (await r.json()) as { results: MyInquiry[] };
    setRows(data.results);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink">고객센터</h1>
          <p className="text-sm text-ink-soft mt-1 leading-relaxed">
            서비스 이용 중 불편사항이나 문의를 남겨 주세요. 접수 내용은 운영팀이
            확인 후 가입하신 이메일로 회신드립니다.
          </p>
        </div>
        <button
          onClick={() => setFormOpen(true)}
          className="shrink-0 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium"
        >
          + 문의하기
        </button>
      </div>

      <h2 className="text-sm font-semibold text-ink-soft mt-8 mb-2">
        내 문의 내역
      </h2>
      <div className="overflow-x-auto border border-border-default rounded-xl bg-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt text-ink-muted text-xs">
            <tr>
              <th className="px-3 py-2.5 text-left w-28">분류</th>
              <th className="px-3 py-2.5 text-left">내용</th>
              <th className="px-3 py-2.5 text-left w-20">상태</th>
              <th className="px-3 py-2.5 text-left w-40">접수일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {rows === null && (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-ink-muted">
                  불러오는 중…
                </td>
              </tr>
            )}
            {rows !== null && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-ink-muted">
                  접수한 문의가 없습니다. 우측 상단 &quot;문의하기&quot;로
                  남겨 주세요.
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr
                key={r.id}
                onClick={() => setDetail(r)}
                className="cursor-pointer hover:bg-surface-alt transition-colors"
              >
                <td className="px-3 py-2.5 align-top text-ink-soft whitespace-nowrap">
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </td>
                <td className="px-3 py-2.5 align-top text-ink max-w-0">
                  <div className="truncate">{r.message}</div>
                  {r.adminNote && (
                    <span className="text-[11px] text-success">
                      ↳ 운영팀 답변 있음
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2.5 align-top text-xs text-ink-muted whitespace-nowrap">
                  {fmt(r.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InquiryFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onDone={() => {
          setFormOpen(false);
          void load();
        }}
      />

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="문의 상세"
        maxWidth="max-w-lg"
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-ink-soft">
                {CATEGORY_LABEL[detail.category] ?? detail.category}
              </span>
              <StatusBadge status={detail.status} />
              <span className="text-[11px] text-ink-muted">
                {fmt(detail.createdAt)}
              </span>
            </div>
            <div>
              <div className="text-[11px] font-medium text-ink-muted mb-1">
                문의 내용
              </div>
              <p className="text-sm text-ink-soft whitespace-pre-wrap leading-relaxed bg-surface-alt border border-border-default rounded-lg p-3">
                {detail.message}
              </p>
            </div>
            {detail.adminNote ? (
              <div>
                <div className="text-[11px] font-medium text-success mb-1">
                  운영팀 답변
                </div>
                <p className="text-sm text-ink-soft whitespace-pre-wrap leading-relaxed bg-success-soft border border-success/30 rounded-lg p-3">
                  {detail.adminNote}
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                아직 답변이 등록되지 않았습니다. 확인 후 이메일로도 회신드립니다.
              </p>
            )}
          </div>
        )}
      </Modal>
    </main>
  );
}

function InquiryFormModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [category, setCategory] = useState<string>(ORG_CATEGORIES[0]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!message || message.length < MESSAGE_MIN) {
      setErr(`내용은 최소 ${MESSAGE_MIN}자 이상 작성해 주세요.`);
      return;
    }
    setBusy(true);
    const res = await fetch("/api/support/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, message }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setCategory(ORG_CATEGORIES[0]);
    setMessage("");
    onDone();
  };

  return (
    <Modal open={open} onClose={onClose} title="문의하기" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1">
            분류
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-card"
          >
            {ORG_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-soft mb-1">
            내용 ({MESSAGE_MIN}~{MESSAGE_MAX}자)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={7}
            maxLength={MESSAGE_MAX}
            autoFocus
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed"
            placeholder="겪으신 문제나 문의 내용을 구체적으로 작성해 주세요. 오류 화면, 발생 시각, 관련 공고·후보자 등을 함께 적어 주시면 빠르게 도와드릴 수 있습니다."
          />
          <div className="text-[11px] text-ink-muted mt-1">
            {message.length} / {MESSAGE_MAX}
          </div>
        </div>

        {err && (
          <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Link
            href="/privacy"
            target="_blank"
            className="text-xs text-ink-muted hover:text-ink-soft underline"
          >
            개인정보 처리방침
          </Link>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border-strong text-ink-soft text-sm hover:bg-surface-alt"
            >
              취소
            </button>
            <button
              onClick={submit}
              disabled={busy || message.length < MESSAGE_MIN}
              className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
            >
              {busy ? "접수 중..." : "문의 접수"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

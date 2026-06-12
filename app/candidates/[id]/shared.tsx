"use client";

import { useEffect, useState } from "react";

export const recColor: Record<string, string> = {
  강력추천: "bg-primary text-surface border-primary",
  비추천: "bg-danger-soft text-danger border-danger/30",
};
/** 강력추천/비추천만 노출. 중간 단계는 점수로 판단. */
export const showRec = (rec: string) => rec === "강력추천" || rec === "비추천";

// Low — 후보자 이름이 비어있거나 파일명으로 폴백된 경우 "(이름 미식별)" 표시.
// PII 추출 실패의 fingerprint: 이름이 null/빈문자 또는 .pdf/.docx/.txt 등 확장자 포함.
export function displayCandidateName(name: string | null | undefined): string {
  if (!name) return "(이름 미식별)";
  if (/\.(pdf|docx?|hwpx?|txt|rtf|odt)$/i.test(name.trim())) return "(이름 미식별)";
  return name;
}

// Low — 한국 휴대전화 포맷. 입력이 숫자만이면 010-XXXX-XXXX/0XX-XXX-XXXX 등 자동 표기.
// 이미 -·.·공백 포함되어 있으면 그대로 둠. 국제번호(+82) 도 그대로.
export function formatPhoneKr(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  if (/[\s\-+.]/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("010"))
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("10"))
    return `0${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10 && digits.startsWith("02"))
    return `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && /^01[016-9]/.test(digits))
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 9 && digits.startsWith("02"))
    return `02-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return trimmed;
}

/** 점수대별 강조 색 — 점수 큰 숫자에 적용. */
export function scoreColor(score: number): string {
  if (score >= 85) return "text-primary-deep";
  if (score >= 70) return "text-primary";
  if (score >= 55) return "text-warning";
  return "text-danger";
}

/** LLM 이 **단어** 로 감싼 토큰을 <strong> 으로 렌더. 마크다운은 bold 만 처리. */
export function HL({ text, mark = false }: { text: string; mark?: boolean }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\*\*([^*]+)\*\*$/.exec(p);
        if (m)
          return (
            <strong
              key={i}
              className={
                mark
                  ? "font-semibold text-ink bg-amber-100 rounded-sm px-0.5 box-decoration-clone"
                  : "font-semibold text-ink"
              }
            >
              {m[1]}
            </strong>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function InfoCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider">
        {label}
      </div>
      <div
        className="text-sm font-medium text-slate-900 mt-0.5 truncate"
        title={value ?? undefined}
      >
        {value ?? <span className="text-slate-300">-</span>}
      </div>
    </div>
  );
}

export function Section({
  title,
  children,
  defaultOpen = true,
  summary,
  collapsible = true,
  storageKey: storageKeyProp,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  summary?: React.ReactNode;
  collapsible?: boolean;
  storageKey?: string;
}) {
  const storageKey = storageKeyProp ?? `cand-section:${title}`;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!collapsible) return;
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(storageKey);
    if (v === "0") setOpen(false);
    else if (v === "1") setOpen(true);
  }, [storageKey, collapsible]);
  const toggle = () => {
    if (!collapsible) return;
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* private mode 등 */
      }
      return next;
    });
  };
  return (
    <section className="mt-4">
      <div
        className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden transition-shadow ${open ? "" : "hover:shadow-md"}`}
      >
        <button
          type="button"
          onClick={toggle}
          disabled={!collapsible}
          aria-expanded={open}
          className={`w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left ${collapsible ? "hover:bg-slate-50 cursor-pointer" : "cursor-default"} transition-colors`}
        >
          <span className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-sm font-bold text-slate-900 shrink-0">
              {title}
            </span>
            {summary && (
              <span className="text-xs text-slate-500 truncate">{summary}</span>
            )}
          </span>
          {collapsible && (
            <span
              className={`text-slate-400 text-xs transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
              aria-hidden
            >
              ▶
            </span>
          )}
        </button>
        {open && (
          <div className="border-t border-slate-100 px-6 py-5">{children}</div>
        )}
      </div>
    </section>
  );
}

export function ScoreBar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 text-xs text-slate-500">{label}</span>
      <span className="w-10 text-right font-bold text-slate-900">
        {score != null ? score : "-"}
      </span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        {score != null && (
          <div
            className="h-full bg-gradient-to-r from-primary to-primary-deep rounded-full transition-all"
            style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function Modal({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmailSentBadge({ sentAt }: { sentAt: string | null | undefined }) {
  if (!sentAt) return null;
  const days = Math.floor((Date.now() - new Date(sentAt).getTime()) / 86_400_000);
  const tone =
    days >= 14
      ? "bg-danger-soft text-danger border-danger/30"
      : days >= 7
        ? "bg-warning-soft text-warning border-warning/30"
        : "bg-primary-soft text-primary-deep border-primary/30";
  const label = days === 0 ? "오늘 면접메일 발송" : `면접메일 ${days}일 전 발송`;
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-md border ${tone}`}
      title={new Date(sentAt).toLocaleString("ko-KR")}
    >
      📧 {label}
    </span>
  );
}

"use client";

/**
 * 디자인 시스템에 맞춘 알림/확인 팝업 — 브라우저 기본 alert()/confirm() 대체.
 *
 * 사용 (어느 client 컴포넌트에서나):
 *   import { notify, confirmDialog } from "@/app/components/Dialog";
 *   notify("업로드 완료", { tone: "success", title: "업로드 결과" });
 *   if (await confirmDialog("삭제할까요?", { tone: "danger" })) { ... }
 *
 * 모듈 레벨 단일 슬롯 스토어 + 루트에 1회 마운트된 <DialogHost/> 가 렌더.
 * Context/prop-drilling 없이 호출 위치에서 alert/confirm 처럼 쓴다.
 */
import { useEffect, useState } from "react";

type Tone = "info" | "success" | "warn" | "danger";

type NoticeState = {
  kind: "notice";
  id: number;
  title: string;
  message: string;
  tone: Tone;
};
type ConfirmState = {
  kind: "confirm";
  id: number;
  title: string;
  message: string;
  tone: Tone;
  confirmText: string;
  cancelText: string;
  resolve: (v: boolean) => void;
  resolved: boolean;
};
type DialogState = NoticeState | ConfirmState;

let _listeners: Array<(d: DialogState | null) => void> = [];
let _current: DialogState | null = null;
let _seq = 0;

function emit(next: DialogState | null) {
  // 교체로 사라지는 confirm 이 미해결이면 false 로 정리 (promise 누수 방지).
  if (_current && _current.kind === "confirm" && !_current.resolved) {
    _current.resolved = true;
    _current.resolve(false);
  }
  _current = next;
  for (const l of _listeners) l(next);
}

const DEFAULT_TITLE: Record<Tone, string> = {
  info: "알림",
  success: "완료",
  warn: "확인이 필요합니다",
  danger: "주의",
};

export function notify(
  message: string,
  opts?: { title?: string; tone?: Tone }
): void {
  const tone = opts?.tone ?? "info";
  emit({
    kind: "notice",
    id: ++_seq,
    message,
    title: opts?.title ?? DEFAULT_TITLE[tone],
    tone,
  });
}

export function confirmDialog(
  message: string,
  opts?: {
    title?: string;
    tone?: Tone;
    confirmText?: string;
    cancelText?: string;
  }
): Promise<boolean> {
  const tone = opts?.tone ?? "info";
  return new Promise<boolean>((resolve) => {
    emit({
      kind: "confirm",
      id: ++_seq,
      message,
      title: opts?.title ?? DEFAULT_TITLE[tone],
      tone,
      confirmText: opts?.confirmText ?? "확인",
      cancelText: opts?.cancelText ?? "취소",
      resolve,
      resolved: false,
    });
  });
}

const TONE_META: Record<
  Tone,
  { icon: string; ring: string; chip: string; confirmBtn: string }
> = {
  info: {
    icon: "ℹ️",
    ring: "border-primary/20",
    chip: "bg-primary-soft text-primary-deep",
    confirmBtn: "bg-primary hover:bg-primary-deep text-surface",
  },
  success: {
    icon: "✅",
    ring: "border-primary/20",
    chip: "bg-primary-soft text-primary-deep",
    confirmBtn: "bg-primary hover:bg-primary-deep text-surface",
  },
  warn: {
    icon: "⚠️",
    ring: "border-warning/40",
    chip: "bg-warning-soft text-warning",
    confirmBtn: "bg-primary hover:bg-primary-deep text-surface",
  },
  danger: {
    icon: "🗑️",
    ring: "border-danger/30",
    chip: "bg-danger-soft text-danger",
    confirmBtn: "bg-danger hover:bg-danger/85 text-white",
  },
};

/** 루트 레이아웃에 1회 마운트. 모든 notify/confirmDialog 호출을 렌더. */
export function DialogHost() {
  const [d, setD] = useState<DialogState | null>(_current);

  useEffect(() => {
    const l = (x: DialogState | null) => setD(x);
    _listeners.push(l);
    return () => {
      _listeners = _listeners.filter((f) => f !== l);
    };
  }, []);

  useEffect(() => {
    if (!d) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      else if (e.key === "Enter" && d.kind === "notice") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  if (!d) return null;

  const meta = TONE_META[d.tone];
  const close = (result: boolean) => {
    if (d.kind === "confirm" && !d.resolved) {
      d.resolved = true;
      d.resolve(result);
    }
    emit(null);
  };

  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60]"
      onClick={() => close(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-card rounded-2xl p-6 w-full max-w-sm shadow-2xl border ${meta.ring} max-h-[80vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base ${meta.chip}`}
            aria-hidden
          >
            {meta.icon}
          </span>
          <h3 className="font-bold text-ink">{d.title}</h3>
        </div>
        <p className="mt-3 text-sm text-ink-soft whitespace-pre-wrap leading-relaxed overflow-y-auto">
          {d.message}
        </p>
        <div className="mt-5 flex gap-2 justify-end shrink-0">
          {d.kind === "confirm" && (
            <button
              onClick={() => close(false)}
              className="px-4 py-2 rounded-lg border border-border-strong text-ink-soft text-sm hover:bg-surface-alt"
            >
              {d.cancelText}
            </button>
          )}
          <button
            onClick={() => close(true)}
            autoFocus
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              d.kind === "confirm"
                ? meta.confirmBtn
                : "bg-primary hover:bg-primary-deep text-surface"
            }`}
          >
            {d.kind === "confirm" ? d.confirmText : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}

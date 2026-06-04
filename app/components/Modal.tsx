"use client";

/**
 * 범용 콘텐츠 모달 — 폼/상세 보기용 (alert·confirm 은 Dialog.tsx 사용).
 *
 * 오버레이 클릭 + Esc 로 닫힘, 열린 동안 body 스크롤 잠금.
 * ScheduleProposeModal 의 셸 패턴을 공통화.
 *
 *   <Modal open={open} onClose={() => setOpen(false)} title="문의하기">
 *     ...본문...
 *   </Modal>
 */
import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Tailwind max-w 유틸 (예: "max-w-lg", "max-w-2xl"). */
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-[60]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-white rounded-2xl w-full ${maxWidth} shadow-2xl max-h-[90vh] flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-bold text-slate-900 text-base">{title}</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

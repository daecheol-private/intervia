"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * 텍스트를 클립보드에 복사하는 재사용 버튼.
 * 복사 후 2초간 "복사됨" 피드백. 클립보드 차단 환경에서는 조용히 무시
 * (사용자가 문구를 직접 드래그 복사할 수 있으므로 에러로 막지 않음).
 */
export function CopyButton({
  text,
  label = "복사",
  copiedLabel = "복사됨",
  className,
  disabled,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // 클립보드 접근 차단 — 무시
        }
      }}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
      }
    >
      {copied ? (
        <Check className="w-3.5 h-3.5" strokeWidth={2.25} />
      ) : (
        <Copy className="w-3.5 h-3.5" strokeWidth={2.25} />
      )}
      {copied ? copiedLabel : label}
    </button>
  );
}

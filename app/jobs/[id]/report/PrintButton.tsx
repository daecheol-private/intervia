"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium transition-colors shadow-sm"
    >
      <Printer className="w-4 h-4" strokeWidth={2.25} />
      인쇄 / PDF 저장
    </button>
  );
}

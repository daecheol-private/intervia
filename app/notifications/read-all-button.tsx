"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReadAllButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setBusy(true);
        await fetch("/api/notifications/read-all", { method: "POST" });
        router.refresh();
        setBusy(false);
      }}
      disabled={busy}
      className="text-sm px-3 py-2 rounded-lg bg-surface-alt hover:bg-border-default text-ink-soft border border-border-default disabled:opacity-50"
    >
      {busy ? "처리 중..." : "모두 읽음 처리"}
    </button>
  );
}

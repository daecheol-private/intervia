"use client";

import { useState } from "react";
import { PasswordInput } from "@/app/components/PasswordInput";

// 비밀번호 보호 공고 잠금 해제 팝업 — 공고 목록(대시보드·공고 관리)에서 공유.
export function JobPinModal({
  jobId,
  title,
  onClose,
  onUnlocked,
}: {
  jobId: number | string;
  title: string;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length !== 4) {
      setErr("4자리 숫자를 입력하세요.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/jobs/${jobId}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pin }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      setPin("");
      return;
    }
    onUnlocked();
  };

  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <div className="text-3xl mb-2">🔒</div>
          <h3 className="font-bold text-ink">{title}</h3>
          <p className="text-sm text-ink-muted mt-1">
            공고 비밀번호 4자리를 입력하세요.
          </p>
        </div>
        <div className="mt-5">
          <PasswordInput
            autoFocus
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full border border-border-strong rounded-lg px-3 py-3 text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="••••"
          />
        </div>
        {err && <div className="text-xs text-danger mt-2 text-center">{err}</div>}
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-border-strong hover:bg-surface-alt text-sm"
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={busy || pin.length !== 4}
            className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
          >
            {busy ? "확인 중..." : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}

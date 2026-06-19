"use client";

import { useState } from "react";
import { PasswordInput } from "@/app/components/PasswordInput";

export function UnlockPanel({
  title,
  jobId,
  onUnlocked,
}: {
  title: string;
  jobId: string;
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
    <div className="bg-card border border-border-default rounded-2xl p-10 mt-6 text-center max-w-md mx-auto shadow-sm">
      <div className="text-4xl mb-3">🔒</div>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="text-sm text-ink-muted mt-1">
        이 공고는 비밀번호로 보호되어 있습니다.
      </p>
      <div className="mt-6">
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
      {err && <div className="text-xs text-danger mt-2">{err}</div>}
      <button
        onClick={submit}
        disabled={busy || pin.length !== 4}
        className="w-full mt-5 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
      >
        {busy ? "확인 중..." : "잠금 해제"}
      </button>
    </div>
  );
}

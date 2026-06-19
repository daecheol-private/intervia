"use client";

import { useState } from "react";
import { PasswordInput } from "@/app/components/PasswordInput";

/**
 * 민감 액션 직전 step-up 인증 모달.
 *
 * 사용 패턴:
 *   const [stepUp, setStepUp] = useState<{ resolve: () => void; reject: () => void } | null>(null);
 *   const requireStepUp = () => new Promise<void>((resolve, reject) => setStepUp({ resolve, reject }));
 *   const handleDangerousAction = async () => {
 *     try { await requireStepUp(); } catch { return; }  // 사용자 취소
 *     await fetch('/api/dangerous', { method: 'POST' });
 *   };
 *   return <>...{stepUp && <StepUpModal onOk={() => { stepUp.resolve(); setStepUp(null); }} onCancel={() => { stepUp.reject(); setStepUp(null); }} />}</>;
 *
 * 또는 wrappedFetch 헬퍼로 자동 처리 — withStepUp() 사용.
 */
export function StepUpModal({
  reason,
  onOk,
  onCancel,
}: {
  /** 무엇 때문에 재인증을 요구하는지 — 사용자에게 표시 */
  reason: string;
  onOk: () => void;
  onCancel: () => void;
}) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    setBusy(true);
    setErr("");
    const r = await fetch("/api/auth/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(
        r.status === 401
          ? "비밀번호가 일치하지 않습니다."
          : "인증 실패. 잠시 후 다시 시도해 주세요."
      );
      return;
    }
    onOk();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-card rounded-2xl max-w-md w-full p-6 shadow-2xl"
      >
        <div className="text-lg font-bold text-ink flex items-center gap-2">
          <span aria-hidden>🔐</span> 본인 확인
        </div>
        <div className="mt-2 text-sm text-ink-soft leading-relaxed">
          {reason}
          <br />
          <span className="text-xs text-ink-muted">
            계정 비밀번호를 다시 입력해 본인임을 확인해 주세요. 한 번 인증하면
            10분간 유효합니다.
          </span>
        </div>
        <div className="mt-4">
          <PasswordInput
            autoFocus
            value={pw}
            onChange={setPw}
            placeholder="비밀번호"
          />
        </div>
        {err && (
          <div className="mt-2 text-xs text-danger bg-danger-soft border border-danger/30 rounded px-2 py-1.5">
            {err}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-sm text-ink-soft hover:text-ink"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={busy || !pw}
            className="px-4 py-2 text-sm font-semibold bg-primary hover:bg-primary-deep text-surface rounded-lg disabled:opacity-50"
          >
            {busy ? "확인 중..." : "확인"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * step-up 자동 처리 fetch wrapper.
 * 401/403 + code='step_up_required' 응답이면 모달을 띄우고, 인증 성공 시 동일 요청 재시도.
 *
 * UI 측에서 사용:
 *   const { ensureStepUp, modal } = useStepUp();
 *   ... ensureStepUp("권한 변경") ... await fetch(...);
 *   return <>... {modal}</>;
 */
/**
 * 자동 step-up 처리 fetch wrapper.
 * 사용 패턴:
 *   const { ensureFetch, modal } = useStepUpFetch();
 *   const r = await ensureFetch("/api/admin/...", { method: "POST", ... }, "토큰 충전을 위해");
 *
 * 1) 처음 fetch → 403 + step_up_required 면 모달 띄움
 * 2) 인증 성공 시 같은 요청 재시도
 * 3) 사용자가 취소하면 throws "step_up_cancelled"
 */
export function useStepUpFetch() {
  const { ensureStepUp, modal } = useStepUp();
  const ensureFetch = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    reason: string
  ): Promise<Response> => {
    const r1 = await fetch(input, init);
    if (r1.status !== 403) return r1;
    const ct = r1.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return r1;
    const clone = r1.clone();
    let needed = false;
    try {
      const d = (await clone.json()) as { code?: string };
      needed = d?.code === "step_up_required";
    } catch {
      // ignore
    }
    if (!needed) return r1;
    await ensureStepUp(reason); // 사용자가 취소하면 throw
    return fetch(input, init);
  };
  return { ensureFetch, modal };
}

export function useStepUp() {
  const [pending, setPending] = useState<{
    reason: string;
    resolve: () => void;
    reject: () => void;
  } | null>(null);

  const ensureStepUp = (reason: string) =>
    new Promise<void>((resolve, reject) => {
      setPending({ reason, resolve, reject });
    });

  const modal = pending ? (
    <StepUpModal
      reason={pending.reason}
      onOk={() => {
        const p = pending;
        setPending(null);
        p.resolve();
      }}
      onCancel={() => {
        const p = pending;
        setPending(null);
        p.reject();
      }}
    />
  ) : null;

  return { ensureStepUp, modal };
}

"use client";

import { useEffect, useState } from "react";
import { Badge, buttonClass, inputClass } from "@/app/components/ui";

type PhoneStatus = {
  phoneMasked: string;
  status: "pending" | "verified";
  verifySentAt: string | null;
};

/**
 * 면접 일정 카카오톡 알림 번호 — 면접관으로 배정된 공고의 대면 면접이 확정·취소되면 알림톡.
 * 번호를 저장하면 그 번호로 확인 카톡이 가고, 카톡에서 확인해야 알림이 켜진다.
 * 템플릿 코드가 들어오기 전에는 서버가 enabled:false 를 줘서 패널 자체를 숨긴다.
 */
export function NotifyPhonePanel() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [phone, setPhone] = useState<PhoneStatus | null>(null);
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    void fetch("/api/account/notify-phone")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setEnabled(d?.enabled === true);
        setPhone(d?.notifyPhone ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const put = async (payload: { phone: string } | { resend: true }) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/account/notify-phone", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ type: "error", text: await res.text() });
      return;
    }
    const d = (await res.json()) as { sent: boolean; notifyPhone: PhoneStatus | null };
    setPhone(d.notifyPhone);
    setEditing(false);
    setInput("");
    setMsg(
      d.notifyPhone?.status === "verified"
        ? { type: "success", text: "이미 확인된 번호입니다. 알림을 받고 있습니다." }
        : d.sent
          ? {
              type: "success",
              text: "확인 카톡을 보냈습니다. 카톡에서 “번호 확인하고 알림 받기”를 눌러 주세요.",
            }
          : {
              type: "error",
              text: "번호는 저장했지만 확인 카톡을 보내지 못했습니다. 잠시 후 “확인 카톡 다시 받기”를 눌러 주세요.",
            }
    );
  };

  const remove = async () => {
    if (!confirm("등록된 번호를 삭제할까요? 면접 일정 카톡 알림이 중단됩니다.")) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/account/notify-phone", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setMsg({ type: "error", text: await res.text() });
      return;
    }
    setPhone(null);
    setMsg({ type: "success", text: "번호를 삭제했습니다." });
  };

  if (!loaded || !enabled) return null;

  return (
    <section className="mt-8 bg-card border border-border-default rounded-2xl p-6 shadow-sm">
      <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
        면접 일정 카카오톡 알림
      </h2>
      <p className="text-sm text-ink-soft leading-relaxed">
        면접관으로 배정된 공고의 대면 면접 일정이 확정되거나 취소되면 카카오 알림톡으로도
        알려드립니다. 번호를 저장하면 그 번호로 확인 카톡이 가고, 카톡에서 확인해야 알림이
        켜집니다. 메일 안내는 이 설정과 무관하게 계속 발송됩니다.
      </p>

      {phone && !editing ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink tabular-nums">{phone.phoneMasked}</span>
          <Badge tone={phone.status === "verified" ? "success" : "warning"}>
            {phone.status === "verified" ? "알림 받는 중" : "확인 대기"}
          </Badge>
          <div className="ml-auto flex flex-wrap gap-2">
            {phone.status === "pending" && (
              <button
                onClick={() => put({ resend: true })}
                disabled={busy}
                className={buttonClass({ size: "sm" })}
              >
                확인 카톡 다시 받기
              </button>
            )}
            <button
              onClick={() => {
                setMsg(null);
                setEditing(true);
              }}
              disabled={busy}
              className={buttonClass({ size: "sm", variant: "secondary" })}
            >
              번호 변경
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className={buttonClass({ size: "sm", variant: "secondary" })}
            >
              삭제
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className={inputClass({ className: "flex-1 min-w-[12rem]" })}
            inputMode="tel"
            autoComplete="tel"
            placeholder="010-1234-5678"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && input.trim() && put({ phone: input })}
          />
          <button
            onClick={() => put({ phone: input })}
            disabled={busy || !input.trim()}
            className={buttonClass({ size: "sm" })}
          >
            {busy ? "처리 중..." : "저장하고 확인 카톡 받기"}
          </button>
          {phone && (
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className={buttonClass({ size: "sm", variant: "secondary" })}
            >
              취소
            </button>
          )}
        </div>
      )}

      {msg && (
        <div
          className={`mt-3 text-xs rounded-lg px-3 py-2 ${
            msg.type === "error"
              ? "text-danger bg-danger-soft border border-danger/30"
              : "text-primary-deep bg-primary-soft border border-primary/30"
          }`}
        >
          {msg.text}
        </div>
      )}
      <p className="mt-3 text-[11px] text-ink-muted">
        번호는 면접 일정 알림톡 발송에만 쓰며, 삭제하면 즉시 파기됩니다.
      </p>
    </section>
  );
}

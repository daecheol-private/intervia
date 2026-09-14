"use client";

import { useEffect, useState } from "react";
import { Badge, buttonClass, inputClass } from "@/app/components/ui";

type PhoneStatus = {
  phoneMasked: string;
  status: "pending" | "verified";
  paused: boolean;
  verifySentAt: string | null;
};

const smallBtn =
  "inline-flex h-7 items-center rounded-md border border-border-strong bg-card px-2.5 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-alt disabled:opacity-50";
const smallPrimaryBtn =
  "inline-flex h-7 items-center rounded-md border border-primary bg-primary px-2.5 text-xs font-semibold text-surface transition-colors hover:bg-primary-deep disabled:opacity-50";

/**
 * 계정 설정 "내 정보"의 휴대폰 행 — 면접 일정 카카오톡 알림 번호의 등록·확인·켜기/끄기·삭제.
 * 번호를 저장하면 그 번호로 확인 카톡이 가고, 카톡에서 확인해야 알림이 켜진다.
 * 템플릿 코드가 들어오기 전에는 서버가 enabled:false 를 줘서 행 자체를 숨긴다.
 */
export function NotifyPhoneRow() {
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

  const put = async (payload: { phone: string } | { resend: true } | { paused: boolean }) => {
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
    if ("paused" in payload) return;
    setEditing(false);
    setInput("");
    setMsg(
      d.notifyPhone?.status === "verified"
        ? { type: "success", text: "이미 확인된 번호입니다." }
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
    const tip =
      phone?.status === "verified" ? "\n\n잠시 멈추려면 삭제 대신 알림 스위치를 끄세요." : "";
    if (!confirm(`등록된 번호를 삭제할까요? 면접 일정 카톡 알림이 중단되고 번호는 즉시 파기됩니다.${tip}`))
      return;
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

  const startEdit = () => {
    setMsg(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setInput("");
  };
  const save = () => {
    if (input.trim()) void put({ phone: input });
  };

  if (!loaded || !enabled) return null;

  const on = phone?.status === "verified" && !phone.paused;
  const hint =
    editing || !phone
      ? "등록하면 면접관으로 배정된 대면 면접 일정이 확정·취소될 때 카카오 알림톡으로도 알려드립니다. 저장하면 이 번호로 확인 카톡이 가며, 번호는 이 알림에만 씁니다."
      : phone.status === "pending"
        ? "카톡으로 받은 “번호 확인하고 알림 받기”를 눌러야 알림이 켜집니다."
        : phone.paused
          ? "카톡 알림을 꺼 두었습니다. 번호는 그대로 있어 켜면 바로 다시 받습니다. 메일 안내는 계속 발송됩니다."
          : "대면 면접 일정이 확정·취소되면 카카오 알림톡으로 알려드립니다.";

  return (
    <div>
      <div className="flex items-center gap-3">
        {/* 줄바꿈되는 좁은 화면에서도 라벨이 첫 줄(번호)과 나란하도록 위에 붙인다 */}
        <span
          className={`w-20 shrink-0 self-start text-ink-muted ${editing ? "leading-9" : "leading-7"}`}
        >
          휴대폰
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {editing ? (
            <>
              <input
                className={inputClass({ className: "max-w-[14rem]" })}
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                placeholder="010-1234-5678"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") cancelEdit();
                }}
              />
              <button
                onClick={save}
                disabled={busy || !input.trim()}
                className={buttonClass({ size: "sm" })}
              >
                {busy ? "처리 중..." : "저장하고 확인 카톡 받기"}
              </button>
              <button
                onClick={cancelEdit}
                disabled={busy}
                className={buttonClass({ size: "sm", variant: "secondary" })}
              >
                취소
              </button>
            </>
          ) : !phone ? (
            <>
              <span className="text-ink-muted">미등록</span>
              <button onClick={startEdit} className={smallPrimaryBtn}>
                카톡 알림 번호 등록
              </button>
            </>
          ) : (
            <>
              <span className="font-medium text-ink tabular-nums">{phone.phoneMasked}</span>
              {phone.status === "pending" ? (
                <Badge tone="warning" dot>
                  확인 대기
                </Badge>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <Switch
                    checked={on}
                    disabled={busy}
                    onChange={(next) => void put({ paused: !next })}
                  />
                  <span
                    className={`text-xs ${on ? "font-medium text-primary-deep" : "text-ink-muted"}`}
                  >
                    카톡 알림 {on ? "켜짐" : "꺼짐"}
                  </span>
                </label>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                {phone.status === "pending" && (
                  <button
                    onClick={() => void put({ resend: true })}
                    disabled={busy}
                    className={smallBtn}
                  >
                    확인 카톡 다시 받기
                  </button>
                )}
                <button onClick={startEdit} disabled={busy} className={smallBtn}>
                  번호 변경
                </button>
                <button onClick={remove} disabled={busy} className={smallBtn}>
                  삭제
                </button>
              </span>
            </>
          )}
        </div>
      </div>
      <p className="mt-1 pl-[5.75rem] text-xs leading-relaxed text-ink-muted">{hint}</p>
      {msg && (
        <div
          className={`mt-2 ml-[5.75rem] rounded-lg px-3 py-2 text-xs ${
            msg.type === "error"
              ? "border border-danger/30 bg-danger-soft text-danger"
              : "border border-primary/30 bg-primary-soft text-primary-deep"
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-border-strong"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-card shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

"use client";

import { useState } from "react";
import { Alert, buttonClass } from "@/app/components/ui";

/**
 * 번호 확인 버튼 — 링크를 여는 것만으로는 확인되지 않는다(메신저·보안 필터의 링크 미리 열기로
 * 남의 번호가 자동 확인되는 것 방지). 사람이 버튼을 눌러야 POST 가 나간다.
 */
export function VerifyPhoneActions({
  token,
  initialState,
}: {
  token: string;
  initialState: "pending" | "verified";
}) {
  const [state, setState] = useState<"pending" | "verified" | "declined">(initialState);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async (action: "confirm" | "decline") => {
    if (
      action === "decline" &&
      !confirm("이 번호로 면접 일정 알림을 받지 않고, 등록된 번호를 삭제할까요?")
    )
      return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/verify-phone/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { message?: string } | null;
      setErr(d?.message ?? "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setState(action === "confirm" ? "verified" : "declined");
  };

  if (state === "declined") {
    return (
      <Alert tone="brand" className="mt-5 text-center">
        번호를 삭제했습니다. 앞으로 이 번호로는 면접 일정 알림톡이 가지 않습니다.
      </Alert>
    );
  }

  return (
    <div className="mt-5 space-y-2">
      {state === "verified" ? (
        <Alert tone="brand" className="text-center">
          확인되었습니다. 면접 일정이 확정되거나 취소되면 카카오톡으로 안내드립니다.
        </Alert>
      ) : (
        <button
          onClick={() => send("confirm")}
          disabled={busy}
          className={buttonClass({ fullWidth: true })}
        >
          {busy ? "처리 중..." : "번호 확인하고 알림 받기"}
        </button>
      )}
      <button
        onClick={() => send("decline")}
        disabled={busy}
        className={buttonClass({ variant: "secondary", fullWidth: true })}
      >
        받지 않기
      </button>
      {err && <Alert tone="danger">{err}</Alert>}
    </div>
  );
}

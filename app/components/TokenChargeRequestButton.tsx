"use client";

import { useState } from "react";
import { Mail } from "lucide-react";

type Admin = { id: number; name: string; email: string };
type Step = "closed" | "preview" | "sending" | "done";

/**
 * 대시보드 토큰 KPI 카드 안에 노출되는 충전 요청 버튼.
 * - 일반 멤버 + 잔액 ≤ 임계값일 때만 부모에서 렌더링.
 * - 클릭 시 본 법인 org_admin 목록을 가져와 미리보기 모달 표시.
 * - 확인 시 메일 발송 API 호출.
 */
export function TokenChargeRequestButton() {
  const [step, setStep] = useState<Step>("closed");
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [err, setErr] = useState("");

  const openPreview = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setErr("");
    setStep("preview");
    try {
      const res = await fetch("/api/orgs/tokens/admins");
      if (!res.ok) {
        setErr(await res.text());
        setAdmins([]);
        return;
      }
      setAdmins(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async () => {
    setStep("sending");
    setErr("");
    try {
      const res = await fetch("/api/orgs/tokens/request-charge", {
        method: "POST",
      });
      if (!res.ok) {
        setErr(await res.text());
        setStep("preview");
        return;
      }
      setStep("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStep("preview");
    }
  };

  const close = () => {
    setStep("closed");
    setErr("");
  };

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        className="mt-2 inline-flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs bg-primary hover:bg-primary-deep text-surface rounded-md font-medium transition-colors shadow-sm"
      >
        <Mail className="w-3.5 h-3.5" strokeWidth={2.25} />
        관리자에게 충전 요청
      </button>

      {step !== "closed" && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={close}
        >
          <div
            className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {step === "done" ? (
              <>
                <div className="text-center">
                  <div className="text-4xl mb-3">✅</div>
                  <h2 className="text-base font-semibold text-ink mb-2">
                    충전 요청 메일을 보냈습니다
                  </h2>
                  <p className="text-xs text-ink-soft leading-relaxed">
                    아래 {admins.length}명의 법인 관리자에게 메일이 발송됐습니다.
                    잠시만 기다리시면 관리자가 충전을 진행해 드릴 거예요.
                  </p>
                </div>
                <ul className="mt-4 space-y-1.5 max-h-40 overflow-y-auto">
                  {admins.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-surface-alt border border-border-default"
                    >
                      <span className="font-medium text-ink">{a.name}</span>
                      <span className="text-ink-soft truncate">{a.email}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={close}
                  className="mt-5 w-full px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium transition-colors"
                >
                  확인
                </button>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-ink mb-1">
                  충전 요청 메일을 보낼까요?
                </h2>
                <p className="text-xs text-ink-soft mb-4 leading-relaxed">
                  아래 법인 관리자 전원에게 충전 요청 메일이 발송됩니다.
                </p>

                {err && (
                  <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-3">
                    {err}
                  </div>
                )}

                {admins.length === 0 && !err ? (
                  <div className="text-xs text-ink-soft text-center py-6">
                    관리자 목록 불러오는 중...
                  </div>
                ) : (
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto mb-4">
                    {admins.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-surface-alt border border-border-default"
                      >
                        <span className="w-6 h-6 rounded-full bg-primary-soft text-primary-deep flex items-center justify-center text-[10px] font-bold shrink-0">
                          {a.name?.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                        <span className="font-medium text-ink">{a.name}</span>
                        <span className="text-ink-soft truncate">{a.email}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={close}
                    disabled={step === "sending"}
                    className="px-3 py-1.5 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm transition-colors disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={send}
                    disabled={step === "sending" || admins.length === 0}
                    className="px-4 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {step === "sending" ? "발송 중..." : "메일 발송"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

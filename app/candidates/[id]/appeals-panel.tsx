"use client";

import { useEffect, useState } from "react";
import { notify } from "@/app/components/Dialog";
import { Section } from "./shared";

type Appeal = {
  id: number;
  candidateId: number;
  interviewSessionId: number;
  email: string;
  reason: string;
  status: "pending" | "reviewed" | "resolved" | "rejected";
  response: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export function AppealsPanel({ candidateId }: { candidateId: number }) {
  const [list, setList] = useState<Appeal[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = async () => {
    const r = await fetch(`/api/candidates/${candidateId}/appeals`);
    if (!r.ok) return;
    setList(await r.json());
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  if (!list || list.length === 0) return null;

  const update = async (
    appealId: number,
    body: { status?: Appeal["status"]; response?: string }
  ) => {
    setBusy(appealId);
    const r = await fetch(
      `/api/candidates/${candidateId}/appeals/${appealId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setBusy(null);
    if (!r.ok) {
      notify(await r.text(), { tone: "danger" });
      return;
    }
    void load();
  };

  const fmt = (s: string | null) =>
    s ? new Date(s).toLocaleString("ko-KR") : "-";
  const statusColor: Record<Appeal["status"], string> = {
    pending: "bg-warning-soft text-warning",
    reviewed: "bg-info-soft text-info",
    resolved: "bg-primary-soft text-primary-deep",
    rejected: "bg-surface-alt text-ink-soft",
  };

  return (
    <Section title="자동화 의사결정 이의제기" collapsible={false}>
      <div className="text-xs text-slate-500 mb-3">
        PIPA §37의2 에 따라 영업일 기준 7일 이내 답변 회신 의무. 상태를 변경하면
        후보자에게 통지되지 않으니 별도 이메일로 답변을 보내야 합니다.
      </div>
      <ul className="space-y-3">
        {list.map((a) => (
          <li
            key={a.id}
            className="bg-amber-50 border border-amber-200 rounded-xl p-4"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${statusColor[a.status]}`}
              >
                {a.status === "pending"
                  ? "검토 대기"
                  : a.status === "reviewed"
                    ? "검토 중"
                    : a.status === "resolved"
                      ? "해결됨"
                      : "기각"}
              </span>
              <span className="text-xs text-slate-700 font-medium">
                {a.email}
              </span>
              <span className="text-[11px] text-slate-500">
                · 접수 {fmt(a.createdAt)}
              </span>
              {a.reviewedAt && (
                <span className="text-[11px] text-slate-500">
                  · 처리 {fmt(a.reviewedAt)}
                </span>
              )}
            </div>
            <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-white border border-slate-200 rounded-lg p-3">
              {a.reason}
            </div>
            <details className="mt-3">
              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-900">
                내부 메모 / 상태 변경
              </summary>
              <div className="mt-2 space-y-2">
                <textarea
                  defaultValue={a.response ?? ""}
                  onBlur={(e) => {
                    if (e.target.value !== (a.response ?? ""))
                      void update(a.id, { response: e.target.value });
                  }}
                  rows={3}
                  placeholder="검토 내용 / 후보자에게 보낼 답변 초안 (내부 메모)"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      "reviewed",
                      "resolved",
                      "rejected",
                      "pending",
                    ] as Appeal["status"][]
                  )
                    .filter((s) => s !== a.status)
                    .map((s) => (
                      <button
                        key={s}
                        onClick={() => update(a.id, { status: s })}
                        disabled={busy === a.id}
                        className="text-xs px-3 py-1 rounded-md border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
                      >
                        {s === "reviewed"
                          ? "검토중으로"
                          : s === "resolved"
                            ? "해결됨으로"
                            : s === "rejected"
                              ? "기각으로"
                              : "대기로 되돌리기"}
                      </button>
                    ))}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </Section>
  );
}

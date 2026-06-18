"use client";

import { useEffect, useState } from "react";
import { notify, confirmDialog } from "@/app/components/Dialog";
import { formatLocalDateTime } from "@/lib/utils";
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
  // 답변 textarea 를 controlled 로 — 상태 버튼 클릭 시 blur 저장과의 race 없이
  // 화면에 보이는 답변 그대로 status PATCH 에 함께 실어 발송 내용을 보장.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

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
    body: { status?: Appeal["status"]; response?: string },
    candidateEmail?: string
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
    const data = (await r.json().catch(() => null)) as {
      emailSent?: boolean | null;
    } | null;
    if (data?.emailSent === true) {
      notify("후보자에게 답변 메일을 발송했습니다.");
    } else if (data?.emailSent === false) {
      notify(
        `상태는 변경되었지만 메일 발송에 실패했습니다. ${candidateEmail ?? "후보자 이메일"}로 답변을 별도 회신해 주세요 (§37의2 통지 의무).`,
        { tone: "danger" }
      );
    }
    void load();
  };

  const fmt = (s: string | null) =>
    s ? formatLocalDateTime(s) : "-";
  const statusColor: Record<Appeal["status"], string> = {
    pending: "bg-warning-soft text-warning",
    reviewed: "bg-info-soft text-info",
    resolved: "bg-primary-soft text-primary-deep",
    rejected: "bg-surface-alt text-ink-soft",
  };

  return (
    <Section title="자동화 의사결정 이의제기" collapsible={false}>
      <div className="text-xs text-slate-500 mb-3">
        PIPA §37의2 에 따라 영업일 기준 7일 이내 답변 회신 의무.
        해결됨/기각으로 변경하면 작성된 답변이 후보자 이메일로 자동
        발송됩니다.
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
                답변 작성 / 상태 변경
              </summary>
              <div className="mt-2 space-y-2">
                <textarea
                  value={drafts[a.id] ?? a.response ?? ""}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [a.id]: e.target.value }))
                  }
                  onBlur={() => {
                    const v = drafts[a.id];
                    if (v !== undefined && v !== (a.response ?? ""))
                      void update(a.id, { response: v });
                  }}
                  rows={3}
                  placeholder="후보자에게 발송될 답변 — 해결됨/기각 처리 시 이 내용이 메일로 자동 발송됩니다"
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
                        onClick={async () => {
                          const draft = drafts[a.id];
                          const body: {
                            status: Appeal["status"];
                            response?: string;
                          } = { status: s };
                          if (
                            draft !== undefined &&
                            draft !== (a.response ?? "")
                          )
                            body.response = draft;
                          if (s === "resolved" || s === "rejected") {
                            const answer =
                              body.response ?? a.response ?? "";
                            const ok = await confirmDialog(
                              answer.trim()
                                ? `작성된 답변이 후보자(${a.email})에게 메일로 발송됩니다. 계속할까요?`
                                : `답변이 비어 있습니다. 후보자(${a.email})에게 기본 안내문만 발송됩니다. 계속할까요?`,
                              { confirmText: "발송", tone: "warn" }
                            );
                            if (!ok) return;
                          }
                          void update(a.id, body, a.email);
                        }}
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

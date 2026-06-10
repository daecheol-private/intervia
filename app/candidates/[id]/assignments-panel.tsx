"use client";

import { useEffect, useState } from "react";
import { confirmDialog } from "@/app/components/Dialog";
import { Section } from "./shared";

type Assignment = {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  createdAt: string;
};
type Member = { id: number; email: string; name: string };

export function AssignmentsPanel({ candidateId }: { candidateId: number }) {
  const [list, setList] = useState<Assignment[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    const [aR, mR] = await Promise.all([
      fetch(`/api/candidates/${candidateId}/assignments`),
      fetch(`/api/orgs/members`),
    ]);
    if (aR.ok) setList(await aR.json());
    if (mR.ok) setMembers(await mR.json());
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  const add = async () => {
    if (!selected) return;
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/candidates/${candidateId}/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: Number(selected) }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setSelected("");
    void load();
  };

  const remove = async (aid: number) => {
    if (
      !(await confirmDialog("배정을 해제할까요?", {
        title: "배정 해제",
        tone: "danger",
        confirmText: "해제",
      }))
    )
      return;
    setBusy(true);
    const r = await fetch(`/api/candidates/${candidateId}/assignments/${aid}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (r.ok) void load();
  };

  const assignedIds = new Set((list ?? []).map((a) => a.userId));
  const available = (members ?? []).filter((m) => !assignedIds.has(m.id));

  return (
    <Section title="면접관 배정" collapsible={false}>
      <div className="text-xs text-slate-500 mb-3">
        같은 법인 멤버 중 면접에 참여할 사람을 배정합니다. 배정은 알림·UI 강조용
        — 메모 작성 권한은 같은 법인 누구나 있습니다.
      </div>

      <div className="flex gap-2 mb-3">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">— 면접관 선택 —</option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.email})
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={busy || !selected}
          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
        >
          배정
        </button>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-3">
          {err}
        </div>
      )}

      {!list || list.length === 0 ? (
        <div className="text-xs text-slate-400 text-center py-4">
          배정된 면접관이 없습니다.
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
            >
              <div className="text-sm">
                <span className="font-medium text-slate-900">
                  {a.userName ?? `User #${a.userId}`}
                </span>
                <span className="text-xs text-slate-500 ml-2">
                  {a.userEmail}
                </span>
              </div>
              <button
                onClick={() => remove(a.id)}
                className="text-xs text-ink-soft hover:text-danger hover:underline transition-colors"
              >
                해제
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

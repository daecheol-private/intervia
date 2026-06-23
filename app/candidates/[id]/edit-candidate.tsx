"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { Candidate } from "./types";

export function EditCandidateButton({
  candidate,
  onSaved,
  variant = "text",
}: {
  candidate: Candidate;
  onSaved: () => void | Promise<void>;
  /** text = "✎ 정보 수정" 칩 / icon = 아이콘만(헤더 우측 액션용) */
  variant?: "text" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(candidate.name);
  const [email, setEmail] = useState(candidate.email ?? "");
  const [phone, setPhone] = useState(candidate.phone ?? "");
  const [eduSchool, setEduSchool] = useState(candidate.educationSchool ?? "");
  const [eduMajor, setEduMajor] = useState(candidate.educationMajor ?? "");
  const [eduLevel, setEduLevel] = useState(candidate.educationLevel ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        educationSchool: eduSchool.trim() || null,
        educationMajor: eduMajor.trim() || null,
        educationLevel: eduLevel.trim() || null,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setOpen(false);
    await onSaved();
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt transition-colors"
          title="정보 수정"
          aria-label="정보 수정 (이름·이메일·연락처·최종학력)"
        >
          <Pencil className="w-4 h-4" />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] px-2 py-0.5 rounded-md border border-border-strong hover:bg-surface-alt text-ink-soft"
          title="이름·이메일·연락처·최종학력 수정"
        >
          ✎ 정보 수정
        </button>
      )}
      {open && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-card rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-ink">후보자 정보 수정</h3>
            <div className="mt-4 space-y-3 text-sm">
              <Field label="이름" value={name} onChange={setName} />
              <Field
                label="이메일"
                value={email}
                onChange={setEmail}
                type="email"
              />
              <Field label="연락처" value={phone} onChange={setPhone} />
              <div className="pt-1 border-t border-border-default">
                <span className="text-xs font-medium text-ink-muted">최종학력</span>
              </div>
              <Field label="학교" value={eduSchool} onChange={setEduSchool} />
              <Field label="전공/학과" value={eduMajor} onChange={setEduMajor} />
              <Field
                label="학력 (예: 학사 졸업, 석사)"
                value={eduLevel}
                onChange={setEduLevel}
              />
            </div>
            {err && (
              <div className="text-xs text-danger mt-2">{err}</div>
            )}
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-border-strong text-sm"
              >
                취소
              </button>
              <button
                onClick={submit}
                disabled={busy || name.trim().length === 0}
                className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
              >
                {busy ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-ink-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </label>
  );
}


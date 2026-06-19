"use client";

import { useState } from "react";
import {
  PasswordStrength,
  passwordMeetsPolicy,
} from "@/app/password-strength";
import LogoutButton from "@/app/logout-button";
import { PasswordInput } from "@/app/components/PasswordInput";

/**
 * 강제 비밀번호 변경 오버레이.
 *
 * `users.must_change_password = true` 인 사용자(부트스트랩 임시 비번 계정 등)에게
 * 루트 레이아웃에서 전역으로 렌더 → 변경 전까지 모든 화면을 덮어 차단한다.
 * 변경 성공 시 서버가 플래그를 해제하므로 reload 하면 오버레이가 사라진다.
 *
 * 완전히 가두지는 않음 — "로그아웃" 은 허용 (계정을 잘못 만든 경우 대비).
 */
export function ForcePasswordChange({ email }: { email: string }) {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirm: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setErr("");
    if (!form.currentPassword || !form.newPassword) {
      setErr("현재 비밀번호와 새 비밀번호를 모두 입력하세요.");
      return;
    }
    if (!passwordMeetsPolicy(form.newPassword)) {
      setErr(
        "비밀번호 정책 미충족: 10자 이상 + 영문 대/소·숫자·특수문자 중 3종 이상."
      );
      return;
    }
    if (form.newPassword !== form.confirm) {
      setErr("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    // 성공 — 서버가 must_change_password 를 해제했으므로 reload 시 오버레이 사라짐.
    setDone(true);
    window.location.reload();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="비밀번호 변경 필요"
      className="fixed inset-0 z-[100] bg-ink/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-6 my-8">
        <div className="text-2xl">🔐</div>
        <h1 className="text-lg font-bold text-ink mt-2">
          비밀번호를 변경해 주세요
        </h1>
        <p className="text-sm text-ink-soft mt-2 leading-relaxed">
          <span className="font-medium text-ink">{email}</span> 계정은 임시
          비밀번호로 생성되었습니다. 보안을 위해 새 비밀번호로 변경해야 계속 이용할
          수 있습니다.
        </p>

        <div className="space-y-4 mt-5">
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">
              현재(임시) 비밀번호
            </label>
            <PasswordInput
              className={inputCls}
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(v) => setForm({ ...form, currentPassword: v })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">
              새 비밀번호
            </label>
            <PasswordInput
              className={inputCls}
              autoComplete="new-password"
              placeholder="10자 이상, 3종 이상 조합"
              value={form.newPassword}
              onChange={(v) => setForm({ ...form, newPassword: v })}
            />
            <PasswordStrength password={form.newPassword} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-1.5">
              새 비밀번호 확인
            </label>
            <PasswordInput
              className={inputCls}
              autoComplete="new-password"
              value={form.confirm}
              onChange={(v) => setForm({ ...form, confirm: v })}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          {err && (
            <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
              {err}
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy || done}
            className="w-full bg-primary hover:bg-primary-deep disabled:opacity-50 text-surface text-sm font-medium px-5 py-2.5 rounded-lg shadow-sm"
          >
            {busy || done ? "변경 중..." : "비밀번호 변경하고 계속하기"}
          </button>

          <div className="flex justify-center pt-1">
            <LogoutButton variant="compact" />
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full border border-border-strong rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

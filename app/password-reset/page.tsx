"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PasswordStrength } from "@/app/password-strength";
import { LogoMark } from "@/app/components/Logo";
import { PasswordInput } from "@/app/components/PasswordInput";

export default function PasswordResetPage() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get("token");
  const mode: "request" | "confirm" = token ? "confirm" : "request";

  if (mode === "request") return <RequestForm />;
  return <ConfirmForm token={token!} router={router} />;
}

function RequestForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!email) {
      setErr("이메일을 입력하세요.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setDone(true);
  };

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <LogoMark size={48} className="mx-auto mb-3 shadow-lg" />
          <h1 className="text-xl font-bold text-slate-900">비밀번호 찾기</h1>
          <p className="text-sm text-slate-500 mt-1">
            가입하신 이메일로 재설정 링크를 보내드립니다.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          {done ? (
            <>
              <div className="text-sm text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-3">
                해당 이메일로 가입된 계정이 있다면 재설정 링크를 발송했습니다.
                메일함을 확인해주세요 (1시간 내 유효).
              </div>
              <Link
                href="/login"
                className="block text-center text-sm text-primary hover:underline"
              >
                로그인으로 돌아가기
              </Link>
            </>
          ) : (
            <>
              <Field label="이메일">
                <input
                  className={inputCls}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </Field>
              {err && (
                <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
                  {err}
                </div>
              )}
              <button
                onClick={submit}
                disabled={busy}
                className="w-full bg-primary hover:bg-primary-deep disabled:opacity-50 text-white font-medium py-2.5 rounded-lg shadow-sm transition-colors"
              >
                {busy ? "발송 중..." : "재설정 링크 받기"}
              </button>
              <div className="text-center text-xs text-slate-500 pt-3 border-t border-slate-100">
                <Link href="/login" className="text-primary hover:underline">
                  로그인으로 돌아가기
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function ConfirmForm({
  token,
  router,
}: {
  token: string;
  router: ReturnType<typeof useRouter>;
}) {
  const [valid, setValid] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    void fetch(`/api/auth/password-reset/confirm?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => setValid(!!d.valid));
  }, [token]);

  const submit = async () => {
    setErr("");
    if (!pw || !pw2) {
      setErr("새 비밀번호를 입력하세요.");
      return;
    }
    if (pw !== pw2) {
      setErr("비밀번호가 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: pw }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 1500);
  };

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <LogoMark size={48} className="mx-auto mb-3 shadow-lg" />
          <h1 className="text-xl font-bold text-slate-900">비밀번호 재설정</h1>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          {valid === null && (
            <div className="text-sm text-slate-400 text-center">확인 중...</div>
          )}
          {valid === false && (
            <>
              <div className="text-sm text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-3">
                이 링크는 만료되었거나 이미 사용되었습니다. 다시 요청해주세요.
              </div>
              <Link
                href="/password-reset"
                className="block text-center text-sm text-primary hover:underline"
              >
                재설정 링크 다시 요청
              </Link>
            </>
          )}
          {valid === true && !done && (
            <>
              <Field label="새 비밀번호">
                <PasswordInput
                  className={inputCls}
                  autoComplete="new-password"
                  placeholder="10자 이상, 3종 이상 조합"
                  value={pw}
                  onChange={setPw}
                />
                <PasswordStrength password={pw} />
              </Field>
              <Field label="새 비밀번호 확인">
                <PasswordInput
                  className={inputCls}
                  autoComplete="new-password"
                  value={pw2}
                  onChange={setPw2}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </Field>
              {err && (
                <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 whitespace-pre-line">
                  {err}
                </div>
              )}
              <button
                onClick={submit}
                disabled={busy}
                className="w-full bg-primary hover:bg-primary-deep disabled:opacity-50 text-white font-medium py-2.5 rounded-lg shadow-sm transition-colors"
              >
                {busy ? "처리 중..." : "비밀번호 변경"}
              </button>
            </>
          )}
          {done && (
            <div className="text-sm text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-3 text-center">
              비밀번호가 변경되었습니다. 로그인 페이지로 이동합니다...
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

const inputCls =
  "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

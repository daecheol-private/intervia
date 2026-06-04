"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PasswordStrength } from "@/app/password-strength";
import { LogoMark } from "@/app/components/Logo";
import { PasswordInput } from "@/app/components/PasswordInput";

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  // 오픈 리다이렉트 방어 — 내부 상대경로(`/...`)만 허용. `//evil`·`/\evil`·`https://evil` 차단.
  const rawNext = search.get("next") || "/";
  const next = /^\/(?![/\\])/.test(rawNext) ? rawNext : "/";
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [needsVerify, setNeedsVerify] = useState(false);
  const [info, setInfo] = useState("");
  const [totpChallenge, setTotpChallenge] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");

  useEffect(() => {
    void fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) {
          router.replace(next);
          return;
        }
        setSetupRequired(d.setupRequired);
      });
  }, [next, router]);

  const submit = async () => {
    setErr("");
    setInfo("");
    setNeedsVerify(false);
    if (!form.email || !form.password || (setupRequired && !form.name)) {
      setErr("필수 항목을 모두 입력하세요.");
      return;
    }
    setBusy(true);
    const url = setupRequired ? "/api/auth/setup" : "/api/auth/login";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data?.code === "email_unverified") {
          setNeedsVerify(true);
          setErr(data.error);
          return;
        }
        if (data?.code === "rate_limited") {
          setErr(data.error ?? "너무 많은 시도. 잠시 후 다시 시도해 주세요.");
          return;
        }
        if (data?.error) {
          setErr(data.error);
          return;
        }
      } catch {
        // not json — plain text 응답
      }
      setErr(text);
      return;
    }
    // 2FA 단계 진입 — 세션은 아직 발급 안 됨
    try {
      const data = await res.clone().json();
      if (data?.needsTotp && data?.challenge) {
        setTotpChallenge(data.challenge);
        return;
      }
    } catch {
      // not json — proceed as login success
    }
    router.replace(next);
    router.refresh();
  };

  const submitTotp = async () => {
    setErr("");
    if (!totpChallenge || totpCode.length !== 6) {
      setErr("6자리 코드를 입력하세요.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/login/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: totpChallenge, code: totpCode }),
    });
    setBusy(false);
    if (!res.ok) {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data?.code === "challenge_invalid") {
          setErr(data.error);
          setTotpChallenge(null);
          setTotpCode("");
          return;
        }
        if (data?.error) {
          setErr(data.error);
          return;
        }
      } catch {
        /* not json */
      }
      setErr(text);
      return;
    }
    router.replace(next);
    router.refresh();
  };

  const resend = async () => {
    setBusy(true);
    setInfo("");
    setErr("");
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setInfo("인증 메일을 재발송했습니다. 메일함을 확인해주세요.");
    setNeedsVerify(false);
  };

  if (setupRequired === null) {
    return (
      <main className="flex-1 flex items-center justify-center text-slate-400">
        불러오는 중...
      </main>
    );
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <LogoMark size={48} className="mx-auto mb-3 shadow-lg" />
          <h1 className="text-xl font-bold text-slate-900">
            {setupRequired ? "초기 관리자 계정 생성" : "로그인"}
          </h1>
          {setupRequired && (
            <p className="text-sm text-slate-500 mt-1">
              최초 1회 관리자 계정을 생성합니다.
            </p>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          {totpChallenge ? (
            <>
              <p className="text-sm text-slate-600">
                Authenticator 앱의 6자리 코드를 입력하세요.
              </p>
              <Field label="인증 코드">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && submitTotp()}
                />
              </Field>
              {err && (
                <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
                  {err}
                </div>
              )}
              <button
                onClick={submitTotp}
                disabled={busy || totpCode.length !== 6}
                className="w-full bg-primary hover:bg-primary-deep disabled:opacity-50 text-white font-medium py-2.5 rounded-lg shadow-sm transition-colors"
              >
                {busy ? "확인 중..." : "확인"}
              </button>
              <button
                onClick={() => {
                  setTotpChallenge(null);
                  setTotpCode("");
                  setErr("");
                }}
                className="w-full text-xs text-slate-500 hover:underline"
              >
                처음으로 돌아가기
              </button>
            </>
          ) : (
          <>
          {setupRequired && (
            <Field label="이름">
              <input
                className={inputCls}
                placeholder="홍길동"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
          )}
          <Field label="이메일">
            <input
              className={inputCls}
              type="email"
              autoComplete="email"
              placeholder="admin@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="비밀번호">
            <PasswordInput
              className={inputCls}
              autoComplete={setupRequired ? "new-password" : "current-password"}
              placeholder={setupRequired ? "10자 이상, 3종 이상 조합" : ""}
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {setupRequired && <PasswordStrength password={form.password} />}
          </Field>

          {err && (
            <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
              {err}
              {needsVerify && (
                <button
                  onClick={resend}
                  disabled={busy}
                  className="ml-2 underline hover:opacity-80 disabled:opacity-50"
                >
                  인증 메일 재발송
                </button>
              )}
            </div>
          )}
          {info && (
            <div className="text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
              {info}
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full bg-primary hover:bg-primary-deep disabled:opacity-50 text-white font-medium py-2.5 rounded-lg shadow-sm transition-colors"
          >
            {busy
              ? "처리 중..."
              : setupRequired
                ? "관리자 계정 생성"
                : "로그인"}
          </button>

          {!setupRequired && (
            <div className="text-center text-xs text-slate-500 pt-3 border-t border-slate-100 space-y-2">
              <div>
                <Link
                  href="/password-reset"
                  className="text-slate-600 hover:text-primary hover:underline"
                >
                  비밀번호를 잊으셨나요?
                </Link>
              </div>
              <div>
                계정이 없나요?{" "}
                <Link href="/signup" className="text-primary hover:underline">
                  회원가입
                </Link>
              </div>
            </div>
          )}
          </>
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

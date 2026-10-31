"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PasswordInput } from "@/app/components/PasswordInput";

export default function VerifyPage() {
  const search = useSearchParams();
  const token = search.get("token");
  const [state, setState] = useState<"input" | "loading" | "ok" | "err">(token ? "input" : "err");
  const [msg, setMsg] = useState(token ? "" : "토큰이 없습니다.");
  const [password, setPassword] = useState("");

  // 가입할 때 정한 비밀번호를 확인한 뒤 인증 — 남의 이메일로 가입한 계정이 링크 클릭만으로 살아나지 않게.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !password) return;
    setState("loading");
    const res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (res.status === 401) {
      setState("input");
      setMsg(await res.text());
      return;
    }
    if (!res.ok) {
      setState("err");
      setMsg(await res.text());
      return;
    }
    setState("ok");
  };

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card border border-border-default rounded-2xl p-6 shadow-sm text-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary-deep mx-auto mb-4 flex items-center justify-center text-surface font-bold shadow-lg">
          ✓
        </div>
        {state === "input" && (
          <form onSubmit={submit} className="text-left">
            <h1 className="text-lg font-bold text-ink text-center">이메일 인증</h1>
            <p className="text-sm text-ink-muted mt-2 text-center">
              가입할 때 정한 비밀번호를 입력하면 인증이 완료됩니다.
            </p>
            <div className="mt-4">
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="비밀번호"
                autoComplete="current-password"
              />
            </div>
            {msg && <p className="text-xs text-danger mt-2">{msg}</p>}
            <button
              type="submit"
              disabled={!password}
              className="w-full mt-4 px-4 py-2 bg-primary hover:bg-primary-deep text-surface text-sm font-medium rounded-lg disabled:opacity-50"
            >
              인증 완료
            </button>
            <p className="text-xs text-ink-muted mt-3 text-center">
              직접 가입하지 않았다면 이 페이지를 닫아 주세요.
            </p>
          </form>
        )}
        {state === "loading" && (
          <p className="text-sm text-ink-muted">인증 중...</p>
        )}
        {state === "ok" && (
          <>
            <h1 className="text-lg font-bold text-ink">인증 완료</h1>
            <p className="text-sm text-ink-muted mt-2">
              이메일 인증이 완료되었습니다. 이제 로그인할 수 있습니다.
            </p>
            <Link
              href="/login"
              className="inline-block mt-4 px-4 py-2 bg-primary hover:bg-primary-deep text-surface text-sm font-medium rounded-lg"
            >
              로그인
            </Link>
          </>
        )}
        {state === "err" && (
          <>
            <h1 className="text-lg font-bold text-ink">인증 실패</h1>
            <p className="text-sm text-danger mt-2">{msg}</p>
            <Link
              href="/login"
              className="inline-block mt-4 px-4 py-2 bg-surface-alt hover:bg-surface-alt text-ink-soft text-sm font-medium rounded-lg border border-border-strong"
            >
              로그인 화면으로
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function VerifyPage() {
  const search = useSearchParams();
  const token = search.get("token");
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setState("err");
      setMsg("토큰이 없습니다.");
      return;
    }
    void (async () => {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        setState("err");
        setMsg(await res.text());
        return;
      }
      setState("ok");
    })();
  }, [token]);

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-card border border-border-default rounded-2xl p-6 shadow-sm text-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary-deep mx-auto mb-4 flex items-center justify-center text-surface font-bold shadow-lg">
          ✓
        </div>
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

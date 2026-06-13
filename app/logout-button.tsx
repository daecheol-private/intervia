"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton({
  variant = "compact",
}: {
  variant?: "compact" | "full";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    // 세션 단위 클라이언트 캐시 비우기 — 같은 탭에서 다른 사용자가 재로그인할 때
    // 이전 사용자의 상태가 새지 않도록. (가이드 숨김 캐시는 개인 단위이므로 특히 중요.
    // localStorage 의 기기 환경설정(가이드 접힘/위치)은 보존)
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    router.replace("/login");
    router.refresh();
  };

  if (variant === "full") {
    return (
      <button
        onClick={logout}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg border border-slate-300 disabled:opacity-50 transition-colors"
      >
        <span aria-hidden>↪</span>
        {busy ? "로그아웃 중..." : "로그아웃"}
      </button>
    );
  }

  return (
    <button
      onClick={logout}
      disabled={busy}
      title="로그아웃"
      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-rose-700 px-2.5 py-1.5 rounded-md border border-slate-300 hover:border-rose-300 hover:bg-rose-50 transition-colors disabled:opacity-50"
    >
      <span aria-hidden>↪</span>
      <span>{busy ? "..." : "로그아웃"}</span>
    </button>
  );
}

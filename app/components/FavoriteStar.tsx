"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function FavoriteStar({
  jobId,
  initial,
  size = "sm",
}: {
  jobId: number;
  initial: boolean;
  size?: "sm" | "md";
}) {
  const [favorited, setFavorited] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !favorited;
    setFavorited(next); // optimistic
    const r = await fetch(`/api/jobs/${jobId}/favorite`, {
      method: next ? "POST" : "DELETE",
    });
    if (!r.ok) {
      setFavorited(!next); // rollback
      alert("즐겨찾기 변경 실패");
      return;
    }
    // 정렬 갱신 위해 페이지 데이터 새로 가져오기
    startTransition(() => router.refresh());
  };

  const cls = size === "md" ? "text-xl" : "text-base";
  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={`${cls} leading-none transition-transform hover:scale-110 disabled:opacity-50 ${
        favorited ? "text-amber-400" : "text-slate-300 hover:text-amber-300"
      }`}
      title={favorited ? "즐겨찾기 해제" : "즐겨찾기"}
      aria-label={favorited ? "즐겨찾기 해제" : "즐겨찾기"}
    >
      {favorited ? "★" : "☆"}
    </button>
  );
}

"use client";

import { useState } from "react";

export function CandidateFavoriteStar({
  candidateId,
  initial,
  size = "sm",
  onToggle,
}: {
  candidateId: number;
  initial: boolean;
  size?: "sm" | "md";
  onToggle?: (favorited: boolean) => void;
}) {
  const [favorited, setFavorited] = useState(initial);
  const [busy, setBusy] = useState(false);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !favorited;
    setFavorited(next);
    setBusy(true);
    const r = await fetch(`/api/candidates/${candidateId}/favorite`, {
      method: next ? "POST" : "DELETE",
    });
    setBusy(false);
    if (!r.ok) {
      setFavorited(!next);
      alert("즐겨찾기 변경 실패");
      return;
    }
    onToggle?.(next);
  };

  const cls = size === "md" ? "text-xl" : "text-base";
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`${cls} leading-none transition-transform hover:scale-110 disabled:opacity-50 ${
        favorited ? "text-amber-400" : "text-border-strong hover:text-amber-300"
      }`}
      title={favorited ? "즐겨찾기 해제" : "즐겨찾기"}
      aria-label={favorited ? "즐겨찾기 해제" : "즐겨찾기"}
    >
      {favorited ? "★" : "☆"}
    </button>
  );
}

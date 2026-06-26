"use client";

import { useState } from "react";
import { Star } from "lucide-react";

export function CandidateFavoriteStar({
  candidateId,
  initial,
  size = "sm",
  framed,
  onToggle,
}: {
  candidateId: number;
  initial: boolean;
  size?: "sm" | "md";
  /** 테두리 박스(아이콘 버튼) 형태 — 상세 페이지 액션 줄에서 삭제 버튼과 톤을 맞출 때. */
  framed?: boolean;
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

  const iconSize = size === "md" ? "w-5 h-5" : "w-4 h-4";
  const className = framed
    ? // 삭제 버튼과 같은 32px 박스 + 테두리. 즐겨찾기면 별·테두리가 호박색으로 켜진다.
      `inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors hover:bg-surface-alt disabled:opacity-50 ${
        favorited
          ? "text-amber-400 border-amber-300"
          : "text-border-strong border-border-strong hover:text-amber-300"
      }`
    : `inline-flex items-center justify-center transition-transform hover:scale-110 disabled:opacity-50 ${
        favorited ? "text-amber-400" : "text-border-strong hover:text-amber-300"
      }`;
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={className}
      title={favorited ? "즐겨찾기 해제" : "즐겨찾기"}
      aria-label={favorited ? "즐겨찾기 해제" : "즐겨찾기"}
    >
      <Star
        className={iconSize}
        strokeWidth={2}
        fill={favorited ? "currentColor" : "none"}
      />
    </button>
  );
}

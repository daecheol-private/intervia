"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

export type TabKey =
  | "overview"
  | "screening"
  | "ai"
  | "round1"
  | "round2"
  | "files";

export type TabItem = {
  key: TabKey;
  label: string;
  Icon: LucideIcon;
  on: boolean;
  hint: string;
};

/**
 * 후보자 상세 — 스크롤로 상단 탭이 사라진 뒤 본문 좌측에 붙어 나타나는 세로 탭 레일.
 * 본문 카드 왼쪽 가장자리에 밀착(오른쪽 테두리·모서리 없음)해, 본문에서 이어진 탭처럼 보인다.
 *
 * - 데스크톱(lg+) 전용.
 * - 위치는 고정값(left/top). ⚠️ left 는 현재 창 너비 기준이라 창 크기·해상도가 바뀌면 어긋난다.
 * - 표시 여부: 상단 탭바(sentinelRef)가 화면 위로 사라졌는지로 판정(IntersectionObserver).
 */
export function CandidateTabRail({
  items,
  current,
  onSelect,
  sentinelRef,
}: {
  items: TabItem[];
  current: TabKey;
  onSelect: (k: TabKey) => void;
  sentinelRef: React.RefObject<HTMLElement | null>;
}) {
  // 상단 탭바가 화면 위로 사라졌는지.
  const [past, setPast] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    // 상단 고정 영역(액션 바) 높이만큼 보정해, 탭바가 그 아래로 가려지면 사라진 것으로 본다.
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting), {
      rootMargin: "-72px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [sentinelRef]);

  if (!past) return null;

  return (
    <nav
      aria-label="후보자 상세 탭 (빠른 이동)"
      // 토론 패널이 열리면 본문이 --iv-chat-shift(음수 px)만큼 왼쪽으로 밀린다.
      // fixed 레일은 본문 relative 이동의 영향을 받지 않으므로, 같은 값을 left 에 더해
      // 본문과 lockstep 으로 움직여 정렬을 유지한다(닫히면 0px → 507 원위치).
      style={{ left: "calc(507px + var(--iv-chat-shift, 0px))", top: 58 }}
      className="hidden lg:flex fixed z-30 flex-col gap-1 rounded-l-2xl border-y border-l border-border-default bg-card p-1.5 shadow-[-3px_2px_10px_rgba(15,23,42,0.06)] transition-[left] duration-300 ease-out motion-reduce:transition-none"
    >
      {items.map((t) => {
        const active = current === t.key;
        return (
          <button
            key={t.key}
            type="button"
            disabled={!t.on}
            onClick={() => t.on && onSelect(t.key)}
            aria-current={active ? "page" : undefined}
            aria-label={t.label}
            title={t.on ? t.label : t.hint || t.label}
            className={
              "flex items-center justify-center w-9 h-9 rounded-xl transition-colors " +
              (!t.on
                ? "text-ink-muted/40 cursor-not-allowed"
                : active
                  ? "bg-primary text-white"
                  : "text-ink-soft hover:bg-surface-alt hover:text-ink")
            }
          >
            <t.Icon className="w-[18px] h-[18px]" />
          </button>
        );
      })}
    </nav>
  );
}

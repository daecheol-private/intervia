"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

// 본문 좌측 거터에 충분한 공간이 없으면(좁은 화면) 레일이 사이드바·본문을 침범하므로 숨긴다.
// 위치 계산이 아니라 "숨김 판정"에만 쓰는 근사값이라 정확할 필요는 없다(레일 폭 ≈ 49px + 여유).
const RAIL_GUTTER_MIN = 60;

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
  // 탭 라벨/아이콘 옆에 표시할 갯수 배지(예: 첨부파일 수). 0·미정(undefined)이면 숨김.
  count?: number;
};

/**
 * 후보자 상세 — 스크롤로 상단 탭이 사라진 뒤 본문 좌측에 붙어 나타나는 세로 탭 레일.
 * 본문 카드 왼쪽 가장자리에 밀착(오른쪽 테두리·모서리 없음)해, 본문에서 이어진 탭처럼 보인다.
 *
 * - 데스크톱(lg+) 전용.
 * - 가로 위치: 고정값이 아니라 본문 카드의 좌측 가장자리(anchorRef)를 실측해 그 왼쪽에 붙인다.
 *   창 크기·화면 배율·좌측레일 접힘·반응형 패딩이 바뀌어 본문이 움직여도 ResizeObserver/resize
 *   로 재측정해 항상 정렬을 유지한다. (예전엔 left 를 507px 로 박아 창 크기가 바뀌면 어긋났다.)
 * - 표시 여부: 상단 탭바(sentinelRef)가 화면 위로 사라졌는지로 판정(IntersectionObserver).
 */
export function CandidateTabRail({
  items,
  current,
  onSelect,
  sentinelRef,
  anchorRef,
}: {
  items: TabItem[];
  current: TabKey;
  onSelect: (k: TabKey) => void;
  sentinelRef: React.RefObject<HTMLElement | null>;
  // 본문 카드와 같은 좌측 가장자리를 갖는 전폭 요소(레일의 가로 정렬 기준).
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  // 상단 탭바가 화면 위로 사라졌는지.
  const [past, setPast] = useState(false);
  // 본문 카드 좌측 가장자리의 x좌표(채팅 shift 제외한 기준값). null=아직 미측정.
  const [cardLeft, setCardLeft] = useState<number | null>(null);

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

  // 본문 카드의 실제 좌측 위치를 실측 → 레일을 그 가장자리에 정렬.
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const measure = () => {
      // 앵커는 shift 된 본문 안에 있어 rect.left 에 chat-shift 가 포함된다 → 빼서 기준값 복원.
      // (실제 표시 위치엔 아래 style 의 calc 가 var(--iv-chat-shift) 를 다시 더해 lockstep 유지)
      const shift =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--iv-chat-shift"
          )
        ) || 0;
      setCardLeft(el.getBoundingClientRect().left - shift);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // 좌측레일(사이드바) 접힘은 본문을 '재중앙정렬'시켜 위치만 바꾼다 — 본문이 max-w 에 걸려
    // 있으면 앵커 크기는 그대로라 앵커만 관찰해선 못 잡는다. 접힘 시 실제로 폭이 변하는 본문영역
    // 컨테이너를 함께 관찰하면, 폭 변화가 매 프레임 감지돼 레일이 본문과 함께 움직인다.
    const area = el.closest<HTMLElement>("[data-iv-content-area]");
    if (area) ro.observe(area);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchorRef]);

  // 좌측 거터가 좁으면(레일이 사이드바·본문을 침범) 숨긴다.
  if (!past || cardLeft == null || cardLeft < RAIL_GUTTER_MIN) return null;

  return (
    <nav
      aria-label="후보자 상세 탭 (빠른 이동)"
      // 가로 위치 = left(실측 카드 좌측 cardLeft, +2px 만큼 카드 위로 겹쳐 맞닿는 테두리를 가림)
      //            + transform(translateX(-100%) 로 레일 폭만큼 왼쪽으로 빼 오른쪽 모서리를 카드에 밀착).
      // ⚙️ 두 움직임의 transition 을 일부러 분리한다(둘을 left 하나에 묶으면 사이드바 케이스가 지연됨):
      //  · 사이드바 접힘·리사이즈 → cardLeft(left)가 매 프레임 실측 갱신. left 엔 transition 을 두지
      //    않아(transition-transform 만) 본문 레이아웃 transition 과 '즉시' lockstep — 지연 없음.
      //  · 토론 패널 열고닫기 → 본문은 --iv-chat-shift(음수 px)를 한번에 점프 후 자기 transition 으로
      //    글라이드. 레일은 같은 변수를 transform 에 더하고 transition-transform 300ms 로 똑같이
      //    글라이드 → 본문과 픽셀 단위로 일치(토론창처럼 딱 붙어 움직임).
      style={{
        left: `${cardLeft + 2}px`,
        top: 58,
        transform: "translateX(calc(-100% + var(--iv-chat-shift, 0px)))",
      }}
      // z-20: 본문 카드(z-0) 위에는 뜨되, sticky 액션 바(z-30)보다는 아래. 액션 바는 sticky+z 라
      // 자체 stacking context 를 만들어, 그 안에서 열리는 모달(Modal z-[60])이 루트에선 z-30 레벨로
      // 갇힌다 → 레일을 z-30 으로 두면 (DOM 뒤라) 모달 오버레이 위로 그려져 안 가려진다. z-20 으로
      // 내리면 모달이 레일을 정상적으로 덮는다. 레일과 액션 바는 화면상 겹치지 않아 부작용 없음.
      className="hidden lg:flex fixed z-20 flex-col gap-1 rounded-l-2xl border-y border-l border-border-default bg-card p-1.5 shadow-[-3px_2px_10px_rgba(15,23,42,0.06)] transition-transform duration-300 ease-out motion-reduce:transition-none"
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
            aria-label={
              t.count ? `${t.label} (${t.count})` : t.label
            }
            title={t.on ? t.label : t.hint || t.label}
            className={
              "relative flex items-center justify-center w-9 h-9 rounded-xl transition-colors " +
              (!t.on
                ? "text-ink-muted/40 cursor-not-allowed"
                : active
                  ? "bg-primary text-white"
                  : "text-ink-soft hover:bg-surface-alt hover:text-ink")
            }
          >
            <t.Icon className="w-[18px] h-[18px]" />
            {t.on && !!t.count && (
              <span
                aria-hidden
                className={
                  "absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold leading-none ring-2 ring-card " +
                  (active
                    ? "bg-white text-primary"
                    : "bg-primary text-white")
                }
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

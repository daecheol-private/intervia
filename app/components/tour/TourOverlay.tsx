"use client";

/**
 * 인터랙티브 가이드 오버레이 — 게임 튜토리얼식 안내.
 *
 * 활성 투어가 있으면:
 *  1) 현재 경로가 단계 경로와 다르면 해당 화면으로 이동
 *  2) 대상 요소(data-tour / #id)를 찾아 화면 중앙으로 스크롤
 *  3) 주변을 어둡게 + 대상만 구멍(스포트라이트) + 반짝이 + 글로우 링
 *  4) 대상 옆 말풍선으로 설명 + 이전/다음 (닫기는 우측 상단 X 또는 ESC)
 *
 * 페이지는 그대로 클릭 가능(pointer-events-none 컨테이너) — 사용자가
 * 안내를 보면서 실제로 따라 해 볼 수 있다. 말풍선만 클릭을 받는다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { X, ArrowLeft, ArrowRight, Check } from "lucide-react";
import {
  getScenario,
  resolvePath,
  pathnameOf,
  type TourStep,
} from "@/lib/tour-scenarios";
import { tourStore, useActiveTour } from "./tour-store";

type Phase = "navigating" | "searching" | "shown" | "notfound";
const BUBBLE_W = 340;

export function TourOverlay() {
  const active = useActiveTour();
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [phase, setPhase] = useState<Phase>("searching");
  const targetRef = useRef<Element | null>(null);
  const [mounted, setMounted] = useState(false);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [bubbleH, setBubbleH] = useState(200);
  // 대상 페이지에서 이미 보여준 단계 키 — 사용자가 그 페이지를 떠났을 때
  // "붙잡아 되돌리기" 대신 "가이드 종료"로 구분하기 위함.
  const reachedRef = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);

  const scenario = active ? getScenario(active.scenarioId) : undefined;
  const step: TourStep | undefined = scenario?.steps[active?.step ?? 0];
  const total = scenario?.steps.length ?? 0;
  const idx = active?.step ?? 0;

  // 대상 탐색 + 이동. (시나리오/스텝/경로 변화마다)
  useEffect(() => {
    if (!active || !scenario || !step) return;
    const params = active.params;
    const stepKey = `${active.scenarioId}:${active.step}`;

    // 이동 전 presets (접힌 섹션 펼치기 등) 적용. 키도 {jobId} 등 치환.
    if (step.presets) {
      for (const p of step.presets) {
        try {
          localStorage.setItem(resolvePath(p.key, params), p.value);
        } catch {
          /* ignore */
        }
      }
      // 이미 mount된 섹션(Section)이 이 preset 을 즉시 반영하도록 알림 —
      // 같은 페이지 내 단계 전환·자동 시작은 router.push 가 없어 재mount 가 안 됨.
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("intervia:section-sync"));
    }

    const wantPath = pathnameOf(resolvePath(step.path, params));
    if (pathname !== wantPath) {
      // 이미 이 단계를 대상 페이지에서 보여준 뒤 사용자가 다른 페이지로
      // 이동했다면, 붙잡아 되돌리지 말고 가이드를 종료한다. (예: '공고 등록'
      // 가이드 중 공고를 만들어 상세 페이지로 이동 → 되돌리지 않고 종료 →
      // 상세 페이지에서 다음 가이드가 자동으로 뜨도록 양보)
      if (reachedRef.current === stepKey) {
        tourStore.stop();
        return;
      }
      setPhase("navigating");
      setRect(null);
      targetRef.current = null;
      router.push(resolvePath(step.path, params));
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let tries = 0;
    setPhase("searching");

    const find = () => {
      if (cancelled) return;
      const el = document.querySelector(step.target);
      if (el) {
        // 뷰포트보다 큰 영역은 말풍선을 영역 밖으로 빼지 않고 안에 겹쳐 띄운다
        // (computeBubble 의 tall 분기 참조). 여기선 영역 상단을 화면 위쪽에
        // 맞춰, 점수·차트 같은 핵심이 먼저 눈에 들어오도록 스크롤한다.
        const r0 = el.getBoundingClientRect();
        const tall = r0.height > window.innerHeight - 200;
        if (tall) {
          window.scrollBy({ top: r0.top - 72, behavior: "smooth" });
        } else {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        targetRef.current = el;
        // 스크롤이 안정된 뒤 측정.
        timer = window.setTimeout(() => {
          if (cancelled) return;
          setRect(el.getBoundingClientRect());
          reachedRef.current = stepKey;
          setPhase("shown");
        }, 360);
        return;
      }
      tries += 1;
      if (tries > 45) {
        setPhase("notfound");
        return;
      }
      timer = window.setTimeout(find, 120);
    };
    find();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.scenarioId, active?.step, pathname]);

  // 표시 중 스크롤/리사이즈/레이아웃 변화 추적.
  useEffect(() => {
    if (phase !== "shown") return;
    const update = () => {
      if (targetRef.current)
        setRect(targetRef.current.getBoundingClientRect());
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    const iv = window.setInterval(update, 500);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.clearInterval(iv);
    };
  }, [phase]);

  // 말풍선 실제 높이 측정 — 세로 클램프(화면 밖 방지) 계산에 사용.
  useEffect(() => {
    if (phase !== "shown" && phase !== "notfound") return;
    const el = bubbleRef.current;
    if (!el) return;
    const measure = () => setBubbleH(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase, idx]);

  // ESC 로 닫기.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") tourStore.stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const goNext = useCallback(() => {
    if (!active || !scenario) return;
    if (active.step >= scenario.steps.length - 1) {
      tourStore.stop();
    } else {
      tourStore.setStep(active.step + 1);
    }
  }, [active, scenario]);

  const goPrev = useCallback(() => {
    if (!active) return;
    if (active.step > 0) tourStore.setStep(active.step - 1);
  }, [active]);

  if (!mounted || !active || !scenario || !step) return null;

  const isLast = idx >= total - 1;
  const pad = step.padding ?? 8;

  // 말풍선 위치 — 대상 rect 기준, 공간 부족 시 반대편 플립 + 가로/세로 클램프.
  const bubblePos = computeBubble(rect, step.placement ?? "bottom", pad, bubbleH);

  return createPortal(
    <div className="fixed inset-0 z-[120] pointer-events-none">
      {/* 스포트라이트(딤 + 구멍) — box-shadow 로 주변만 어둡게 */}
      {rect && phase === "shown" && (
        <>
          <div
            className="tour-spot absolute rounded-xl"
            style={{
              left: rect.left - pad,
              top: rect.top - pad,
              width: rect.width + pad * 2,
              height: rect.height + pad * 2,
              boxShadow: "0 0 0 9999px rgba(7, 21, 16, 0.62)",
            }}
          />
          {/* 글로우 링 — 대상 테두리만 은은하게 강조 */}
          <div
            className="tour-spot tour-glow-ring absolute rounded-xl"
            style={{
              left: rect.left - pad,
              top: rect.top - pad,
              width: rect.width + pad * 2,
              height: rect.height + pad * 2,
            }}
          />
        </>
      )}

      {/* 탐색/이동 중 — 하단 작은 안내 알약 */}
      {phase !== "shown" && phase !== "notfound" && (
        <div className="absolute left-1/2 bottom-6 -translate-x-1/2 pointer-events-auto">
          <div className="flex items-center gap-2 rounded-full bg-ink/90 text-surface text-xs font-medium px-4 py-2 shadow-lg">
            <span className="w-3 h-3 rounded-full border-2 border-surface/40 border-t-surface animate-spin" />
            안내할 화면을 준비하고 있어요…
            <button
              onClick={() => tourStore.stop()}
              className="ml-1 underline underline-offset-2 opacity-80 hover:opacity-100"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 말풍선 */}
      {(phase === "shown" || phase === "notfound") && (
        <div
          ref={bubbleRef}
          className="absolute pointer-events-auto"
          style={
            phase === "notfound" || !bubblePos
              ? {
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: `min(${BUBBLE_W}px, calc(100vw - 2rem))`,
                }
              : {
                  left: bubblePos.left,
                  top: bubblePos.top,
                  transform: bubblePos.transform,
                  width: `min(${BUBBLE_W}px, calc(100vw - 2rem))`,
                }
          }
        >
          <div className="relative rounded-2xl bg-card border border-primary/30 shadow-2xl ring-1 ring-primary/10 overflow-hidden">
            <div className="px-4 pt-3.5 pb-3">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary-deep bg-primary-soft px-2 py-0.5 rounded-full">
                  <span>{scenario.emoji}</span>
                  {scenario.label}
                  {total > 1 && (
                    <span className="text-primary/70 tabular-nums">
                      {idx + 1}/{total}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => tourStore.stop()}
                  aria-label="가이드 닫기"
                  className="shrink-0 -mr-1 -mt-0.5 w-6 h-6 flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <h3 className="text-sm font-bold text-ink leading-snug">
                {step.title}
              </h3>
              <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                {step.body}
              </p>
              {phase === "notfound" && (
                <p className="mt-2 text-[11px] text-warning bg-warning-soft border border-warning/30 rounded-lg px-2.5 py-1.5 leading-relaxed">
                  안내할 위치를 화면에서 찾지 못했어요. PC 화면에서 다시
                  시도하거나, 위 설명을 참고해 주세요.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-2.5 bg-surface-alt/50 border-t border-border-default">
              <div className="flex items-center gap-1.5">
                {idx > 0 && (
                  <button
                    onClick={goPrev}
                    className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg text-ink-soft hover:bg-surface-alt transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    이전
                  </button>
                )}
                <button
                  onClick={goNext}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface transition-colors"
                >
                  {isLast ? (
                    <>
                      완료
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </>
                  ) : (
                    <>
                      다음
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// 위치 계산
// ---------------------------------------------------------------------------

function computeBubble(
  rect: DOMRect | null,
  placement: "top" | "bottom" | "left" | "right",
  pad: number,
  bubbleH: number
): { left: number; top: number; transform: string } | null {
  if (!rect) return null;
  if (typeof window === "undefined") return null;
  const gap = 16 + pad;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const half = Math.min(BUBBLE_W, vw - 32) / 2;
  const clampX = (x: number) => Math.min(Math.max(x, half + 8), vw - half - 8);
  // 세로 클램프 — 대상이 뷰포트보다 커도 말풍선이 화면 밖으로 나가지 않게.
  // top 은 말풍선의 실제 상단 좌표(좌표계: 뷰포트). transform 은 X 정렬만 담당.
  const clampY = (top: number) =>
    Math.min(Math.max(top, 8), Math.max(8, vh - bubbleH - 8));

  // 대상이 뷰포트보다 크면(tall) 말풍선을 영역 밖으로 빼지 않고 영역 안
  // 상단에 겹쳐 띄운다. (find() 가 영역 상단을 화면 위쪽으로 스크롤해 둠)
  if (rect.height > vh - 200) {
    return {
      left: clampX(cx),
      top: clampY(Math.max(rect.top, 8) + 16),
      transform: "translateX(-50%)",
    };
  }

  let p = placement;
  // 세로 플립 — 공간 부족 시 반대편.
  if (p === "bottom" && rect.bottom + gap + 180 > vh && rect.top - gap > 180)
    p = "top";
  else if (p === "top" && rect.top - gap < 180 && rect.bottom + gap + 180 < vh)
    p = "bottom";

  switch (p) {
    case "top":
      return {
        left: clampX(cx),
        top: clampY(rect.top - gap - bubbleH),
        transform: "translateX(-50%)",
      };
    case "left":
      return {
        left: rect.left - gap,
        top: clampY(cy - bubbleH / 2),
        transform: "translateX(-100%)",
      };
    case "right":
      return {
        left: rect.right + gap,
        top: clampY(cy - bubbleH / 2),
        transform: "translateX(0)",
      };
    case "bottom":
    default:
      return {
        left: clampX(cx),
        top: clampY(rect.bottom + gap),
        transform: "translateX(-50%)",
      };
  }
}

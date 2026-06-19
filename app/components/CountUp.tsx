"use client";

/**
 * 숫자 카운트업 — 뷰포트 진입 시 0에서 목표값까지 easeOutCubic 으로 증가.
 * 통계 밴드(랜딩)처럼 "살아있는" 인상을 주는 용도. IntersectionObserver 1회성.
 * prefers-reduced-motion: reduce 면 애니메이션 없이 즉시 목표값 표시.
 * 미지원/JS 없음 환경은 0 → 진입 시 목표값(카운트업은 본래 0에서 시작하므로 자연스러움).
 */
import { useEffect, useRef, useState } from "react";

export function CountUp({
  value,
  decimals = 0,
  durationMs = 1300,
}: {
  value: number;
  decimals?: number;
  durationMs?: number;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(value);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const start = performance.now();
        const run = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
          if (t < 1) {
            setN(value * eased);
            raf = requestAnimationFrame(run);
          } else {
            setN(value);
          }
        };
        raf = requestAnimationFrame(run);
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, durationMs]);

  return (
    <span ref={ref} className="tabular-nums">
      {n.toFixed(decimals)}
    </span>
  );
}

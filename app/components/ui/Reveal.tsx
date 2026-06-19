import * as React from "react";
import { cn } from "./cn";

/**
 * 스크롤 등장 래퍼 — 순수 CSS(`animation-timeline: view()`). JS 0.
 * 지원 브라우저(Chrome/Edge)는 뷰포트 진입 시 아래에서 떠오르며 페이드인.
 * 미지원(Safari/Firefox)·`prefers-reduced-motion`은 애니메이션 없이 그냥 보임(점진적 향상).
 * 큰 섹션 전체보다 헤딩·카드 그리드 같은 "블록" 단위로 감싸면 계단식으로 등장한다.
 * 정의: globals.css `.reveal`.
 */
export function Reveal({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("reveal", className)} {...rest}>
      {children}
    </div>
  );
}

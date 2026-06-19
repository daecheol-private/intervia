import * as React from "react";
import { cn } from "./cn";

/**
 * 페이지/섹션 가로 폭 래퍼 — 현재 페이지마다 max-w-3xl/4xl/5xl/6xl 이 제각각이라
 * 이 4단계로 표준화한다. 좌우 패딩(px-6)도 여기서 일괄 관리.
 */
export type ContainerWidth = "sm" | "md" | "lg" | "xl";

const WIDTH: Record<ContainerWidth, string> = {
  sm: "max-w-3xl", // 폼/글 중심 (로그인, 약관)
  md: "max-w-4xl", // 단일 콘텐츠
  lg: "max-w-5xl", // 상세/리포트
  xl: "max-w-6xl", // 대시보드/랜딩
};

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: ContainerWidth;
}

export function Container({
  width = "xl",
  className,
  ...rest
}: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-6", WIDTH[width], className)}
      {...rest}
    />
  );
}

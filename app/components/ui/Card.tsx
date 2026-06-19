import * as React from "react";
import { cn } from "./cn";

export type CardPadding = "none" | "sm" | "md" | "lg";
export type CardTone = "card" | "surface" | "alt";

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

const TONE: Record<CardTone, string> = {
  card: "bg-card",
  surface: "bg-surface",
  alt: "bg-surface-alt",
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  tone?: CardTone;
  /** hover 시 살짝 떠오르는 인터랙션 (globals.css `.card-hover`). 클릭 가능한 카드에. */
  hover?: boolean;
}

export function Card({
  padding = "md",
  tone = "card",
  hover,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border-default",
        TONE[tone],
        PADDING[padding],
        hover && "card-hover cursor-pointer",
        className,
      )}
      {...rest}
    />
  );
}

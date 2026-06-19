import * as React from "react";
import { cn } from "./cn";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";
export type BadgeVariant = "soft" | "solid" | "outline";

type LucideIcon = React.ComponentType<{
  className?: string;
  strokeWidth?: number;
}>;

const SOFT: Record<BadgeTone, string> = {
  neutral: "bg-surface-alt text-ink-soft border-border-default",
  brand: "bg-primary-soft text-primary-deep border-primary/20",
  accent: "bg-accent-soft text-accent-deep border-accent/30",
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning border-warning/25",
  danger: "bg-danger-soft text-danger border-danger/20",
  info: "bg-info-soft text-info border-info/20",
};

const SOLID: Record<BadgeTone, string> = {
  neutral: "bg-ink text-surface border-ink",
  brand: "bg-primary text-surface border-primary",
  accent: "bg-accent text-ink border-accent",
  success: "bg-success text-surface border-success",
  warning: "bg-warning text-surface border-warning",
  danger: "bg-danger text-white border-danger",
  info: "bg-info text-white border-info",
};

const OUTLINE: Record<BadgeTone, string> = {
  neutral: "bg-transparent text-ink-soft border-border-strong",
  brand: "bg-transparent text-primary border-primary/40",
  accent: "bg-transparent text-accent-deep border-accent/50",
  success: "bg-transparent text-success border-success/40",
  warning: "bg-transparent text-warning border-warning/40",
  danger: "bg-transparent text-danger border-danger/40",
  info: "bg-transparent text-info border-info/40",
};

const MAPS: Record<BadgeVariant, Record<BadgeTone, string>> = {
  soft: SOFT,
  solid: SOLID,
  outline: OUTLINE,
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  icon?: LucideIcon;
  /** 좌측 점 표시 (상태 인디케이터). icon 과 동시 사용 비권장. */
  dot?: boolean;
}

export function Badge({
  tone = "neutral",
  variant = "soft",
  icon: Icon,
  dot,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        MAPS[variant][tone],
        className,
      )}
      {...rest}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      )}
      {Icon && <Icon className="h-3 w-3" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

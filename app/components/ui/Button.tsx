import * as React from "react";
import { cn } from "./cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "accent"
  | "ghost"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary hover:bg-primary-deep text-surface border border-primary shadow-sm hover:shadow-md",
  secondary:
    "bg-card hover:bg-surface-alt text-ink border border-border-strong shadow-xs hover:shadow-sm",
  accent:
    "bg-accent hover:bg-accent-deep text-ink border border-accent shadow-sm hover:shadow-md",
  ghost:
    "bg-transparent hover:bg-surface-alt text-ink border border-transparent",
  danger:
    "bg-danger hover:bg-danger-deep text-white border border-danger shadow-sm hover:shadow-md",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-sm rounded-md",
  md: "h-11 px-5 text-sm rounded-lg",
  lg: "h-12 px-6 text-base rounded-lg",
};

/**
 * 버튼 className 빌더. 이 코드베이스는 CTA 를 `<Link className="...">` 로 쓰는 곳이
 * 많아서, 컴포넌트뿐 아니라 클래스만 떼어 Link 등에 붙일 수 있게 함께 노출한다.
 */
export function buttonClass(opts?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  const { variant = "primary", size = "md", fullWidth, className } = opts ?? {};
  return cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className);
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant, size, fullWidth, className, type, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={buttonClass({ variant, size, fullWidth, className })}
        {...rest}
      />
    );
  },
);

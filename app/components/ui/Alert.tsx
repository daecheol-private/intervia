import * as React from "react";
import { cn } from "./cn";

/**
 * 인라인 메시지 박스 — 에러/정보/경고/성공/브랜드. login·signup·폼 전반에서
 * 제각각이던 error/info/Banner/amber 경고 박스를 하나로 통일.
 */
export type AlertTone = "info" | "danger" | "warning" | "success" | "brand";

const TONE: Record<AlertTone, string> = {
  info: "text-info bg-info-soft border-info/30",
  danger: "text-danger bg-danger-soft border-danger/30",
  warning: "text-warning bg-warning-soft border-warning/40",
  success: "text-success bg-success-soft border-success/30",
  brand: "text-primary-deep bg-primary-soft border-primary/30",
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
}

export function Alert({
  tone = "info",
  className,
  children,
  ...rest
}: AlertProps) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs leading-relaxed",
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

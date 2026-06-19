import * as React from "react";
import { cn } from "./cn";

/**
 * 체크박스 + 라벨. 라벨 내용은 children(링크·보조문구 포함 가능).
 * align="start" 는 여러 줄 라벨용(체크박스를 첫 줄에 정렬).
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  align?: "start" | "center";
  /** 라벨(텍스트 영역)에 적용할 클래스 */
  labelClassName?: string;
}

export function Checkbox({
  align = "center",
  className,
  labelClassName,
  children,
  ...rest
}: CheckboxProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer select-none gap-2 text-sm text-ink-soft",
        align === "start" ? "items-start" : "items-center",
      )}
    >
      <input
        type="checkbox"
        className={cn(
          "h-4 w-4 shrink-0 rounded border-border-strong accent-primary",
          align === "start" && "mt-0.5",
          className,
        )}
        {...rest}
      />
      <span className={labelClassName}>{children}</span>
    </label>
  );
}

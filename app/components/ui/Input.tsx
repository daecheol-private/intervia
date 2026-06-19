import * as React from "react";
import { cn } from "./cn";

/**
 * 입력 필드 className 빌더 — 토큰 기반. 기존 페이지들이 로컬 `inputCls` 문자열을
 * 제각각 정의(slate-300 하드코딩)하던 것을 이걸로 통일한다. PasswordInput 등 직접
 * `<input>`을 쓰는 곳에도 className 으로 붙일 수 있게 함께 노출.
 */
export function inputClass(opts?: {
  error?: boolean;
  className?: string;
}): string {
  const { error, className } = opts ?? {};
  return cn(
    "w-full rounded-lg border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70 transition-colors",
    "focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent",
    error
      ? "border-danger ring-1 ring-danger focus:ring-danger"
      : "border-border-strong",
    className,
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ error, className, ...rest }, ref) {
    return (
      <input ref={ref} className={inputClass({ error, className })} {...rest} />
    );
  },
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ error, className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={inputClass({
          error,
          className: cn("resize-y min-h-[72px]", className),
        })}
        {...rest}
      />
    );
  },
);

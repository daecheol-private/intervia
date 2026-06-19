import * as React from "react";
import { cn } from "./cn";

/**
 * 폼 필드 래퍼 — 라벨 + (필수 *) + 입력 + 힌트/에러. login·signup 이 각자 정의하던
 * 로컬 `Field` 를 대체. 입력 요소는 children 으로 받는다(Input/PasswordInput/select 등).
 */
export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label?: React.ReactNode;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="mb-1.5 block text-sm font-medium text-ink-soft"
        >
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

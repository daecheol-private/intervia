"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { inputClass } from "./ui";

// value/onChange 는 제어형으로 고정하고, 나머지 표준 input 속성
// (placeholder/autoComplete/inputMode/maxLength/required/disabled/onKeyDown/autoFocus 등)은
// 그대로 통과시켜 일반 비밀번호·공고 PIN·SMTP 시크릿 등 모든 비밀번호 필드에 재사용.
type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value: string;
  onChange: (v: string) => void;
};

export function PasswordInput({
  value,
  onChange,
  className,
  autoComplete = "new-password",
  ...rest
}: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        className={(className ?? inputClass()) + " pr-10"}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-muted hover:text-ink-soft rounded"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

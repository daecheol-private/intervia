"use client";

import {
  careerInputsToText,
  CAREER_MAX_YEARS,
  type CareerInputs,
} from "@/lib/career-level";

const boxCls =
  "border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

/** 직급/연차 range 입력 — 경력무관 체크 또는 최소~최대 연차 (최대 비움 = 'N년 이상'). */
export function CareerRangeInput({
  value,
  onChange,
}: {
  value: CareerInputs;
  onChange: (v: CareerInputs) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <label
          className={`${boxCls} flex shrink-0 cursor-pointer select-none items-center gap-1.5 bg-card text-ink-soft`}
        >
          <input
            type="checkbox"
            className="accent-primary"
            checked={value.any}
            onChange={(e) => onChange({ ...value, any: e.target.checked })}
          />
          경력무관
        </label>
        <input
          type="number"
          min={0}
          max={CAREER_MAX_YEARS}
          placeholder="최소"
          aria-label="최소 연차"
          disabled={value.any}
          value={value.min}
          onChange={(e) => onChange({ ...value, min: e.target.value })}
          className={`${boxCls} w-full min-w-0 disabled:bg-surface-alt disabled:text-ink-muted`}
        />
        <span className="shrink-0 text-sm text-ink-muted">~</span>
        <input
          type="number"
          min={0}
          max={CAREER_MAX_YEARS}
          placeholder="최대"
          aria-label="최대 연차"
          disabled={value.any}
          value={value.max}
          onChange={(e) => onChange({ ...value, max: e.target.value })}
          className={`${boxCls} w-full min-w-0 disabled:bg-surface-alt disabled:text-ink-muted`}
        />
        <span className="shrink-0 text-sm text-ink-muted">년</span>
      </div>
      {!value.any && (
        <p className="mt-1 text-[11px] text-ink-muted">
          표시: <b>{careerInputsToText(value)}</b> · 최대를 비우면 ‘N년 이상’
        </p>
      )}
    </div>
  );
}

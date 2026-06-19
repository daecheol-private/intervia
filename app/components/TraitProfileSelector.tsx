"use client";

import {
  TRAIT_KEYS,
  TRAIT_LABELS,
  MAX_HIGH_TRAITS,
  type TraitKey,
  type TraitProfile,
} from "@/lib/personality";

/**
 * 공고의 AI 면접 인성검사 선호 특성 선택 — 공고 등록/수정 폼 공용.
 * 선택된 특성(내부적으로 high)은 점수 가중치가 아니라 검증 우선순위
 * (심화 문항 + 면접 행동 검증, 최대 3개). 미선택은 medium 저장.
 */
export function TraitProfileSelector({
  value,
  onChange,
}: {
  value: TraitProfile;
  onChange: (next: TraitProfile) => void;
}) {
  const selectedCount = TRAIT_KEYS.filter((k) => value[k] === "high").length;
  const full = selectedCount >= MAX_HIGH_TRAITS;

  const toggle = (key: TraitKey) => {
    const selected = value[key] === "high";
    if (!selected && full) return;
    onChange({ ...value, [key]: selected ? "medium" : "high" });
  };

  return (
    <div>
      <p className="text-[13px] text-ink-soft tabular-nums mb-1 font-medium">
        선택 {selectedCount}/{MAX_HIGH_TRAITS}
      </p>
      <div className="divide-y divide-border-default border border-border-default rounded-xl overflow-hidden">
        {TRAIT_KEYS.map((key) => {
          const selected = value[key] === "high";
          const blocked = !selected && full;
          return (
            <button
              key={key}
              type="button"
              disabled={blocked}
              title={
                blocked
                  ? `최대 ${MAX_HIGH_TRAITS}개까지 선택할 수 있습니다`
                  : undefined
              }
              onClick={() => toggle(key)}
              className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                selected ? "bg-primary-soft" : "bg-card hover:bg-surface-alt"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span
                aria-hidden
                className={`shrink-0 w-4.5 h-4.5 rounded border flex items-center justify-center ${
                  selected
                    ? "bg-primary border-primary text-surface"
                    : "bg-card border-border-strong"
                }`}
              >
                {selected && (
                  <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                    <path
                      d="M2.5 6.5L5 9L9.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span
                className={`text-[15px] font-semibold ${
                  selected ? "text-primary-deep" : "text-ink"
                }`}
              >
                {TRAIT_LABELS[key]}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-soft mt-2 leading-relaxed">
        ※ 회사 공통 <strong>역량</strong>(NCS 직업기초능력)은{" "}
        <strong>법인 설정</strong>에서 관리합니다. 여기서는 이 직무에 맞는{" "}
        <strong>성향</strong>(어떤 기질인가)을 고릅니다.
      </p>
    </div>
  );
}

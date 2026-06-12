"use client";

import { useState } from "react";
import {
  TRAIT_KEYS,
  TRAIT_LABELS,
  MAX_HIGH_TRAITS,
  type TraitKey,
  type TraitLevel,
  type TraitProfile,
} from "@/lib/personality";

/**
 * 공고의 AI 면접 인성검사 선호 특성 선택 — 공고 등록/수정 폼 공용.
 * "높음" 은 점수 가중치가 아니라 검증 우선순위 (심화 문항 + 면접 행동 검증, 최대 3개).
 */
export function TraitProfileSelector({
  value,
  onChange,
  suggestSource,
}: {
  value: TraitProfile;
  onChange: (next: TraitProfile) => void;
  /** AI 제안 근거 — 공고 폼의 현재 입력값 */
  suggestSource: {
    position: string;
    level: string;
    responsibilities: string;
    requirements: string;
    idealProfile: string;
  };
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // AI 제안 근거 — 제안 직후에만 표시 (저장 대상 아님)
  const [reasons, setReasons] = useState<Partial<Record<TraitKey, string>>>({});

  const highCount = TRAIT_KEYS.filter((k) => value[k] === "high").length;
  const canSuggest =
    suggestSource.responsibilities.trim().length > 0 ||
    suggestSource.requirements.trim().length > 0;

  const setTrait = (key: TraitKey, level: TraitLevel) => {
    if (level === "high" && value[key] !== "high" && highCount >= MAX_HIGH_TRAITS)
      return;
    onChange({ ...value, [key]: level });
  };

  const suggest = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/jobs/trait-suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(suggestSource),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    const d = (await r.json()) as {
      traitProfile: TraitProfile;
      reasons: Partial<Record<TraitKey, string>>;
    };
    onChange(d.traitProfile);
    setReasons(d.reasons);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs text-slate-500 tabular-nums">
          높음 {highCount}/{MAX_HIGH_TRAITS}
        </span>
        <button
          type="button"
          onClick={suggest}
          disabled={busy || !canSuggest}
          title={canSuggest ? undefined : "담당 업무 또는 자격 요건을 먼저 입력하세요"}
          className="shrink-0 px-2.5 py-1.5 rounded-md border border-primary/40 text-primary-deep hover:bg-primary-soft text-xs font-medium disabled:opacity-50"
        >
          {busy ? "분석 중..." : "✨ 공고 내용으로 AI 제안 받기"}
        </button>
      </div>
      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
        {TRAIT_KEYS.map((key) => {
          const level = value[key];
          const highBlocked = level !== "high" && highCount >= MAX_HIGH_TRAITS;
          return (
            <div key={key} className="p-3 bg-white">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm font-medium text-slate-700">
                  {TRAIT_LABELS[key]}
                </span>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  {(
                    [
                      ["low", "낮음"],
                      ["medium", "보통"],
                      ["high", "높음"],
                    ] as const
                  ).map(([val, label]) => {
                    const disabled = val === "high" && highBlocked;
                    return (
                      <button
                        key={val}
                        type="button"
                        disabled={disabled}
                        title={
                          disabled
                            ? `높음(심화 검증)은 최대 ${MAX_HIGH_TRAITS}개까지 지정할 수 있습니다`
                            : undefined
                        }
                        onClick={() => setTrait(key, val)}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                          level === val
                            ? val === "high"
                              ? "bg-primary text-white"
                              : "bg-slate-700 text-white"
                            : "bg-white text-slate-500 hover:bg-slate-50"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {reasons[key] && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  💡 {reasons[key]}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {err && (
        <p className="text-[11px] text-danger bg-danger-soft border border-danger/30 rounded-md px-2.5 py-1.5 mt-2">
          {err}
        </p>
      )}
    </div>
  );
}

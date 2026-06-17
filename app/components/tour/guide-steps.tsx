"use client";

/**
 * 첫 실행 가이드 단계 목록 — 각 단계를 누르면 단순 이동 대신
 * 게임 튜토리얼식 둘러보기(스포트라이트+말풍선)를 실행한다.
 *
 * 대시보드 시작 가이드(hero)와 플로팅 위젯(widget)이 같은 로직을 공유.
 * 대상이 필요한 단계(이력서 업로드=공고 / AI 면접=평가완료 후보)는
 * 대상이 없으면 잠금 + 사유 안내.
 */
import { useEffect, useState } from "react";
import { Check, Lock, Play } from "lucide-react";
import type { SetupStep } from "@/lib/setup-steps";
import { tourStore } from "./tour-store";

type Targets = { firstJobId: number | null; screenedCandidateId: number | null };

function useTourTargets() {
  const [t, setT] = useState<Targets | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/orgs/me/tour-targets", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Targets>) : null))
      .then((j) => {
        if (alive && j) setT(j);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return t;
}

function availability(step: SetupStep, t: Targets | null) {
  if (step.tour === "resume-upload")
    return {
      ok: !!t && t.firstJobId != null,
      hint: "먼저 공고를 등록하면 안내해 드려요",
    };
  if (step.tour === "ai-interview")
    return {
      ok: !!t && t.screenedCandidateId != null,
      hint: "서류 평가가 끝난 이력서가 있어야 진행할 수 있어요",
    };
  return { ok: true, hint: undefined as string | undefined };
}

function paramsOf(t: Targets | null): Record<string, string> {
  const p: Record<string, string> = {};
  if (t?.firstJobId != null) p.jobId = String(t.firstJobId);
  if (t?.screenedCandidateId != null) p.candidateId = String(t.screenedCandidateId);
  return p;
}

// ---------------------------------------------------------------------------
// hero — 대시보드 시작 가이드 카드의 단계 목록
// ---------------------------------------------------------------------------

export function GuideStepList({
  steps,
  activeN,
  variant,
}: {
  steps: SetupStep[];
  activeN: number | null;
  variant: "hero" | "widget";
}) {
  const targets = useTourTargets();

  const launch = (step: SetupStep, ok: boolean) => {
    if (!ok) return;
    tourStore.start(step.tour, paramsOf(targets));
  };

  if (variant === "widget") {
    return (
      <ol className="p-2.5 space-y-1">
        {steps.map((s) => {
          const isActive = activeN === s.n;
          const av = availability(s, targets);
          const numberBadge = (
            <span
              className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                s.done
                  ? "bg-primary text-surface"
                  : isActive
                    ? "bg-primary-soft text-primary-deep border border-primary/40"
                    : "bg-surface-alt text-ink-muted border border-border-default"
              }`}
            >
              {s.done ? <Check className="w-3 h-3" strokeWidth={3} /> : s.n}
            </span>
          );
          const titleText = (
            <span
              className={`flex-1 text-xs font-medium ${
                s.done ? "text-ink-soft line-through" : "text-ink"
              }`}
            >
              {s.title}
            </span>
          );

          return (
            <li key={s.n}>
              <button
                type="button"
                onClick={() => launch(s, av.ok)}
                disabled={!av.ok}
                className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
                  isActive ? "bg-primary-soft/40 ring-1 ring-primary/20" : ""
                } ${av.ok ? "hover:bg-surface-alt cursor-pointer" : "cursor-not-allowed"}`}
              >
                <div className="flex items-center gap-2.5">
                  {numberBadge}
                  {titleText}
                  {av.ok ? (
                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary">
                      <Play className="w-2.5 h-2.5 fill-primary" />
                      따라하기
                    </span>
                  ) : (
                    <Lock className="shrink-0 w-3 h-3 text-ink-muted" />
                  )}
                </div>
                {isActive && (
                  <p className="mt-1.5 pl-[30px] text-[11px] text-ink-soft leading-relaxed">
                    {av.ok ? s.desc : av.hint}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    );
  }

  // hero
  return (
    <ol className="px-4 sm:px-6 pb-6 pt-4 space-y-2">
      {steps.map((s) => {
        const isActive = activeN === s.n;
        const av = availability(s, targets);
        const numberBadge = (
          <span
            className={`shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
              s.done
                ? "bg-primary text-surface"
                : isActive
                  ? "bg-primary-soft text-primary-deep border border-primary/40"
                  : "bg-surface-alt text-ink-muted border border-border-default"
            }`}
          >
            {s.done ? <Check className="w-4 h-4" strokeWidth={3} /> : s.n}
          </span>
        );
        const titleRow = (
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-sm font-semibold ${
                s.done ? "text-ink-soft line-through" : "text-ink"
              }`}
            >
              {s.title}
            </span>
            {s.done && (
              <span className="text-[11px] text-primary font-medium">완료</span>
            )}
          </div>
        );

        return (
          <li key={s.n}>
            <button
              type="button"
              onClick={() => launch(s, av.ok)}
              disabled={!av.ok}
              className={`group w-full flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
                s.done
                  ? "border-primary/20 bg-primary-soft/30"
                  : isActive
                    ? "border-primary/40 bg-card ring-1 ring-primary/20"
                    : "border-border-default bg-surface-alt/40"
              } ${
                av.ok
                  ? "hover:border-primary/50 hover:shadow-sm cursor-pointer"
                  : "cursor-not-allowed"
              }`}
            >
              {numberBadge}
              <div className="min-w-0 flex-1">
                {titleRow}
                <p className="text-xs text-ink-soft mt-0.5 leading-relaxed">
                  {s.desc}
                </p>
                <div className="mt-2">
                  {av.ok ? (
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                        isActive
                          ? "bg-primary text-surface group-hover:bg-primary-deep"
                          : "text-primary group-hover:bg-primary-soft"
                      }`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      화면에서 따라하기
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
                      <Lock className="w-3 h-3" />
                      {av.hint}
                    </span>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// strip — 대시보드 슬림 진행 스트립의 "다음 단계" 실행 버튼
// ---------------------------------------------------------------------------

export function GuideStripCta({ step }: { step: SetupStep }) {
  const targets = useTourTargets();
  const av = availability(step, targets);
  if (!av.ok) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-ink-muted">
        <Lock className="w-3 h-3" />
        {av.hint}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => tourStore.start(step.tour, paramsOf(targets))}
      className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface transition-colors"
    >
      <Play className="w-3.5 h-3.5 fill-current" />
      화면에서 따라하기
    </button>
  );
}

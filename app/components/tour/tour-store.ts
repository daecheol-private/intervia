"use client";

/**
 * 인터랙티브 가이드 투어의 전역 상태 — 라우트 이동에도 살아남게
 * sessionStorage 에 영속 + 구독으로 컴포넌트 간 동기화.
 *
 * 런처(어디서든)와 오버레이(layout)가 서로 다른 서브트리에 있어
 * 컨텍스트 대신 모듈 싱글톤 스토어를 쓴다. App Router 클라이언트
 * 네비게이션은 layout 을 유지하므로 오버레이는 mount 유지되고,
 * 새로고침으로 잃어도 sessionStorage 에서 복원된다.
 */
import { useEffect, useState } from "react";
import type { TourScenarioId } from "@/lib/tour-scenarios";

export type ActiveTour = {
  scenarioId: TourScenarioId;
  step: number;
  params: Record<string, string>;
};

const KEY = "intervia-tour";

type Listener = (t: ActiveTour | null) => void;
const listeners = new Set<Listener>();

function read(): ActiveTour | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActiveTour) : null;
  } catch {
    return null;
  }
}

let current: ActiveTour | null = read();

function write(next: ActiveTour | null) {
  current = next;
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode 등 */
  }
  listeners.forEach((l) => l(next));
}

export const tourStore = {
  get: () => current,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  start(scenarioId: TourScenarioId, params: Record<string, string> = {}) {
    write({ scenarioId, step: 0, params });
  },
  setStep(step: number) {
    if (current) write({ ...current, step });
  },
  stop() {
    write(null);
  },
};

/** 활성 투어 구독 훅. SSR/hydration 안전을 위해 mount 후 스토어 값을 채운다. */
export function useActiveTour(): ActiveTour | null {
  const [t, setT] = useState<ActiveTour | null>(null);
  useEffect(() => {
    setT(tourStore.get());
    return tourStore.subscribe(setT);
  }, []);
  return t;
}

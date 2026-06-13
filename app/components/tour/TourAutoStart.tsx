"use client";

/**
 * 페이지 기반 가이드 자동 노출.
 *
 * "완료하지 않은 단계의 페이지에 들어가면 해당 가이드가 자동으로 뜬다."
 *  - /org/settings      → 인재상·컬쳐핏 (step1 미완)
 *  - /jobs/new          → 공고 등록     (step2 미완)
 *  - /jobs/{id}         → 이력서 업로드 (step3 미완)
 *  - /candidates/{id}   → AI 면접 보내기 (step4 미완 · 면접 버튼이 있는 후보만)
 *
 * 덕분에 공고를 만들고 상세 페이지로 자동 이동하면, step3(이력서) 미완
 * 상태이므로 이력서 업로드 가이드가 리프레시 없이 곧바로 뜬다.
 *
 * 완료 판정은 데이터 기준(/api/orgs/me/setup-progress)이고, 법인이 가이드를
 * 통째로 숨겼으면(show=false) 띄우지 않는다. 이미 진행 중인 가이드가 있으면
 * 양보한다. 같은 페이지에서 닫으면(경로 불변) 다시 뜨지 않고, 다른 페이지로
 * 갔다 돌아오면 (미완 상태인 한) 다시 뜬다.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { tourStore } from "./tour-store";
import type { TourScenarioId } from "@/lib/tour-scenarios";

type Progress = {
  show: boolean;
  step1: boolean;
  step2: boolean;
  step3: boolean;
  step4: boolean;
  firstJobId: number | null;
};

type AutoGuide = {
  scenario: TourScenarioId;
  /** 현재 경로가 이 가이드 대상이면 치환 params 반환, 아니면 null. */
  match: (pathname: string) => Record<string, string> | null;
  /** 이미 끝낸 단계인지 (끝났으면 안 띄움). */
  done: (p: Progress) => boolean;
  /** 지정 시, 이 셀렉터가 DOM 에 나타날 때까지 기다린 뒤에만 시작.
   *  (예: AI 면접 버튼은 서류평가 끝난 후보에서만 비동기로 렌더됨) */
  awaitTarget?: string;
};

// 이 세션에서 더 자동으로 띄울 게 없다고 판명되면(법인이 가이드를 숨겼거나
// 1~4단계를 모두 완료) 이후 네비게이션마다의 재조회를 생략한다. 전체 새로고침
// 시 모듈이 재평가되며 다시 확인한다.
let settledForSession = false;

const AUTO_GUIDES: AutoGuide[] = [
  {
    scenario: "culture-fit",
    match: (p) => (p === "/org/settings" ? {} : null),
    done: (p) => p.step1,
  },
  {
    scenario: "job-create",
    match: (p) => (p === "/jobs/new" ? {} : null),
    done: (p) => p.step2,
  },
  {
    scenario: "resume-upload",
    match: (p) => {
      const m = /^\/jobs\/(\d+)$/.exec(p);
      return m ? { jobId: m[1] } : null;
    },
    done: (p) => p.step3,
  },
  {
    scenario: "ai-interview",
    match: (p) => {
      const m = /^\/candidates\/(\d+)$/.exec(p);
      return m ? { candidateId: m[1] } : null;
    },
    done: (p) => p.step4,
    // 면접 요청 버튼이 있는 후보(서류평가 완료·미발송)에서만 노출.
    // 아직 평가 전이거나 이미 면접을 보낸 후보에선 버튼이 없어 자동으로 건너뜀.
    awaitTarget: '[data-tour="ai-interview-btn"]',
  },
];

/** sel 이 DOM 에 나타나면 true, tries 회(×150ms) 안에 못 찾으면 false. */
function waitForSelector(
  sel: string,
  tries: number,
  isCancelled: () => boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      if (isCancelled()) return resolve(false);
      if (document.querySelector(sel)) return resolve(true);
      if (++n >= tries) return resolve(false);
      window.setTimeout(tick, 150);
    };
    tick();
  });
}

export function TourAutoStart() {
  const pathname = usePathname() ?? "";

  useEffect(() => {
    if (settledForSession) return;
    const cfg = AUTO_GUIDES.find((g) => g.match(pathname));
    if (!cfg) return;
    if (tourStore.get()) return; // 이미 진행 중인 가이드가 있으면 양보

    const params = cfg.match(pathname)!;
    let cancelled = false;
    fetch("/api/orgs/me/setup-progress", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Progress>) : null))
      .then(async (p) => {
        if (cancelled || !p) return;
        // 더 이상 띄울 게 없으면(가이드 숨김 or 1~4단계 모두 완료) 세션 동안 생략.
        if (!p.show || (p.step1 && p.step2 && p.step3 && p.step4))
          settledForSession = true;
        if (!p.show) return; // 법인이 가이드를 통째로 숨김
        if (cfg.done(p)) return; // 이미 완료한 단계
        // 대상 요소가 비동기로 렌더되는 가이드는, 나타날 때까지 기다린 뒤에만
        // 시작 (없으면 조용히 건너뜀 — '위치 못 찾음' 말풍선 방지).
        if (cfg.awaitTarget) {
          const ok = await waitForSelector(cfg.awaitTarget, 60, () => cancelled);
          if (!ok || cancelled) return;
        }
        if (tourStore.get()) return; // 그 사이 수동 시작됐으면 양보
        tourStore.start(cfg.scenario, params);
      })
      .catch(() => {
        /* 네트워크 오류 시 조용히 무시 — 자동 가이드는 부가 기능 */
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}

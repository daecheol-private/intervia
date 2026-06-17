"use client";

/**
 * 페이지 기반 가이드 자동 노출.
 *
 * "완료하지 않은 단계의 페이지에 들어가면 해당 가이드가 자동으로 뜬다."
 *  - /org/settings      → 인재상·컬쳐핏 (step1 미완)
 *  - /jobs/new          → 공고 등록     (step2 미완)
 *  - /jobs/{id}         → 지원 링크(applyLink 미완) → 이력서 업로드(step3 미완)
 *  - /candidates/{id}   → AI 면접 보내기 (step4 미완 · 면접 버튼이 있는 후보만)
 *
 * 덕분에 공고를 만들고 상세 페이지로 자동 이동하면, 같은 /jobs/{id} 안에서
 * 먼저 지원 링크(미완) 가이드가, 발급 후 다시 들어오면 이력서 업로드 가이드가 뜬다.
 * (같은 경로에 여러 가이드가 걸리면 미완료인 첫 가이드를 고른다.)
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
  applyLink: boolean;
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
    // 지원 링크는 이력서 업로드와 같은 /jobs/{id} 페이지에 있다 — 미완료면
    // 먼저(이력서보다 앞에) 안내. (AUTO_GUIDES 순서 = 미완료 선택 우선순위)
    scenario: "apply-link",
    match: (p) => {
      const m = /^\/jobs\/(\d+)$/.exec(p);
      return m ? { jobId: m[1] } : null;
    },
    done: (p) => p.applyLink,
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

// 멤버(면접관) 전용 페이지 가이드 — 진입한 페이지의 "할 일"을 1회 안내.
// org_admin 의 데이터 기반 순차 가이드와 달리, 순서·완료 판정이 아니라 "이 멤버가
// 이 페이지 가이드를 봤는가"(users.seenMemberGuides)로만 노출 여부를 정한다.
type MemberGuide = {
  key: string; // seenMemberGuides 에 기록할 키 (member-guides API 화이트리스트와 일치)
  scenario: TourScenarioId;
  match: (p: string) => Record<string, string> | null;
  // 이 타깃이 DOM 에 떠야 시작 — 없으면 시작·기록 모두 안 함(정상 진입 시 재시도).
  // 잠긴 공고(언락 전엔 job-header 없음)·평가 전 후보(screening-report 없음) 대응.
  awaitTarget: string;
};
const MEMBER_GUIDES: MemberGuide[] = [
  {
    key: "job_page",
    scenario: "member-job-page",
    match: (p) => {
      const m = /^\/jobs\/(\d+)$/.exec(p);
      return m ? { jobId: m[1] } : null;
    },
    awaitTarget: '[data-tour="job-header"]',
  },
  {
    // 후보 상세의 멤버 가이드는 법인담당자 step4(ai-interview)를 그대로 재사용.
    key: "candidate_page",
    scenario: "ai-interview",
    match: (p) => {
      const m = /^\/candidates\/(\d+)$/.exec(p);
      return m ? { candidateId: m[1] } : null;
    },
    // 'AI면접 요청' 버튼이 있는 후보(평가완료·미발송)에서만 시작 — 법인담당자 step4 와 동일.
    // 평가 전·이미 발송된 후보면 버튼이 없어 시작·기록 안 함(다음 대상 후보에서 재시도).
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

export function TourAutoStart({
  role,
}: {
  role: "org_admin" | "member";
}) {
  const pathname = usePathname() ?? "";

  useEffect(() => {
    // 멤버(면접관): 공고/후보 페이지 첫 진입 시 그 페이지 가이드 1회 (계정별 seen 기록).
    // 진입한 페이지의 할 일을 한 번 안내하고, 노출된 뒤로는 다시 띄우지 않는다.
    if (role === "member") {
      const cfg = MEMBER_GUIDES.find((g) => g.match(pathname));
      if (!cfg || tourStore.get()) return;
      const params = cfg.match(pathname)!;
      let cancelled = false;
      fetch("/api/orgs/me/member-guides", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ seen: string[] }>) : null))
        .then(async (data) => {
          if (cancelled || !data || data.seen.includes(cfg.key)) return;
          // 타깃이 떠야 시작 — 없으면(잠긴 공고·평가 전 후보) 시작·기록 모두 안 함.
          const ok = await waitForSelector(cfg.awaitTarget, 40, () => cancelled);
          if (!ok || cancelled || tourStore.get()) return;
          tourStore.start(cfg.scenario, params);
          // 노출 = 한 번 봄 → 즉시 기록. 다음 진입부터 안 뜸.
          void fetch("/api/orgs/me/member-guides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: cfg.key }),
          }).catch(() => {});
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }

    // org_admin: 미완료 단계 페이지 진입 시 자동 (데이터 상태 기반).
    if (settledForSession) return;
    // 같은 경로에 여러 가이드가 걸릴 수 있다(/jobs/{id} = 지원 링크 + 이력서).
    const matches = AUTO_GUIDES.filter((g) => g.match(pathname));
    if (matches.length === 0) return;
    if (tourStore.get()) return; // 이미 진행 중인 가이드가 있으면 양보

    let cancelled = false;
    fetch("/api/orgs/me/setup-progress", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Progress>) : null))
      .then(async (p) => {
        if (cancelled || !p) return;
        // 더 이상 띄울 게 없으면(가이드 숨김 or 모든 단계 완료) 세션 동안 생략.
        if (!p.show || (p.step1 && p.step2 && p.applyLink && p.step3 && p.step4))
          settledForSession = true;
        if (!p.show) return; // 법인이 가이드를 통째로 숨김
        // 미완료인 첫 가이드를 골라 시작 — 같은 경로의 가이드는 AUTO_GUIDES 순서가
        // 우선순위(지원 링크 → 이력서). 대상 요소가 비동기 렌더면 나타날 때까지
        // 기다리고, 못 찾으면 다음 후보로 넘어간다('위치 못 찾음' 말풍선 방지).
        for (const cfg of matches) {
          if (cfg.done(p)) continue; // 이미 완료한 단계
          if (cfg.awaitTarget) {
            const ok = await waitForSelector(
              cfg.awaitTarget,
              60,
              () => cancelled
            );
            if (cancelled) return;
            if (!ok) continue;
          }
          if (tourStore.get()) return; // 그 사이 수동 시작됐으면 양보
          tourStore.start(cfg.scenario, cfg.match(pathname)!);
          return;
        }
      })
      .catch(() => {
        /* 네트워크 오류 시 조용히 무시 — 자동 가이드는 부가 기능 */
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, role]);

  return null;
}

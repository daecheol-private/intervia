"use client";

/**
 * 페이지 진입 가이드 자동 노출 — 법인담당자(org_admin)·면접관(member) 공통.
 *
 * 해당 페이지에 처음 들어가면 그 페이지의 할 일을 안내한다. 순서·데이터 완료 판정이
 * 아니라 "이 사용자가 이 페이지 가이드를 껐는가"(users.seen_member_guides)로만 노출을
 * 정한다. 노출 즉시 기록하지 않고, 가이드 끝의 '다시 보지 않기'를 체크하고 종료해야만
 * 기록(끄기)된다 — 그 전까진 진입할 때마다 다시 안내한다(검토·반복 학습에 유리).
 *
 *  - /jobs/new         → 공고 만들기 (member-job-new)
 *  - /jobs/{id}        → 공고 둘러보기 (member-job-page)
 *  - /candidates/{id}  → 이력서 검토하기 (member-candidate-page)
 *
 * system_admin 에는 마운트하지 않는다(layout.tsx). 법인설정·토큰지갑 등 추가 가이드는
 * PAGE_GUIDES 에 항목을 더하면 된다(역할 구분 없이 동일하게 노출).
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { tourStore } from "./tour-store";
import { PAGE_GUIDES } from "@/lib/tour-pages";

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
    const cfg = PAGE_GUIDES.find((g) => g.match(pathname));
    if (!cfg || tourStore.get()) return;
    // 데스크톱 전용 가이드(드로어·모달이 sm+ 에서만 열림)는 모바일에서 시작 안 함.
    if (
      cfg.desktopOnly &&
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 640px)").matches
    )
      return;
    const params = cfg.match(pathname)!;
    let cancelled = false;
    fetch("/api/orgs/me/member-guides", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ seen: string[] }>) : null))
      .then(async (data) => {
        // seen 에 키가 있으면 = 사용자가 '다시 보지 않기'로 끈 것 → 안 띄움.
        if (cancelled || !data || data.seen.includes(cfg.key)) return;
        // 타깃이 떠야 시작 — 없으면(잠긴 공고·종결 후보 등) 시작 안 함.
        const ok = await waitForSelector(cfg.awaitTarget, 40, () => cancelled);
        if (!ok || cancelled || tourStore.get()) return;
        // 노출 즉시 기록하지 않는다 — 가이드 끝에서 '다시 보지 않기'를 체크해야만
        // 기록(끄기)된다. dismissKey 전달 → 말풍선 체크박스 → endTour 가 기록.
        tourStore.start(cfg.scenario, params, cfg.key);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}

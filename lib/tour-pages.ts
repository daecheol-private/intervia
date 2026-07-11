/**
 * 페이지 진입 가이드 매핑 — 어떤 경로에서 어떤 시나리오를 띄울지 한 곳에서 정의.
 *
 * 두 곳이 이 출처를 공유한다:
 *  - 자동 노출(TourAutoStart): 처음 진입 시 '다시 보지 않기'로 끄지 않았으면 띄움.
 *  - 수동 재실행(AppShell 좌측 레일 '가이드 다시 보기'): 끔 여부와 무관하게 다시 띄움.
 *
 * DOM 접근 없는 순수 데이터/헬퍼라 서버·클라이언트 양쪽에서 import 가능하다.
 */
import type { TourScenarioId } from "./tour-scenarios";

export type PageGuide = {
  /** seen_member_guides 에 기록할 키 (member-guides API 화이트리스트와 일치). */
  key: string;
  scenario: TourScenarioId;
  /** 경로가 이 가이드 대상이면 치환 파라미터를 반환, 아니면 null. */
  match: (p: string) => Record<string, string> | null;
  /**
   * 이 타깃이 DOM 에 떠야 자동 시작 — 없으면 시작 안 함(정상 진입 시 재시도).
   * 잠긴 공고(언락 전엔 버튼 없음)·종결 후보(단계 변경 버튼 없음) 등 대응.
   * (수동 재실행에는 적용하지 않는다 — 사용자가 직접 누른 거라 바로 띄움.)
   */
  awaitTarget: string;
  /** 드로어·모달이 sm+ 에서만 열리는 데스크톱 전용 가이드는 모바일에서 시작하지 않는다. */
  desktopOnly?: boolean;
};

export const PAGE_GUIDES: PageGuide[] = [
  {
    // 새 공고 등록 — 지원 링크 생성 → 기존 공고 URL 자동 채우기 안내.
    key: "job_new",
    scenario: "member-job-new",
    match: (p) => (p === "/jobs/new" ? {} : null),
    // '지원링크 생성' 영역은 데스크톱 폼에 항상 렌더된다 → 진입 시 항상 자동 시작.
    // (모바일은 폼 대신 안내만 뜨는 데스크톱 전용 화면이라 desktopOnly.)
    awaitTarget: '[data-tour="apply-link-new"]',
    desktopOnly: true,
  },
  {
    key: "job_page",
    scenario: "member-job-page",
    match: (p) => {
      const m = /^\/jobs\/(\d+)$/.exec(p);
      return m ? { jobId: m[1] } : null;
    },
    // '이력서 받기' 버튼은 후보가 1명+ 있을 때만 헤더에 뜬다 → 안내할 거리가 있는
    // 공고에서만 자동 시작(0명이면 버튼 없음 → 시작 안 함, 다음에 재시도).
    awaitTarget: '[data-tour="resume-intake-btn"]',
    desktopOnly: true,
  },
  {
    // 후보(이력서) 상세 — 종합평가 → 서류평가 → 단계 변경 → 토론 안내.
    key: "candidate_page",
    scenario: "member-candidate-page",
    match: (p) => {
      const m = /^\/candidates\/(\d+)$/.exec(p);
      return m ? { candidateId: m[1] } : null;
    },
    // '단계 변경' 버튼은 다음 전형이 있는(진행 가능한) 후보에서만 액션바에 뜬다 →
    // 검토·진행할 거리가 있는 후보에서만 자동 시작(종결 후보엔 안 뜸).
    awaitTarget: '[data-tour="cand-stage-next"]',
    desktopOnly: true,
  },
  {
    // 법인 설정 — 회사 주소 → 법인 브랜딩 → 컬처핏 정성평가 → 메일 서버 → 화상 면접 안내.
    // /org/settings 는 법인담당자만 접근 → 자연히 org_admin 전용.
    key: "org_settings",
    scenario: "org-settings",
    match: (p) => (p === "/org/settings" ? {} : null),
    // 첫 섹션(회사 주소)이 떠야 자동 시작 — 접근 권한 없으면 렌더 안 돼 시작 안 함.
    awaitTarget: '[data-tour="cfg-address"]',
  },
];

/** 현재 경로가 가이드 대상이면 {guide, params}, 아니면 null. */
export function matchPageGuide(
  pathname: string
): { guide: PageGuide; params: Record<string, string> } | null {
  for (const guide of PAGE_GUIDES) {
    const params = guide.match(pathname);
    if (params) return { guide, params };
  }
  return null;
}

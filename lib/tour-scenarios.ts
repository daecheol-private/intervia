/**
 * 인터랙티브 가이드(게임 튜토리얼식 둘러보기) 시나리오 정의.
 *
 * 각 시나리오는 "시나리오 버튼"으로 시작되고, 실제 화면으로 이동해
 * 대상 요소를 스포트라이트(딤+구멍) + 반짝이 + 말풍선으로 안내한다.
 *
 * 대상 요소는 페이지의 `data-tour="..."` 속성(또는 #id)으로 지정한다.
 * 새 단계/문구 변경은 여기만 고치면 된다. (TourOverlay / TourLauncher 공유)
 */

export type TourPlacement = "top" | "bottom" | "left" | "right";

export type TourStep = {
  /** 이 단계가 머무는 경로 (+선택적 #hash). {jobId}/{candidateId} 치환 가능. */
  path: string;
  /** 스포트라이트할 요소의 CSS 선택자. */
  target: string;
  title: string;
  body: string;
  placement?: TourPlacement;
  /** 스포트라이트 구멍 여백(px). 기본 8. */
  padding?: number;
  /** 이동 전 localStorage 에 미리 세팅 (예: 접힌 섹션을 펼쳐 둠). */
  presets?: { key: string; value: string }[];
  /**
   * 이 단계가 머무는 동안 열려 있어야 하는 팝업/패널/탭.
   *  - open:  여는 트리거 셀렉터. 닫혀 있을 때만 클릭한다(열림 판정은 TourOverlay 의
   *           isPopupOpen — open 트리거의 aria-pressed 우선, 없으면 대상 존재로 판정).
   *  - close: 닫는 트리거 셀렉터(닫기 버튼·백드롭 등). 다른 팝업으로 넘어가거나 가이드를
   *           떠날 때 클릭한다. **탭처럼 닫을 필요가 없으면 생략**(다음 단계의 open 이 전환).
   * 연속한 두 단계가 같은 팝업(open 셀렉터 동일)을 가리키면 그 사이에는 닫지 않는다.
   */
  popup?: { open: string; close?: string };
};

export type TourScenarioId =
  // 새 공고 등록(/jobs/new) 페이지 첫 진입 시 자동 노출 — 법인담당자·면접관 공통.
  | "member-job-new"
  // 공고 상세(이력서 목록) 페이지 첫 진입 시 자동 노출 — 법인담당자·면접관 공통.
  | "member-job-page"
  // 후보(이력서) 상세 페이지 첫 진입 시 자동 노출 — 법인담당자·면접관 공통.
  | "member-candidate-page"
  // 법인 설정 페이지 첫 진입 시 자동 노출 — 법인담당자 전용(멤버는 접근 불가).
  | "org-settings";

export type TourScenario = {
  id: TourScenarioId;
  label: string;
  emoji: string;
  /** 실행에 필요한 대상 — 없으면 버튼 비활성 + 안내. */
  needs?: "job" | "candidate";
  /** needs 미충족 시 버튼에 보여줄 사유. */
  needsHint?: string;
  steps: TourStep[];
};

export const TOUR_SCENARIOS: TourScenario[] = [
  // /jobs/new 첫 진입 시 자동 노출(데스크톱) — 법인담당자·면접관 공통.
  // 공고 등록 화면에서 "여기서 할 수 있는 것"을 ①지원 링크 생성 ②URL 자동 채우기
  // 순으로 스포트라이트만 한다(팝업 없음 — 폼 입력을 방해하지 않도록).
  {
    id: "member-job-new",
    label: "공고 만들기",
    emoji: "📋",
    steps: [
      {
        // 1/2 — 맨 위 '지원링크 생성' 버튼. 공고 저장 전에 링크(토큰)만 먼저 발급하고,
        // 저장 시 그 공고에 연결된다. 공고가 없어도 가능.
        path: "/jobs/new",
        target: '[data-tour="apply-link-new"]',
        placement: "bottom",
        title: "① 먼저 '지원 링크'를 만들 수 있어요",
        body: "'지원링크 생성'을 누르면 공고를 저장하기 전에 지원 페이지 주소가 먼저 발급돼요. 복사해서 사람인·잡코리아 등 채용 사이트나 회사 홈페이지의 '지원하기'에 등록해 두면, 공고를 저장할 때 그 링크가 공고에 연결됩니다. 지원자가 링크로 들어와 이력서를 올리면 자동으로 개인정보 마스킹·AI 서류평가까지 진행돼요. (지원 링크가 필요 없으면 건너뛰어도 됩니다.)",
      },
      {
        // 2/4 — 기존 공고 URL 붙여넣어 자동 채우기.
        path: "/jobs/new",
        target: '[data-tour="job-import-url"]',
        placement: "bottom",
        title: "② 기존 공고 URL로 자동 채우기",
        body: "사람인·잡코리아·원티드 등에 이미 올린 공고가 있다면, 그 링크 URL을 복사해 여기에 붙여넣고 '가져오기'를 누르세요. 본문(이미지 포함)을 분석해 아래 직무·자격 항목을 자동으로 채워 줘요. (직접 입력해도 됩니다.)",
      },
      {
        // 3/4 — AI 평가 중점 사항. 공고 본문엔 없지만 AI 평가 우선순위를 지정할 수 있음(HR 전용).
        path: "/jobs/new",
        target: '[data-tour="eval-focus"]',
        placement: "top",
        title: "③ 공고엔 없는 'AI 평가 우선순위'를 줄 수 있어요",
        body: "여기 적는 내용은 지원자에게 보이는 공고 본문에는 나오지 않아요. 대신 AI가 서류·면접을 평가할 때 어떤 요소를 더 우선해서 볼지 가중치를 지정할 수 있어요. 예: '보안 솔루션(SOAR/SIEM) 연동 경력을 다른 기술보다 최우선', 'Python 미사용 후보 감점'. 공고에 드러내기 어려운 내부 평가 기준을 여기에 담으면 됩니다. (성별·나이·학교 등 차별 금지 항목은 적어도 AI가 무시해요.)",
      },
      {
        // 4/4 — 공고 비밀번호로 잠그고, '공유'로 면접관 초대(자동 면접관 등록 → PIN 우회).
        path: "/jobs/new",
        target: '[data-tour="job-password"]',
        placement: "top",
        title: "④ 비밀번호로 잠그고, '공유'로 면접관을 초대하세요",
        body: "4자리 비밀번호를 걸면 면접관으로 지정되지 않은 다른 멤버는 이 공고를 열 수 없어요. 함께 평가할 면접관은 공고를 저장한 뒤 상세 화면의 '공유' 기능으로 초대하세요 — 초대받은 사람은 이 공고 면접관으로 자동 등록되어, 비밀번호 없이도 바로 열람할 수 있어요. (법인 담당자는 비밀번호와 무관하게 항상 볼 수 있습니다.)",
      },
    ],
  },
  // /jobs/{jobId} 첫 진입 시 자동 노출(후보가 1명+ 있고 데스크톱일 때) — 법인담당자·면접관 공통.
  // "이 페이지에서 할 일"을 ①이력서 등록 ②역량평가 ③면접관 지정 ④이력서 목록 순으로 안내한다.
  // 드로어·모달을 직접 열고 닫으며 따라하게 한다(popup).
  {
    id: "member-job-page",
    label: "공고 둘러보기",
    emoji: "📑",
    steps: [
      // ── ① 이력서 등록 ──────────────────────────────────────────────
      {
        // 1/7 — '이력서 받기' 버튼 소개(드로어 닫힌 상태). 다음에서 열어 보여준다.
        path: "/jobs/{jobId}",
        target: '[data-tour="resume-intake-btn"]',
        placement: "bottom",
        title: "지원자 이력서는 '이력서 받기'로",
        body: "이 공고에 지원한 이력서는 여기 '이력서 받기'에서 모아요. '다음'을 누르면 열어서, 이력서를 받는 두 가지 방법을 차례로 보여드릴게요.",
      },
      {
        // 2/7 — 드로어를 열고 '지원 링크로 직접 받기' 안내.
        path: "/jobs/{jobId}",
        target: '[data-tour="apply-link"]',
        placement: "left",
        popup: {
          open: '[data-tour="resume-intake-btn"]',
          close: '[data-tour="resume-intake-close"]',
        },
        title: "① 지원 링크로 직접 받기",
        body: "이 공고만의 지원 링크예요. 채용 사이트나 회사 홈페이지의 '지원하기'에 걸어 두면, 지원자가 직접 이력서를 올리고 개인정보 마스킹·AI 서류평가까지 자동으로 진행돼요.",
      },
      {
        // 3/7 — 같은 드로어 안의 '이력서 직접 업로드'. 다음에서 드로어를 닫는다.
        path: "/jobs/{jobId}",
        target: '[data-tour="upload-zone"]',
        placement: "left",
        popup: {
          open: '[data-tour="resume-intake-btn"]',
          close: '[data-tour="resume-intake-close"]',
        },
        title: "② 이력서 직접 업로드",
        body: "이미 보유한 이력서 파일이 있다면 여기로 끌어다 놓거나 클릭해서 올릴 수 있어요. 압축파일(ZIP)·폴더·개별 파일 모두 가능합니다. '다음'을 누르면 이 창은 닫혀요.",
      },
      // ── ② 역량평가 ────────────────────────────────────────────────
      {
        // 4/7 — 역량평가 버튼 소개(모달 닫힌 상태). 드로어는 앞 단계 close 로 닫혀 있다.
        path: "/jobs/{jobId}",
        target: '[data-tour="mcq-btn"]',
        placement: "bottom",
        title: "역량평가 — 면접 전 사전 객관식",
        body: "AI 면접 전에 직무 기본기를 묻는 4지선다를 낼 수 있어요. 점수는 합·불에 반영되지 않는 참고용이에요. '다음'을 누르면 열어서 보여드릴게요.",
      },
      {
        // 5/7 — 역량평가 모달을 열고 내용 안내. 다음에서 모달을 닫는다(백드롭 클릭).
        path: "/jobs/{jobId}",
        target: '[data-tour="mcq-body"]',
        placement: "left",
        popup: {
          open: '[data-tour="mcq-btn"]',
          close: '[role="dialog"][aria-modal="true"]',
        },
        title: "여기서 역량평가를 관리해요",
        body: "'문제 생성'으로 AI가 문항을 만들고, 검토·수정한 뒤 'AI 면접 적용'을 켜면 면접 시작 전에 출제돼요. 적용 여부는 언제든 토글로 켜고 끌 수 있어요. '다음'을 누르면 창이 닫혀요.",
      },
      // ── ③ 면접관 지정 ────────────────────────────────────────────
      {
        // 6/7 — 면접관 의미 안내.
        path: "/jobs/{jobId}",
        target: '[data-tour="interviewers-inline"]',
        placement: "bottom",
        title: "이 공고의 면접관",
        body: "면접관으로 등록된 사람만 잠긴 공고를 열람할 수 있어요. 공유받아 들어온 공고는 자동으로 등록되지만, 직접 찾아온 공고라면 '+ 면접관 지정'으로 본인을 등록하세요. (이미 등록돼 있으면 이름이 표시됩니다.)",
      },
      // ── ④ 이력서 목록 확인 ────────────────────────────────────────
      {
        // 7/7 — 지원자 목록.
        path: "/jobs/{jobId}",
        target: '[data-tour="candidate-list"]',
        placement: "top",
        title: "여기서 지원자 이력서를 확인해요",
        body: "지원자 목록이에요. 상태별로 필터링할 수 있고, 한 명을 클릭하면 이력서 상세와 AI 서류평가 결과로 들어가 면접을 진행할 수 있어요.",
      },
    ],
  },
  // 멤버(면접관) 전용 — /candidates/{id} 첫 진입 시 자동 노출(다음 전형이 있는 후보·데스크톱).
  // 탭(종합평가/서류평가)·토론 드로어를 가이드가 직접 전환·열고 닫으며 안내한다.
  // ① 종합평가 ② 서류평가(평가 내용→단계 변경) ③ 토론.
  {
    id: "member-candidate-page",
    label: "이력서 검토하기",
    emoji: "🧑‍💼",
    steps: [
      // ── ① 종합평가 ──────────────────────────────────────────────
      {
        path: "/candidates/{candidateId}",
        target: '[data-tour="cand-overview"]',
        placement: "bottom",
        // 종합평가 탭(기본)으로 — 뒤로 왔을 때 다른 탭이면 다시 전환(close 불필요=탭).
        popup: { open: '[data-tour="cand-tab-overview"]' },
        title: "종합평가 — 한눈에 보는 요약",
        body: "전형 진행 상태에 따라 서류·면접 점수와 평가 내용이 종합되어 요약돼요. 이 후보자의 현재 인상을 가장 빠르게 파악할 수 있는 화면이에요.",
      },
      // ── ② 서류평가 ──────────────────────────────────────────────
      {
        path: "/candidates/{candidateId}",
        target: '[data-tour="cand-screening"]',
        placement: "top",
        // 서류평가 탭으로 전환.
        popup: { open: '[data-tour="cand-tab-screening"]' },
        title: "서류평가 — 평가 내용 확인",
        body: "AI가 매긴 서류 점수와 6축 적합도, 강점·면접에서 확인할 점을 자세히 볼 수 있어요. 이 후보자와 면접을 진행할지 여기서 먼저 판단해 보세요.",
      },
      {
        path: "/candidates/{candidateId}",
        target: '[data-tour="cand-stage-next"]',
        placement: "bottom",
        title: "단계 변경 — 다음 전형으로",
        body: "서류 평가를 확인했다면 '단계 변경'으로 다음 전형으로 보낼 수 있어요. 서류 단계에서는 여기서 AI 면접 요청이 발송됩니다.",
      },
      // ── ③ 토론 ──────────────────────────────────────────────────
      {
        path: "/candidates/{candidateId}",
        target: '[data-tour="cand-discuss-panel"]',
        placement: "left",
        // 토론 드로어는 항상 마운트(translate)라 '대상 존재'로 열림 판정이 안 됨 →
        // open 트리거(토론 버튼)의 aria-pressed 로 판정해 닫혀 있을 때만 연다.
        popup: {
          open: '[data-tour="cand-discuss-btn"]',
          close: '[data-tour="cand-discuss-close"]',
        },
        title: "면접관 토론",
        body: "면접관들끼리 이 후보자에 대한 의견을 자유롭게 남길 수 있는 공간이에요. 실시간으로 공유돼서, 함께 보는 면접관들과 평가를 맞춰갈 수 있어요.",
      },
    ],
  },
  // 법인 설정(/org/settings) 첫 진입 시 자동 노출 — 법인담당자 전용. 위→아래 순서로
  // ①회사 주소 ②컬처핏 정성평가 ③메일 서버 ④화상 면접(Zoom)을 스포트라이트만 한다(팝업 없음).
  {
    id: "org-settings",
    label: "법인 설정 둘러보기",
    emoji: "⚙️",
    steps: [
      {
        path: "/org/settings",
        target: '[data-tour="cfg-address"]',
        placement: "bottom",
        title: "회사 주소",
        body: "오프라인(대면) 면접 일정을 지정하면, 여기 등록한 회사 주소가 면접 안내 메일에 자동으로 포함돼 발송됩니다.",
      },
      {
        path: "/org/settings",
        target: "#culture-fit",
        placement: "top",
        title: "컬처핏 · 정성 평가",
        body: "자기소개서·AI 면접·대면 면접에서 'NCS 직업기초능력' 기반의 정성 평가를 진행합니다. 우리 회사가 중요하게 보는 역량을 여기서 설정해 두면 평가에 반영돼요.",
      },
      {
        path: "/org/settings",
        target: '[data-tour="cfg-smtp"]',
        placement: "top",
        title: "메일 서버 (SMTP)",
        body: "자사 도메인으로 지원자에게 메일을 발송합니다. 설정하지 않으면 Intervia 메일로 발송돼요.",
      },
      {
        path: "/org/settings",
        target: '[data-tour="cfg-zoom"]',
        placement: "bottom",
        title: "화상 면접 (Zoom)",
        body: "Zoom을 연동하면, 온라인 면접 일정이 확정될 때 자동으로 Zoom 회의가 개설되고 링크가 후보자·면접관에게 발송됩니다.",
      },
    ],
  },
];

export function getScenario(id: TourScenarioId): TourScenario | undefined {
  return TOUR_SCENARIOS.find((s) => s.id === id);
}

/** "/jobs/{jobId}" + {jobId:"3"} → "/jobs/3" */
export function resolvePath(
  path: string,
  params: Record<string, string>
): string {
  return path.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? "");
}

/** 경로에서 hash 를 떼고 pathname 만 — usePathname() 비교용. */
export function pathnameOf(path: string): string {
  return path.split("#")[0];
}

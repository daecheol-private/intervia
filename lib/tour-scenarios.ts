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
};

export type TourScenarioId =
  | "culture-fit"
  | "job-create"
  | "resume-upload"
  | "ai-interview"
  // 멤버(면접관) 전용 — 공고 상세(이력서 목록) 페이지 첫 진입 시 자동 노출.
  | "member-job-page";

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
  {
    id: "culture-fit",
    label: "인재상·컬쳐핏 등록",
    emoji: "🎯",
    steps: [
      {
        path: "/org/settings#culture-fit",
        target: "#culture-fit",
        placement: "top",
        title: "여기서 인재상·컬쳐핏을 등록해요",
        body: "AI 서류 평가와 면접 질문 생성에 자동으로 반영되는 핵심 설정이에요. 기본값이 채워져 있으니 내용만 확인하고, 맨 아래 '저장'을 한 번 눌러 주세요. 언제든 수정할 수 있어요.",
      },
    ],
  },
  {
    id: "job-create",
    label: "공고 등록",
    emoji: "📋",
    steps: [
      {
        path: "/jobs/new",
        target: '[data-tour="job-import-url"]',
        placement: "bottom",
        title: "공고는 URL 붙여넣기로 끝!",
        body: "사람인·잡코리아·원티드 등에서 올린 공고의 링크 URL을 복사해 여기에 붙여넣고 '가져오기'를 누르면, 본문(이미지 포함)을 분석해 아래 항목을 자동으로 채워 줘요.",
      },
    ],
  },
  {
    id: "resume-upload",
    label: "이력서 업로드",
    emoji: "📄",
    needs: "job",
    needsHint: "먼저 공고를 등록하면 안내해 드려요",
    steps: [
      {
        path: "/jobs/{jobId}",
        target: '[data-tour="consent-gate"]',
        placement: "bottom",
        // 업로드 섹션이 접혀 있을 수 있어 미리 펼쳐 둠 (Section storageKey).
        presets: [{ key: "job-upload:{jobId}", value: "1" }],
        title: "먼저 '지원자 동의 확인'부터",
        body: "이력서를 AI로 평가하려면, 지원자에게 'AI 평가 적용 + 거부 시 일반 절차 가능'을 안내했는지 먼저 체크해야 해요. 개인정보보호법상 필요한 절차예요. 체크하지 않아도 업로드와 이후 절차는 진행되지만, 'AI 이력서 평가'는 이용할 수 없어요.",
      },
      {
        path: "/jobs/{jobId}",
        target: '[data-tour="upload-zone"]',
        placement: "top",
        presets: [{ key: "job-upload:{jobId}", value: "1" }],
        title: "여기로 이력서를 올려요",
        body: "압축파일(ZIP)·폴더·개별 파일 모두 끌어다 놓거나 클릭해서 올릴 수 있어요. 단, 암호가 걸린 압축파일은 안 되고, 한 번에 최대 100MB까지 가능해요.",
      },
    ],
  },
  {
    id: "ai-interview",
    label: "AI 면접 진행",
    emoji: "💬",
    needs: "candidate",
    needsHint: "서류 평가가 끝난 이력서가 있어야 진행할 수 있어요",
    steps: [
      {
        path: "/candidates/{candidateId}",
        target: '[data-tour="screening-report"]',
        placement: "top",
        // 1단계는 서류 평가 결과 확인 — 서류 평가 섹션을 펼쳐 둔다. 2단계의 AI 면접
        // 섹션도 함께 펼쳐, 같은 페이지에서 단계가 넘어갈 때 끊김 없이 이어지게 한다.
        presets: [
          { key: "cand-section:서류 평가", value: "1" },
          { key: "cand-section:AI 면접", value: "1" },
        ],
        title: "먼저 서류 평가 결과를 확인하세요",
        body: "AI가 매긴 종합 점수와 6축 공고 적합도(기술·경험·직무·성과·안정성·태도)예요. 강점과 면접에서 확인할 점을 함께 살펴보고, 이 지원자와 면접을 진행할지 판단해 보세요.",
      },
      {
        path: "/candidates/{candidateId}",
        target: '[data-tour="ai-interview-btn"]',
        placement: "top",
        presets: [
          { key: "cand-section:서류 평가", value: "1" },
          { key: "cand-section:AI 면접", value: "1" },
        ],
        title: "확인했다면, AI 면접을 보내세요",
        body: "이 버튼을 누르면 면접 링크가 만들어지고 지원자 이메일로 자동 발송돼요. 지원자가 링크에 접속하면 AI 면접관이 채팅으로 면접을 진행합니다.",
      },
    ],
  },
  // 멤버(면접관) 전용 — /jobs/{jobId} 첫 진입 시 자동 노출. 순서 의존(데이터 상태)이
  // 아니라 "이 페이지에서 할 일"을 위→아래로 안내. 후보 상세(/candidates/{id})의
  // 멤버 가이드는 위 'ai-interview' 시나리오를 그대로 재사용한다(법인담당자 step4와 동일).
  {
    id: "member-job-page",
    label: "이력서 목록 둘러보기",
    emoji: "📑",
    steps: [
      {
        path: "/jobs/{jobId}",
        target: '[data-tour="job-header"]',
        placement: "bottom",
        title: "먼저 공고 내용을 확인하세요",
        body: "상단에서 직무·자격요건·평가 항목 등 공고 내용을 확인할 수 있어요. 면접을 진행하기 전에 어떤 자리인지 먼저 파악해 두세요.",
      },
      {
        path: "/jobs/{jobId}",
        target: '[data-tour="interviewers-inline"]',
        placement: "bottom",
        title: "이 공고의 면접관으로 등록하세요",
        body: "비밀번호로 잠긴 공고는 면접관으로 등록돼 있어야 열람할 수 있어요. 공유받아 들어온 공고는 자동으로 등록되지만, 직접 찾아온 공고는 여기 '+ 면접관 지정'으로 본인을 등록하세요. (이미 등록돼 있으면 이름이 표시됩니다.)",
      },
      {
        path: "/jobs/{jobId}",
        target: '[data-tour="candidate-list"]',
        placement: "top",
        title: "여기서 지원자 이력서를 확인해요",
        body: "지원자 목록이에요. 상태별로 필터링할 수 있고, 한 명을 클릭하면 이력서 상세와 AI 서류평가 결과로 들어가 면접을 진행할 수 있어요.",
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

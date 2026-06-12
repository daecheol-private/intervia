/**
 * 첫 실행 가이드(신규 법인 온보딩) 단계 정의 — 대시보드 카드(app/page.tsx)와
 * 플로팅 위젯(SetupGuideWidget)이 공유. 단계 추가/문구 변경은 여기만.
 */
export type SetupStepState = {
  step1: boolean; // 인재상·컬쳐핏 확인(설정 저장)
  step2: boolean; // 공고 등록
  step3: boolean; // 이력서 업로드
  step4: boolean; // AI 면접 발송(응시 대기 이상)
};

export type SetupStep = {
  n: number;
  done: boolean;
  title: string;
  desc: string;
  cta: { href: string; label: string; pcOnly: boolean } | null;
};

export function buildSetupSteps(
  { step1, step2, step3, step4 }: SetupStepState,
  firstJobId: number | null
): SetupStep[] {
  return [
    {
      n: 1,
      done: step1,
      title: "인재상·컬쳐핏 확인",
      desc: "기본값이 준비되어 있어요. AI 서류 평가와 면접 질문 생성에 활용되니 내용만 확인하고 저장해 주세요. 언제든지 수정할 수 있습니다.",
      cta: {
        href: "/org/settings#culture-fit",
        label: "인재상·컬쳐핏 확인하기",
        pcOnly: false,
      },
    },
    {
      n: 2,
      done: step2,
      title: "공고 만들기",
      desc: "직무·자격·면접 시간을 입력해 채용 공고를 등록합니다.",
      cta: { href: "/jobs/new", label: "공고 등록하기", pcOnly: true },
    },
    {
      n: 3,
      done: step3,
      title: "이력서 올리기",
      desc: "지원자 이력서 PDF를 올리면 자동 마스킹 후 AI 서류 평가가 진행됩니다.",
      cta: firstJobId
        ? { href: `/jobs/${firstJobId}`, label: "이력서 올리기", pcOnly: false }
        : null,
    },
    {
      n: 4,
      done: step4,
      title: "AI 면접 보내기",
      desc: "서류를 통과한 지원자에게 링크를 보내면 AI 면접관이 채팅으로 면접을 진행합니다.",
      cta: firstJobId
        ? { href: `/jobs/${firstJobId}`, label: "면접 보낼 후보 보기", pcOnly: false }
        : null,
    },
  ];
}

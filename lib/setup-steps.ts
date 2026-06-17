/**
 * 첫 실행 가이드(신규 법인 온보딩) 단계 정의 — 대시보드 카드(app/page.tsx)와
 * 플로팅 위젯(SetupGuideWidget)이 공유. 단계 추가/문구 변경은 여기만.
 *
 * 각 단계는 `tour` 시나리오와 연결돼 있어, 단계를 누르면 단순 이동 대신
 * 실제 화면으로 가서 게임 튜토리얼식 안내(스포트라이트+말풍선)를 띄운다.
 */
import type { TourScenarioId } from "./tour-scenarios";

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
  /** 누르면 실행할 둘러보기 시나리오. (공고 만들기처럼 한 투어가 여러 스텝일 수 있음) */
  tour: TourScenarioId;
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
      tour: "culture-fit",
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
      desc: "지원 링크를 만들어 지원자를 받고, 기존 공고 URL로 항목을 자동으로 채워 공고를 등록합니다.",
      tour: "job-create",
      cta: { href: "/jobs/new", label: "공고 등록하기", pcOnly: true },
    },
    {
      n: 3,
      done: step3,
      title: "이력서 올리기",
      desc: "지원 링크로 모은 이력서 외에, 보유한 이력서 PDF를 직접 올릴 수도 있어요. 올리면 자동 마스킹 후 AI 서류 평가가 진행됩니다.",
      tour: "resume-upload",
      cta: firstJobId
        ? { href: `/jobs/${firstJobId}`, label: "이력서 올리기", pcOnly: false }
        : null,
    },
    {
      n: 4,
      done: step4,
      title: "AI 면접 보내기",
      desc: "서류를 통과한 지원자에게 링크를 보내면 AI 면접관이 채팅으로 면접을 진행합니다.",
      tour: "ai-interview",
      cta: firstJobId
        ? { href: `/jobs/${firstJobId}`, label: "면접 보낼 후보 보기", pcOnly: false }
        : null,
    },
  ];
}

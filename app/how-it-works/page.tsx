import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  FileSearch,
  MessageSquare,
  CalendarClock,
  ListChecks,
  Mic,
  BarChart3,
} from "lucide-react";
import { SITE_INFO } from "@/lib/site-info";
import { WELCOME_BONUS_TOKENS } from "@/lib/tokens";
import { TOKEN_KRW } from "@/lib/beta";

export const metadata = {
  title: `작동 방식 — ${SITE_INFO.serviceName}`,
  description:
    "공고 등록부터 합·불 통보까지, Intervia 가 채용 사이클을 어떻게 자동화하는지 실제 사용 순서 7단계로 설명합니다.",
};

/**
 * 작동 방식 상세 (공개 페이지). 랜딩의 HowItWorksCarousel(SLIDES)과 같은 7단계를
 * 세로로 풀어 상세 설명한다. 캐러셀 목업 대신 텍스트 중심 — 문구는 SLIDES 와 일치 유지.
 */
const STEPS = [
  {
    Icon: ClipboardList,
    title: "공고 등록",
    lead: "채용 사이트의 공고 URL만 붙여넣으면, 공고 내용이 자동으로 채워집니다.",
    points: [
      "사람인·잡코리아·원티드 공고 URL을 그대로 붙여넣습니다.",
      "'가져오기' 한 번이면 본문과 이미지까지 분석해 제목·직무·자격요건을 자동 입력합니다(직접 수정도 가능).",
      "예상 면접 시간을 10·20·30분 중에서 고릅니다.",
    ],
  },
  {
    Icon: FileSearch,
    title: "이력서 수집 → 자동 평가",
    lead: "공고별 '지원하기' 링크로 받거나 직접 올리면, AI가 알아서 채점하고 등급을 매깁니다.",
    points: [
      "공고마다 전용 '지원하기' 링크가 생깁니다. 채용 사이트·회사 홈페이지에 붙여넣으면 지원자가 직접 이력서를 올립니다.",
      "보유한 이력서는 파일·폴더·압축파일(ZIP)로 한 번에 업로드합니다.",
      "AI가 채점할 때는 이름·연락처 등 개인정보를 마스킹해 전달하므로, 편향 없이 평가합니다.",
      "AI가 6개 항목으로 채점하고 추천 등급까지 매깁니다.",
    ],
  },
  {
    Icon: MessageSquare,
    title: "3단계 AI 면접",
    lead: "후보자는 메일과 카카오톡으로 받은 링크만 누르면, 인성검사·직무 역량 평가를 거쳐 AI 면접관과 1:1 심층 면접까지 한 번에 봅니다.",
    points: [
      "인성검사 → 직무 역량 → 심층 면접, 3단계로 검증합니다.",
      "심층 면접에선 공고와 이력서를 기반으로 질문하고, 답변마다 꼬리질문으로 더 깊이 파고듭니다.",
      "지원자는 채팅이나 음성으로 답변할 수 있습니다.",
      "붙여넣기·탭 이탈·문체로 외부 AI 보조 신호를 잡아내고, 끝나면 곧바로 자동 평가합니다.",
    ],
  },
  {
    Icon: CalendarClock,
    title: "면접 일정 조율",
    lead: "가능한 시간만 제시하면 후보자가 직접 고르고, Zoom 회의까지 자동으로 만들어집니다.",
    points: [
      "가능한 면접 시간을 여러 개 제시합니다.",
      "후보자가 직접 선택하거나, 다른 시간을 역제시합니다.",
      "확정되면 Zoom 회의와 캘린더 초대가 자동 생성·발송됩니다.",
    ],
  },
  {
    Icon: ListChecks,
    title: "맞춤 면접 문항 생성",
    lead: "이력서와 AI 면접 결과를 종합해, 대면 면접에서 그대로 쓸 질문지를 만들어 줍니다.",
    points: [
      "이력서·서류평가·AI 면접 결과를 모두 반영한 맞춤 질문을 만듭니다.",
      "질문마다 '무엇을 검증하는지'와 꼬리질문까지 제시합니다.",
      "면접관은 그대로 들고 들어가 준비 시간을 단축합니다.",
    ],
  },
  {
    Icon: Mic,
    title: "대면 면접 녹음 → AI 평가",
    lead: "1·2차 대면 면접을 녹음 파일로 올리거나 라이브로 받아쓰면, 화자를 분리해 평가 리포트를 만들어 줍니다.",
    points: [
      "녹음 파일 업로드 또는 브라우저 라이브 녹음으로 1·2차 대면 면접을 기록합니다.",
      "전사 후 지원자·면접관 발언을 자동으로 분리합니다.",
      "역량 점수·강점·우려·다음 추천 질문까지 평가 리포트로 정리합니다.",
      "녹음 파일은 전사 후 보관하지 않습니다.",
    ],
  },
  {
    Icon: BarChart3,
    title: "결과 리포트 · 합·불 통보",
    lead: "모든 평가를 한 화면에서 비교하고, 합·불 결정과 동시에 결과를 메일과 카카오톡으로 자동 통보합니다.",
    points: [
      "기술·경험·협업·적합 4영역 점수와 근거를 한눈에 봅니다.",
      "1·2차 면접관 스코어카드를 나란히 비교합니다.",
      "합·불 결정과 동시에 결과가 메일과 카카오톡으로 자동 발송됩니다.",
    ],
  },
];

// 각 단계 실제 화면 스크린샷 (public/). STEPS 순서와 1:1 대응.
const STEP_IMAGES = [
  "/how-1-job-new.png",
  "/how-2-resume-eval.png",
  "/how-3-ai-interview.png",
  "/how-4-schedule.png",
  "/how-5-questions.png",
  "/how-6-offline-eval.png",
  "/how-7-report.png",
];

export default function HowItWorksPage() {
  const welcomeKrw = (WELCOME_BONUS_TOKENS * TOKEN_KRW).toLocaleString();
  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Link href="/" className="text-xs text-ink-muted hover:underline">
        ← 홈
      </Link>
      <h1 className="text-2xl font-bold text-ink mt-3">
        Intervia 는 이렇게 작동합니다
      </h1>
      <p className="text-sm text-ink-soft leading-relaxed mt-2">
        공고 등록부터 합·불 통보까지 — 채용 담당자가 매번 할 필요 없는 일을 AI 가
        처리합니다. 실제 사용 순서를 7단계로 정리했습니다.
      </p>

      <ol className="mt-10 space-y-8">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            {/* 번호 + 연결선 */}
            <div className="flex flex-col items-center shrink-0">
              <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-surface text-base font-bold shadow-sm">
                {i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span className="flex-1 w-px bg-border-default mt-2" aria-hidden />
              )}
            </div>
            <div className="min-w-0 pb-2">
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                <s.Icon className="w-4 h-4 text-primary-deep shrink-0" />
                {s.title}
              </h2>
              <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">
                {s.lead}
              </p>
              <ul className="mt-3 space-y-1.5">
                {s.points.map((p, k) => (
                  <li
                    key={k}
                    className="flex items-start gap-2 text-sm text-ink-soft leading-relaxed"
                  >
                    <span
                      className="mt-2 w-1 h-1 rounded-full bg-primary shrink-0"
                      aria-hidden
                    />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <figure className="mt-4 overflow-hidden rounded-xl border border-border-default shadow-sm">
                <img
                  src={STEP_IMAGES[i]}
                  alt={`${s.title} 실제 화면`}
                  loading="lazy"
                  className="block w-full"
                />
              </figure>
            </div>
          </li>
        ))}
      </ol>

      {/* CTA */}
      <div className="mt-12 rounded-2xl border border-border-default bg-surface-alt/50 p-6 text-center">
        <p className="text-sm font-semibold text-ink">지금 바로 시작해 보세요</p>
        <p className="text-xs text-ink-soft mt-1">
          신규 가입 시 {WELCOME_BONUS_TOKENS}토큰(약 {welcomeKrw}원) 무료 제공 ·
          신용카드 등록 불필요
        </p>
        <Link
          href="/signup"
          className="mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-surface text-sm font-semibold hover:bg-primary-deep transition-colors"
        >
          무료로 시작하기 <ArrowRight className="w-4 h-4" />
        </Link>
        <div className="mt-4 text-xs text-ink-soft">
          <Link href="/features" className="text-primary hover:underline">
            전체 기능
          </Link>{" "}
          ·{" "}
          <Link href="/pricing" className="text-primary hover:underline">
            요금
          </Link>{" "}
          ·{" "}
          <Link href="/faq" className="text-primary hover:underline">
            자주 묻는 질문
          </Link>
        </div>
      </div>
    </main>
  );
}

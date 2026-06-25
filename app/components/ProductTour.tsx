"use client";

/**
 * 랜딩 "실제 제품으로 보는 Intervia" — 탭형 제품 투어 (4탭).
 *
 * 데이터는 가상 샘플(홍길동 · Java 백엔드 5년차) — product-tour-data.ts.
 * - 지원자 평가: 종합평가(overview 탭) 재현
 * - AI 면접: 3단계 중 심층면접 채팅 화면 재현
 * - 면접 문제 생성: 1차 대면 질문지 화면 재현
 * - 라이브 녹음: 대면 면접 화자분리 + 추천질문 화면 재현
 *
 * 모든 탭은 같은 높이(FRAME_H)의 브라우저 프레임에 담겨 탭을 바꿔도 크기가 흔들리지 않는다.
 * 콘텐츠가 길면 내부 스크롤, 짧으면 가변 영역(flex-1)을 늘려 프레임을 채운다.
 */

import { useState } from "react";
import {
  ClipboardCheck,
  MessageSquare,
  ListChecks,
  Mic,
  Lock,
  Sparkles,
  Send,
  Target,
  RefreshCw,
  Check,
  CornerDownRight,
  AlertTriangle,
} from "lucide-react";
import { FitHexagon } from "@/app/candidates/[id]/screening-report";
import { HL, ScoreBar } from "@/app/candidates/[id]/shared";
import { Container, SectionHeading } from "./ui";
import {
  DEMO_NAME,
  DEMO_ROLE,
  DEMO_META,
  DEMO_EMAIL,
  DEMO_SCORE,
  DEMO_REC,
  DEMO_SUMMARY,
  DEMO_BREAKDOWN,
  DEMO_QUESTIONS,
  DEMO_CHAT,
  DEMO_LIVE,
  DEMO_SUGGESTIONS,
} from "./product-tour-data";

// 모든 탭이 공유하는 프레임 콘텐츠 높이(데스크톱). 넘치면 내부 스크롤.
const FRAME_H = "h-[540px]";

type TabKey = "eval" | "interview" | "questions" | "live";

const TABS: {
  key: TabKey;
  label: string;
  sub: string;
  Icon: typeof ClipboardCheck;
  route: string;
}[] = [
  {
    key: "eval",
    label: "지원자 평가",
    sub: "AI 종합 평가 리포트",
    Icon: ClipboardCheck,
    route: "intervia.kr/candidates/392",
  },
  {
    key: "interview",
    label: "AI 면접",
    sub: "3단계 · 심층 면접",
    Icon: MessageSquare,
    route: "intervia.kr/interview/iv_8x2k…",
  },
  {
    key: "questions",
    label: "면접 문제 생성",
    sub: "1차 대면 질문지",
    Icon: ListChecks,
    route: "intervia.kr/candidates/392",
  },
  {
    key: "live",
    label: "라이브 녹음",
    sub: "화자 분리 · 실시간",
    Icon: Mic,
    route: "intervia.kr/candidates/392",
  },
];

// ── 브라우저 창 프레임 (고정 높이 · 내부 스크롤) ──────────────────────
function BrowserFrame({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-card shadow-2xl ring-1 ring-black/5 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2.5 bg-surface-alt border-b border-border-default">
        <span className="w-2.5 h-2.5 rounded-full bg-danger/50" />
        <span className="w-2.5 h-2.5 rounded-full bg-warning/50" />
        <span className="w-2.5 h-2.5 rounded-full bg-primary/40" />
        <div className="ml-2 flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-card border border-border-default max-w-[280px]">
          <Lock className="w-2.5 h-2.5 text-ink-muted shrink-0" />
          <span className="text-[10px] text-ink-muted truncate">{url}</span>
        </div>
      </div>
      <div className={`bg-surface p-4 sm:p-5 overflow-y-auto ${FRAME_H}`}>
        {children}
      </div>
    </div>
  );
}

// 제품 상세의 탭 줄 (실제 candidates/[id] 탭과 동일 라벨).
function ProductTabBar() {
  const tabs = [
    "종합 평가",
    "이력서 평가",
    "AI 면접",
    "1차 면접",
    "2차 면접",
    "첨부",
  ];
  return (
    <div className="flex items-center gap-1 border-b border-border-default text-xs overflow-x-auto shrink-0">
      {tabs.map((t, i) => (
        <span
          key={t}
          className={`px-2.5 py-1.5 -mb-px border-b-2 whitespace-nowrap ${
            i === 0
              ? "border-primary text-primary-deep font-semibold"
              : "border-transparent text-ink-muted"
          }`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

// ── 탭1: 지원자 평가 (overview 재현 — 가상 샘플 데이터) ────────────────
function EvalScreen() {
  return (
    <div className="flex flex-col gap-4 min-h-full">
      {/* 후보 헤더 (가명) — 이름/직무/메타 */}
      <div className="flex items-center gap-3 shrink-0">
        {/* 데모용 가상 인물(AI 생성) 증명사진 — 고정 에셋, next/image 불필요 */}
        <img
          src="/demo-candidate.jpg"
          alt={`${DEMO_NAME} 증명사진`}
          className="w-12 h-12 rounded-full object-cover bg-primary-soft shrink-0"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-ink">{DEMO_NAME}</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-soft text-primary-deep">
              서류평가
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-muted mt-0.5">
            <span className="text-ink-soft">{DEMO_ROLE}</span>
            <span>{DEMO_META}</span>
            <span>{DEMO_EMAIL}</span>
          </div>
        </div>
      </div>

      <ProductTabBar />

      {/* overview 카드 — 좌: 종합점수 + ScoreBar + 소견 / 우: 6축 차트 */}
      <div className="flex-1 bg-card border border-border-default rounded-2xl shadow-sm p-5 flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-6 flex-wrap">
            <div>
              <div className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                종합 평가
              </div>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-5xl font-bold tabular-nums text-primary-deep">
                  {DEMO_SCORE}
                </span>
                <span className="text-sm text-ink-muted">/100</span>
                <span className="ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border border-primary bg-primary text-surface">
                  {DEMO_REC}
                </span>
              </div>
            </div>
            <div className="flex-1 min-w-[180px] max-w-xs space-y-2 pt-2">
              <ScoreBar label="서류" score={DEMO_SCORE} />
              <ScoreBar label="면접" score={null} />
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm text-ink-soft leading-relaxed">
              <HL text={DEMO_SUMMARY} />
            </p>
          </div>
        </div>

        <div className="lg:w-[300px] shrink-0 lg:border-l lg:border-border-default lg:pl-6 flex flex-col">
          <div className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-1">
            공고 적합도 (6축)
          </div>
          <div className="flex-1 flex items-center justify-center">
            <FitHexagon breakdown={DEMO_BREAKDOWN} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 탭2: AI 면접 (심층면접 채팅 화면 재현) ────────────────────────────
function StepDot({
  n,
  label,
  state,
}: {
  n: number;
  label: string;
  state: "done" | "active";
}) {
  return (
    <span className="flex items-center gap-1 min-w-0">
      <span
        className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full text-surface ${
          state === "done"
            ? "bg-primary"
            : "bg-primary text-[8px] font-bold ring-2 ring-primary/25"
        }`}
      >
        {state === "done" ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : n}
      </span>
      <span
        className={`text-[10px] whitespace-nowrap ${
          state === "active"
            ? "font-bold text-primary-deep"
            : "font-medium text-ink-soft"
        }`}
      >
        {label}
      </span>
    </span>
  );
}

function InterviewScreen() {
  return (
    <div className="flex flex-col gap-3 min-h-full">
      {/* 면접 헤더 */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-surface" strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-ink truncate">
              Intervia AI 면접관
            </div>
            <div className="text-[10px] text-ink-soft">{DEMO_ROLE} · 약 20분</div>
          </div>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-ink-soft tabular-nums shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          08:12
        </span>
      </div>

      {/* 단계 프로그레스 */}
      <div className="flex items-center gap-1.5 rounded-xl border border-border-default bg-card px-3 py-2 shrink-0">
        <StepDot n={1} label="인성검사" state="done" />
        <span className="h-px flex-1 min-w-[8px] bg-primary/40" />
        <StepDot n={2} label="직무역량" state="done" />
        <span className="h-px flex-1 min-w-[8px] bg-primary/40" />
        <StepDot n={3} label="심층면접" state="active" />
      </div>

      {/* 채팅 — flex-1 로 프레임을 채움 */}
      <div className="flex-1 flex flex-col justify-end gap-2.5 rounded-xl border border-border-default bg-gradient-to-b from-surface-alt/30 to-card p-3 overflow-hidden">
        {DEMO_CHAT.map((m, i) =>
          m.role === "ai" ? (
            <div key={i} className="flex items-end gap-2 max-w-[88%]">
              <span className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-3 h-3 text-surface" strokeWidth={2.5} />
              </span>
              <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-card border border-border-default text-[13px] text-ink leading-relaxed">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-end gap-2 max-w-[88%] self-end">
              <div className="px-3 py-2 rounded-2xl rounded-br-sm bg-primary text-surface text-[13px] leading-relaxed">
                {m.text}
              </div>
            </div>
          )
        )}
        <div className="flex items-end gap-2">
          <span className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
            <Sparkles className="w-3 h-3 text-surface" strokeWidth={2.5} />
          </span>
          <div className="px-3 py-2.5 rounded-2xl rounded-bl-sm bg-card border border-border-default flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse" style={{ animationDelay: "0.2s" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse" style={{ animationDelay: "0.4s" }} />
          </div>
        </div>
      </div>

      {/* 입력창 */}
      <div className="flex items-center gap-2 rounded-xl border border-border-default bg-card px-3 py-2 shrink-0">
        <span className="flex-1 text-[13px] text-ink-muted">
          답변을 입력하거나 마이크 버튼을 누르세요
        </span>
        <span className="w-7 h-7 rounded-full bg-primary-soft flex items-center justify-center shrink-0">
          <Mic className="w-3.5 h-3.5 text-primary" />
        </span>
        <span className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0">
          <Send className="w-3.5 h-3.5 text-surface" />
        </span>
      </div>
      <p className="text-[10px] text-ink-muted text-center shrink-0">
        붙여넣기·탭 이탈·문체로 외부 AI 보조 신호를 수집하며, 종료 즉시 자동 평가됩니다.
      </p>
    </div>
  );
}

// ── 탭3: 면접 문제 생성 (1차 질문지 — 가상 샘플) ──────────────────────
function QuestionScreen() {
  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          <ListChecks className="w-4 h-4 text-primary" />
          AI 생성 면접 질문지
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent-soft text-accent-deep">
            1차 대면용
          </span>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary-soft text-primary-deep text-[10px] font-medium">
          <RefreshCw className="w-3 h-3" />
          다시 생성
        </span>
      </div>

      {/* 면접 전략 */}
      <div className="rounded-xl border border-primary/25 bg-primary-soft/40 px-3.5 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-primary-deep mb-1">
          면접 전략
        </div>
        <p className="text-[13px] text-ink-soft leading-relaxed">
          <HL text={DEMO_QUESTIONS.strategy} />
        </p>
      </div>

      {/* 섹션별 문항 */}
      {DEMO_QUESTIONS.sections.map((sec, si) => (
        <div
          key={si}
          className="rounded-xl border border-border-default bg-card p-3.5 shadow-sm"
        >
          <div className="text-sm font-bold text-ink">
            {si + 1}. {sec.title}
          </div>
          <p className="text-[11px] text-ink-muted leading-snug mt-0.5">
            <HL text={sec.focus} />
          </p>
          <div className="mt-2.5 space-y-2.5">
            {sec.questions.map((q, qi) => (
              <div
                key={qi}
                className="rounded-lg bg-surface-alt/60 border border-border-default/60 p-3"
              >
                <div className="text-[13px] font-medium text-ink leading-relaxed">
                  <HL text={q.question} />
                </div>
                <div className="mt-1.5 flex items-start gap-1 text-[11px] text-primary-deep">
                  <Target className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>검증 포인트: {q.intent}</span>
                </div>
                {q.followups.map((f, fi) => (
                  <div
                    key={fi}
                    className="mt-1 flex items-start gap-1 text-[11px] text-ink-soft pl-3.5"
                  >
                    <CornerDownRight className="w-3 h-3 shrink-0 mt-0.5 text-ink-muted" />
                    <span>{f}</span>
                  </div>
                ))}
                <div className="mt-1.5 text-[10px] text-ink-muted italic">
                  근거: {q.basis}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 반드시 확인할 우려 신호 */}
      <div className="rounded-xl border border-warning/30 bg-warning-soft/50 p-3.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-warning mb-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          반드시 확인할 신호
        </div>
        <ul className="space-y-1">
          {DEMO_QUESTIONS.redFlags.map((r, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-ink-soft leading-snug">
              <span className="w-1.5 h-1.5 rounded-full bg-warning mt-1.5 shrink-0" />
              <span>
                <HL text={r} />
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[10px] text-ink-muted text-center">
        이력서 · 서류평가 · AI 면접 · 법인 컬처핏 기반 · 6개 영역 16문항 (일부 표시)
      </p>
    </div>
  );
}

// ── 탭4: 라이브 녹음 (화자분리 + 추천질문 화면 재현) ──────────────────
function LiveScreen() {
  return (
    <div className="flex flex-col gap-3 min-h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-2 text-sm font-bold text-ink">
          <Mic className="w-4 h-4 text-primary" />
          대면 면접 · 라이브 녹음
          <span className="text-[10px] font-medium text-ink-muted">1차 대면</span>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-danger tabular-nums">
          <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
          ● REC 18:24
        </span>
      </div>

      {/* 본문 — flex-1 로 프레임을 채움 */}
      <div className="flex-1 grid md:grid-cols-[1.6fr_1fr] gap-3 min-h-0">
        {/* 좌: 화자 분리 전사 */}
        <div className="flex flex-col rounded-xl border border-border-default bg-gradient-to-b from-surface-alt/30 to-card p-3 min-h-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-soft mb-2 shrink-0">
            정리된 대화 (화자 구분)
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto">
            {DEMO_LIVE.map((seg, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span
                  className={`shrink-0 mt-px text-[8px] font-semibold px-1.5 py-0.5 rounded border ${
                    seg.role === "candidate"
                      ? "bg-card text-info border-info/30"
                      : "bg-surface-alt text-ink-soft border-border-default"
                  }`}
                >
                  {seg.role === "candidate" ? "지원자" : "면접관"}
                </span>
                <span className="text-[13px] text-ink leading-relaxed">
                  {seg.text}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 pt-2 border-t border-border-default/60 text-[11px] text-ink-muted italic shrink-0">
            말씀하시면 인식되는 즉시 화자가 구분돼 정리됩니다…
          </div>
        </div>

        {/* 우: 추천 질문 (질문지 연동) */}
        <div className="flex flex-col rounded-xl border border-border-default bg-card p-3 min-h-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-soft mb-2 shrink-0">
            추천 질문 · 클릭 시 제거
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto">
            {DEMO_SUGGESTIONS.map((s, i) => (
              <div
                key={i}
                className="text-[12px] text-ink-soft leading-snug rounded-lg border border-border-default bg-surface-alt/40 px-2.5 py-1.5"
              >
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-ink-soft shrink-0">
        <Lock className="w-3 h-3 text-primary shrink-0" />
        전사 후 녹음 파일은 보관하지 않습니다. 최대 1시간까지 녹음됩니다.
      </div>
    </div>
  );
}

export function ProductTour() {
  const [active, setActive] = useState<TabKey>("eval");
  const tab = TABS.find((t) => t.key === active)!;

  return (
    <section className="relative overflow-hidden bg-surface border-y border-border-default">
      {/* 배경 — Hero 톤 */}
      <div
        aria-hidden
        className="absolute -z-10 left-1/2 top-0 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-primary-soft/40 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(var(--ink) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <Container width="xl" className="py-16 sm:py-20">
        <SectionHeading
          className="mb-10 sm:mb-12"
          eyebrow="제품 둘러보기"
          eyebrowIcon={Sparkles}
          title="실제 제품으로 보는 Intervia"
          subtitle="직관적인 인터페이스로 더 효율적인 채용을 경험하세요."
        />

        <div className="grid lg:grid-cols-[260px_1fr] gap-5 lg:gap-7 items-start">
          {/* 좌측 탭 네비 */}
          <nav className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible -mx-1 px-1 lg:mx-0 lg:px-0">
            {TABS.map((t) => {
              const on = t.key === active;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActive(t.key)}
                  aria-current={on}
                  className={`group flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all shrink-0 lg:w-full ${
                    on
                      ? "bg-primary-soft border-primary/30 shadow-sm"
                      : "bg-card border-border-default hover:border-border-strong hover:bg-surface-alt/60"
                  }`}
                >
                  <span
                    className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${
                      on
                        ? "bg-primary text-surface"
                        : "bg-surface-alt text-ink-soft group-hover:text-primary"
                    }`}
                  >
                    <t.Icon className="w-4 h-4" strokeWidth={2} />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block text-sm font-semibold leading-tight ${
                        on ? "text-primary-deep" : "text-ink"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span className="block text-[11px] text-ink-muted leading-tight mt-0.5 whitespace-nowrap lg:whitespace-normal">
                      {t.sub}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* 우측 브라우저 프레임 */}
          <BrowserFrame url={tab.route}>
            {active === "eval" ? (
              <EvalScreen />
            ) : active === "interview" ? (
              <InterviewScreen />
            ) : active === "questions" ? (
              <QuestionScreen />
            ) : (
              <LiveScreen />
            )}
          </BrowserFrame>
        </div>
      </Container>
    </section>
  );
}

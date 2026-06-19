"use client";

/**
 * Hero 우측 AI 면접 채팅 미리보기 — Intervia 서비스 소개를 "면접관 ↔ 지원자"
 * 대화로 풀어내, 실제 면접 UI 가 흐르듯 메시지가 한 줄씩 타이핑·등장한다.
 * 영상 대신 "제품이 직접 보이는" 어필 + 대화 내용 자체가 셀링포인트(자기참조 데모).
 *
 * 상태머신: step(현재 진행 중 메시지) × done(확정 표시 여부).
 *   typing(인디케이터) → 일정 시간 후 done(메시지 확정) → 다음 step.
 *   마지막까지 가면 잠시 멈췄다가 처음부터 무한 반복. 확정 후 머무는 시간은
 *   답변이 길수록 길어진다(읽을 시간 확보).
 * prefers-reduced-motion: reduce 시 전체 대화를 정적으로 표시(애니메이션·루프 없음).
 */
import { useEffect, useRef, useState } from "react";
import { Sparkles, User } from "lucide-react";

type Msg = { role: "ai" | "user"; text: string };

// 대화 내용 = Intervia 기능 안내. 면접관(좌측)이 묻고, Intervia(우측)가
// 답한다 — 채용 워크플로우 순서(공고 → 이력서 → AI 면접 → 일정 → 대면).
const SCRIPT: Msg[] = [
  {
    role: "ai",
    text: "안녕하세요, 반갑습니다. 먼저 공고는 어떻게 등록하면 되나요?",
  },
  {
    role: "user",
    text: "네, 아주 간단합니다. 쓰시던 채용공고의 URL만 붙여넣으시면 제목과 직무, 자격요건까지 제가 알아서 채워드려요.",
  },
  {
    role: "ai",
    text: "좋네요. 그럼 지원자 이력서는 어떻게 모으시나요?",
  },
  {
    role: "user",
    text: "공고마다 '지원하기' 링크를 만들어 드려요. 채용 사이트에 붙여두시면 지원자가 직접 올리고, 이미 받아두신 이력서는 파일이나 ZIP으로 한 번에 올리셔도 됩니다.",
  },
  {
    role: "ai",
    text: "그렇군요. AI 면접은 실제로 어떻게 진행되나요?",
  },
  {
    role: "user",
    text: "크게 세 단계예요. 먼저 인성검사를 보고, 다음으로 직무 역량을 평가한 뒤, 마지막엔 AI 면접관이 1:1로 심층 면접까지 진행합니다.",
  },
  {
    role: "ai",
    text: "사실 대면 면접 일정 잡는 게 늘 골치인데요.",
  },
  {
    role: "user",
    text: "그 부분은 제가 도와드려요. 가능한 시간만 몇 개 골라주시면 지원자가 직접 선택해 확정하고, 온라인 면접이면 Zoom 회의까지 자동으로 만들어 둡니다.",
  },
  {
    role: "ai",
    text: "대면 면접 자리에서도 도움받을 수 있을까요?",
  },
  {
    role: "user",
    text: "물론이죠. 이력서와 평가 결과를 바탕으로 맞춤 질문지를 만들어 드리고, 면접 중엔 라이브 녹음으로 대화를 정리해 평가 리포트까지 작성해 드립니다.",
  },
  {
    role: "ai",
    text: "마지막으로, Intervia 를 한마디로 소개한다면요?",
  },
  {
    role: "user",
    text: "지원자와의 첫 대화는 저에게 맡기시고, 정말 중요한 결정에만 집중하세요. 그게 바로 Intervia 입니다.",
  },
];

// 단계 전환 타이밍(ms) — 더 빠르게 (원본 대비 누적 ~56%)
const AI_TYPING = 480; // AI 가 질문을 "작성"하는 시간
const USER_TYPING = 620; // 지원자가 답변을 "입력"하는 시간
const LOOP_HOLD = 3000; // 마지막 메시지 후 처음으로 되돌아가기 전 정지 (3초 — 마지막 답변을 읽을 시간 확보)

// 메시지 확정 후 다음 단계까지 머무는 시간 — 길수록 오래(읽을 시간)
function holdFor(text: string) {
  return Math.min(2480, 680 + text.length * 28);
}

const TOTAL_ANSWERS = SCRIPT.filter((m) => m.role === "user").length;

export function ChatPreview() {
  const [reduced, setReduced] = useState(false);
  const [step, setStep] = useState(0); // 현재 타이핑 중인 메시지 인덱스
  const [done, setDone] = useState(false); // step 메시지가 확정 표시됐는가
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false); // 위로 넘쳐 잘리기 시작했는가(상단 페이드용)

  // prefers-reduced-motion 감지 — reduce 면 전체 대화를 정적 표시
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // 상태머신 — typing → done → 다음 step (마지막이면 루프 리셋)
  useEffect(() => {
    if (reduced) return;
    let t: ReturnType<typeof setTimeout>;
    if (!done) {
      const dur = SCRIPT[step].role === "ai" ? AI_TYPING : USER_TYPING;
      t = setTimeout(() => setDone(true), dur);
    } else {
      const isLast = step >= SCRIPT.length - 1;
      const hold = isLast ? LOOP_HOLD : holdFor(SCRIPT[step].text);
      t = setTimeout(() => {
        setStep(isLast ? 0 : step + 1);
        setDone(false);
      }, hold);
    }
    return () => clearTimeout(t);
  }, [step, done, reduced]);

  // 확정 표시할 메시지 + 현재 타이핑 인디케이터
  const shownCount = reduced ? SCRIPT.length : step + (done ? 1 : 0);
  const shown = SCRIPT.slice(0, shownCount);
  const typingRole =
    !reduced && !done && step < SCRIPT.length ? SCRIPT[step].role : null;

  // 새 메시지가 등장할 때마다 맨 아래로 스크롤 — 일반 채팅창처럼 위에서
  // 시작해 아래로 쌓이고, 넘치면 최신 메시지가 보이도록 따라 내려간다.
  // (overflow-hidden 이라 사용자 스크롤은 없고 scrollTop 프로그래밍 제어만)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setScrolled(el.scrollTop > 1); // 실제로 잘렸을 때만 상단 페이드 표시
  }, [shownCount, typingRole]);

  // 메트릭 — 확정된 지원자 답변 수에 연동
  const answers = shown.filter((m) => m.role === "user").length;
  const progress = reduced
    ? 100
    : Math.min(100, Math.round(12 + (answers / TOTAL_ANSWERS) * 88));
  const remainMin = Math.max(1, Math.round(8 * (1 - progress / 100)));

  return (
    <div className="relative w-full max-w-md mx-auto">
      {/* glow */}
      <div
        aria-hidden
        className="absolute -inset-6 -z-10 rounded-3xl bg-accent/30 blur-2xl opacity-60"
      />

      <div className="rounded-2xl bg-card border border-border-default shadow-lg overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-surface-alt/50">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-surface" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-xs font-semibold text-ink">
                Intervia 면접관
              </div>
              <div className="text-[10px] text-ink-soft">서비스 소개 면접</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-semibold text-primary tracking-wider">
              LIVE
            </span>
          </div>
        </div>

        {/* 메시지 — 고정 높이, 위에서 시작해 아래로 쌓이고, 넘치면 자동 스크롤 */}
        <div className="relative bg-surface h-[300px] overflow-hidden">
          {/* 상단 페이드 마스크 — 위로 잘려 사라지는 메시지를 부드럽게(넘칠 때만) */}
          <div
            aria-hidden
            className={`absolute top-0 inset-x-0 h-10 bg-gradient-to-b from-surface to-transparent z-10 pointer-events-none transition-opacity duration-300 ${scrolled ? "opacity-100" : "opacity-0"}`}
          />
          <div
            ref={scrollRef}
            className="absolute inset-0 p-4 flex flex-col gap-3 overflow-hidden"
          >
            {shown.map((m, i) => (
              <Bubble key={i} role={m.role} animate={!reduced}>
                {m.text}
              </Bubble>
            ))}
            {typingRole && <TypingBubble role={typingRole} />}
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-4 py-2.5 border-t border-border-default bg-surface-alt/50 flex items-center justify-between">
          <span className="text-[10px] text-ink-muted tabular-nums">
            진행률 {progress}% · 남은 시간 {remainMin}분
          </span>
          <div className="w-24 h-1 bg-border-default rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  role,
  animate,
  children,
}: {
  role: "ai" | "user";
  animate: boolean;
  children: React.ReactNode;
}) {
  const cls = animate ? "chat-bubble-in" : "";
  if (role === "ai") {
    return (
      <div className={`flex items-end gap-2 ${cls}`}>
        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
          <Sparkles className="w-3 h-3 text-surface" strokeWidth={2.5} />
        </div>
        <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-bl-md bg-card border border-border-default">
          <p className="text-xs text-ink leading-relaxed">{children}</p>
        </div>
      </div>
    );
  }
  return (
    <div className={`flex items-end gap-2 justify-end ${cls}`}>
      <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-br-md bg-primary text-surface">
        <p className="text-xs leading-relaxed">{children}</p>
      </div>
      <div className="w-6 h-6 rounded-full bg-surface-alt border border-border-default flex items-center justify-center shrink-0">
        <User className="w-3 h-3 text-ink-soft" />
      </div>
    </div>
  );
}

function TypingBubble({ role }: { role: "ai" | "user" }) {
  const dots = (
    <div className="flex gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse" />
      <span
        className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse"
        style={{ animationDelay: "0.2s" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-pulse"
        style={{ animationDelay: "0.4s" }}
      />
    </div>
  );
  if (role === "ai") {
    return (
      <div className="flex items-end gap-2 chat-bubble-in">
        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
          <Sparkles className="w-3 h-3 text-surface" strokeWidth={2.5} />
        </div>
        <div className="px-3 py-2.5 rounded-2xl rounded-bl-md bg-card border border-border-default">
          {dots}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2 justify-end chat-bubble-in">
      <div className="px-3 py-2.5 rounded-2xl rounded-br-md bg-card border border-border-default">
        {dots}
      </div>
      <div className="w-6 h-6 rounded-full bg-surface-alt border border-border-default flex items-center justify-center shrink-0">
        <User className="w-3 h-3 text-ink-soft" />
      </div>
    </div>
  );
}

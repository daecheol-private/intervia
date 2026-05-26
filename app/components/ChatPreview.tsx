/**
 * Hero 우측에 들어가는 AI 면접 채팅 미리보기 — 정적 React 컴포넌트 (실제 면접 UI 흉내).
 * Stripe·Linear 식의 "제품이 직접 보이는" 어필. 스크린샷 X, 토큰만 사용.
 */
import { Sparkles, User } from "lucide-react";

export function ChatPreview() {
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
              <div className="text-[10px] text-ink-soft">백엔드 개발자 · 20분</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] text-ink-soft tabular-nums">12:38</span>
          </div>
        </div>

        {/* 메시지 */}
        <div className="p-4 space-y-3 bg-surface min-h-[280px]">
          {/* AI */}
          <Bubble role="ai">
            안녕하세요. 먼저 본인 소개와 가장 의미 있었던 프로젝트
            한 가지만 짧게 부탁드립니다.
          </Bubble>

          {/* User */}
          <Bubble role="user">
            안녕하세요. 5년 차 백엔드 개발자입니다. 가장 의미 있던 건
            결제 시스템 마이그레이션이었습니다. 일 30만건 트랜잭션을
            무중단으로...
          </Bubble>

          {/* AI follow-up */}
          <Bubble role="ai">
            그 마이그레이션에서 가장 큰 기술적 도전은 무엇이었고,
            어떻게 해결하셨나요?
          </Bubble>

          {/* Typing */}
          <div className="flex items-end gap-2">
            <div className="w-6 h-6 rounded-full bg-surface-alt border border-border-default flex items-center justify-center shrink-0">
              <User className="w-3 h-3 text-ink-soft" />
            </div>
            <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-card border border-border-default">
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
            </div>
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-4 py-2.5 border-t border-border-default bg-surface-alt/50 flex items-center justify-between">
          <span className="text-[10px] text-ink-muted">
            진행률 60% · 남은 시간 8분
          </span>
          <div className="w-24 h-1 bg-border-default rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: "60%" }} />
          </div>
        </div>
      </div>

      {/* 떠 있는 평가 카드 */}
      <div className="absolute -bottom-6 -left-4 rounded-xl bg-ink text-surface px-3 py-2.5 shadow-lg flex items-center gap-2.5">
        <div className="text-[10px] uppercase tracking-wider text-accent font-semibold">
          실시간 평가
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold tabular-nums">4.6</span>
          <span className="text-[10px] opacity-70">/ 5.0</span>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  role,
  children,
}: {
  role: "ai" | "user";
  children: React.ReactNode;
}) {
  if (role === "ai") {
    return (
      <div className="flex items-end gap-2">
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
    <div className="flex items-end gap-2 justify-end">
      <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-br-md bg-primary text-surface">
        <p className="text-xs leading-relaxed">{children}</p>
      </div>
      <div className="w-6 h-6 rounded-full bg-surface-alt border border-border-default flex items-center justify-center shrink-0">
        <User className="w-3 h-3 text-ink-soft" />
      </div>
    </div>
  );
}

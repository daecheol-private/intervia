"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useVoiceInput } from "./use-voice-input";
import { LogoMark } from "@/app/components/Logo";

type Message = { role: "user" | "model"; content: string };

type ConsentItem = {
  key: string;
  required: boolean;
  title: string;
  description: string;
  legalBasis: string;
};

type SessionInfo = {
  session: {
    id: number;
    status: "pending" | "in_progress" | "completed" | "expired";
    messages: Message[];
  };
  candidate: { id: number; name: string };
  job: {
    id: number;
    title: string;
    position: string;
    level: string;
    employmentType: string;
    tone: string;
    interviewDurationMinutes?: number;
  };
  expired: boolean;
  consentRequired?: boolean;
  consentVersion?: string;
  consentItems?: ConsentItem[];
};

export default function InterviewPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ended, setEnded] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  // LLM 보조 신호 탐지용 — 현재 입력 turn 동안 누적 (sendMessage 후 리셋)
  const turnSignals = useRef<{
    pasteCount: number;
    pastedChars: number;
    typedChars: number;
    firstInputAt: number | null;
    lastPasteAt: number | null;
  }>({
    pasteCount: 0,
    pastedChars: 0,
    typedChars: 0,
    firstInputAt: null,
    lastPasteAt: null,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initRef = useRef(false);

  useEffect(() => {
    void fetch(`/api/interview/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          setError(await r.text());
          return null;
        }
        return r.json() as Promise<SessionInfo>;
      })
      .then((d) => {
        if (!d) return;
        setInfo(d);
        setMessages(d.session.messages);
        if (d.session.status === "completed") {
          setEnded(true);
        }
      });
  }, [token]);

  useEffect(() => {
    if (
      info &&
      !info.consentRequired &&
      !ended &&
      messages.length === 0 &&
      !initRef.current
    ) {
      initRef.current = true;
      void sendMessage("면접을 시작해주세요.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, ended, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  async function sendMessage(text: string) {
    setStreaming(true);
    const userMsg: Message = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);

    const sig = turnSignals.current;
    const inputSignals = {
      pasteCount: sig.pasteCount,
      pastedChars: sig.pastedChars,
      typedChars: sig.typedChars,
      msFromFirstInput: sig.firstInputAt
        ? Date.now() - sig.firstInputAt
        : null,
      msSinceLastPaste: sig.lastPasteAt
        ? Date.now() - sig.lastPasteAt
        : null,
    };
    // 리셋
    turnSignals.current = {
      pasteCount: 0,
      pastedChars: 0,
      typedChars: 0,
      firstInputAt: null,
      lastPasteAt: null,
    };

    try {
      const res = await fetch(`/api/interview/${token}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMessage: text, inputSignals }),
      });
      if (!res.ok || !res.body) {
        const err = await res.text();
        setMessages([...next, { role: "model", content: `⚠️ ${err}` }]);
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      setMessages([...next, { role: "model", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "model", content: acc }]);
      }
      if (acc.includes("[INTERVIEW_END]")) {
        setEnded(true);
        void finalizeSilently();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages([...next, { role: "model", content: `⚠️ ${msg}` }]);
    } finally {
      setStreaming(false);
    }
  }

  const handleSend = () => {
    const t = input.trim();
    if (!t || streaming || ended) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "";
    void sendMessage(t);
  };

  // 음성 입력 — 인식된 텍스트는 input 에 누적, 사용자가 검토 후 전송 버튼으로 전송
  const voice = useVoiceInput({
    lang: "ko-KR",
    onFinalText: (t) => setInput((prev) => (prev ? prev + " " + t : t)),
  });
  const toggleVoice = () => {
    if (voice.listening) voice.stop();
    else voice.start();
  };

  const finalizeSilently = async () => {
    try {
      await fetch(`/api/interview/${token}/complete`, { method: "POST" });
    } catch {
      // 후보자에게는 노출하지 않음
    }
  };

  const finalize = async () => {
    if (messages.length < 2) {
      alert("대화가 너무 짧습니다. 답변을 더 진행해 주세요.");
      return;
    }
    if (!confirm("면접을 종료하시겠습니까?")) return;
    setFinalizing(true);
    setEnded(true);
    await finalizeSilently();
    setFinalizing(false);
  };

  if (error) {
    return (
      <CenteredCard>
        <div className="text-3xl mb-3">🚫</div>
        <h1 className="text-xl font-bold text-slate-900">접속 불가</h1>
        <p className="text-slate-600 mt-2">{error}</p>
      </CenteredCard>
    );
  }

  if (!info)
    return (
      <main className="p-6 text-slate-500 text-center mt-20">불러오는 중...</main>
    );

  if (info.expired) {
    return (
      <CenteredCard>
        <div className="text-3xl mb-3">⏱️</div>
        <h1 className="text-xl font-bold text-slate-900">만료된 링크입니다</h1>
        <p className="text-slate-600 mt-2">담당자에게 새 링크를 요청하세요.</p>
      </CenteredCard>
    );
  }

  if (info.consentRequired && info.consentItems) {
    return (
      <ConsentGate
        token={token}
        candidateName={info.candidate.name}
        jobTitle={info.job.title}
        items={info.consentItems}
        onAccepted={() => {
          setInfo({ ...info, consentRequired: false });
        }}
      />
    );
  }

  return (
    <main
      className="max-w-3xl mx-auto w-full px-3 sm:px-4 py-3 sm:py-6 flex flex-col overflow-hidden"
      style={{ height: "100dvh" }}
    >
      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 mb-3 sm:mb-4 shadow-sm shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-bold text-slate-900 truncate text-sm sm:text-base">
              {info.job.title}
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 truncate">
              {info.job.position} · {info.job.level} · {info.job.employmentType}
              {info.job.interviewDurationMinutes
                ? ` · 약 ${info.job.interviewDurationMinutes}분`
                : ""}
            </p>
          </div>
          {!ended && (
            <button
              onClick={finalize}
              disabled={finalizing || messages.length < 2}
              aria-label="면접 종료"
              className="shrink-0 px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs sm:text-sm text-slate-700 disabled:opacity-40 min-h-[36px]"
            >
              면접 종료
            </button>
          )}
        </div>

        {!ended && (
          <ProgressBar
            userTurns={messages.filter((m) => m.role === "user").length}
            durationMinutes={info.job.interviewDurationMinutes ?? 20}
          />
        )}
      </div>

      {/* Chat container */}
      <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm min-h-0 overflow-hidden">
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-label="면접 대화"
          className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 sm:space-y-4 bg-gradient-to-b from-slate-50/50 to-white"
        >
          {messages
            .filter((m, i) => !(i === 0 && m.role === "user"))
            .map((m, i) => (
              <ChatBubble
                key={i}
                role={m.role}
                content={m.content.replace("[INTERVIEW_END]", "")}
              />
            ))}
          {streaming && messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start" aria-label="응답 생성 중">
              <div className="bg-slate-100 rounded-2xl px-4 py-3">
                <TypingDots />
              </div>
            </div>
          )}
        </div>

        {!ended && (
          <div
            className="border-t border-slate-200 p-2 sm:p-3 bg-white"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          >
            {/* 음성 인식 중간 텍스트 — input 위에 미리보기 */}
            {voice.listening && (
              <div className="mb-2 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                </span>
                <span className="font-medium">듣는 중</span>
                {voice.interim && (
                  <span className="text-slate-600 truncate italic">
                    {voice.interim}
                  </span>
                )}
              </div>
            )}
            {voice.error && (
              <div className="mb-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {voice.error}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                aria-label="답변 입력"
                className="flex-1 border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent min-h-[44px] max-h-[120px]"
                rows={1}
                placeholder={voice.listening ? "말씀하세요 — 인식된 내용이 여기에 채워집니다" : "답변을 입력하거나 마이크 버튼을 누르세요"}
                value={input}
                onChange={(e) => {
                  // LLM 보조 신호 — paste 가 아닌 일반 변경은 typedChars 누적
                  const prev = input.length;
                  const nextLen = e.target.value.length;
                  const sig = turnSignals.current;
                  if (sig.firstInputAt == null) sig.firstInputAt = Date.now();
                  if (nextLen > prev) sig.typedChars += nextLen - prev;
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height =
                    Math.min(120, e.target.scrollHeight) + "px";
                }}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text") ?? "";
                  if (!pasted) return;
                  const sig = turnSignals.current;
                  if (sig.firstInputAt == null) sig.firstInputAt = Date.now();
                  sig.pasteCount += 1;
                  sig.pastedChars += pasted.length;
                  sig.lastPasteAt = Date.now();
                  // typedChars 카운트 중복 방지 — onChange 가 곧 paste 분량을 typedChars 로
                  // 잡지 않도록 보정 (paste 직후 nextLen-prev 만큼은 paste 였음)
                  sig.typedChars = Math.max(0, sig.typedChars - pasted.length);
                }}
                onKeyDown={(e) => {
                  const isMobile =
                    typeof window !== "undefined" &&
                    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
                  if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={streaming}
              />
              {voice.supported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  // 정지는 streaming 중에도 가능해야 함 — start 만 streaming 중 차단.
                  disabled={!voice.listening && streaming}
                  aria-label={voice.listening ? "음성 입력 정지" : "음성 입력 시작"}
                  title={voice.listening ? "정지" : "음성으로 답변하기"}
                  className={
                    "rounded-xl text-sm font-medium shadow-sm min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors " +
                    (voice.listening
                      ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300")
                  }
                >
                  {voice.listening ? (
                    // 정지 아이콘
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                  ) : (
                    // 마이크 아이콘
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0" />
                      <line x1="12" y1="18" x2="12" y2="22" />
                      <line x1="8" y1="22" x2="16" y2="22" />
                    </svg>
                  )}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={streaming || !input.trim()}
                aria-label="전송"
                className="bg-primary hover:bg-primary-deep active:bg-primary-deep text-white px-4 sm:px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 shadow-sm min-h-[44px] min-w-[60px]"
              >
                전송
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 hidden sm:block">
              Enter = 전송, Shift+Enter = 줄바꿈
              {voice.supported && " · 🎙 마이크로 음성 입력 가능 (Chrome·Edge·Safari)"}
            </p>
          </div>
        )}
      </div>

      {ended && (
        <div className="mt-4 bg-gradient-to-br from-primary-soft to-accent-soft/40 border border-primary/30 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-bold text-slate-900">
            면접이 종료되었습니다
          </h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            소중한 시간 내어 면접에 응해 주셔서 감사합니다.
            <br />
            평가 결과는 채용 담당자에게만 전달되며, 별도로 안내드릴 예정입니다.
          </p>
          <p className="text-xs text-slate-400 mt-4">
            이 창은 안전하게 닫으셔도 됩니다.
          </p>
          <div className="mt-5 pt-5 border-t border-primary/30 text-xs text-slate-600 space-y-1">
            <div>
              <a
                href={`/interview/${token}/me`}
                className="text-primary-deep underline hover:text-primary-deep"
              >
                내 정보 열람·삭제 (PIPA §35·36)
              </a>
            </div>
            <div>
              <a
                href={`/interview/${token}/appeal`}
                className="text-primary-deep underline hover:text-primary-deep"
              >
                자동화 의사결정 이의제기 (PIPA §37의2)
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ChatBubble({
  role,
  content,
}: {
  role: "user" | "model";
  content: string;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end" role="article" aria-label="내 답변">
        <div className="max-w-[85%] sm:max-w-[80%] bg-primary text-white rounded-2xl rounded-br-md px-3.5 py-2.5 text-[15px] sm:text-sm leading-relaxed whitespace-pre-wrap shadow-sm break-words">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-2" role="article" aria-label="면접관 질문">
      <LogoMark size={32} className="shrink-0 rounded-full" />
      <div className="max-w-[85%] sm:max-w-[80%] bg-slate-100 text-slate-900 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[15px] sm:text-sm leading-relaxed whitespace-pre-wrap break-words">
        {content ? <InlineMd text={content} /> : <TypingDots />}
      </div>
    </div>
  );
}

/**
 * 매우 가벼운 인라인 마크다운 렌더. LLM 응답의 **굵게** / *기울임* / `code` 만 지원.
 * dangerouslySetInnerHTML 안 씀 — React 노드로 직접 토큰화하므로 XSS 안전.
 */
function InlineMd({ text }: { text: string }) {
  // **bold** → <strong>, *italic* → <em>, `code` → <code>. 우선순위: ** > * > `
  const tokens: React.ReactNode[] = [];
  const regex = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/g;
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) tokens.push(text.slice(lastIndex, m.index));
    if (m[2] != null) tokens.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] != null) tokens.push(<em key={key++}>{m[3]}</em>);
    else if (m[4] != null)
      tokens.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-slate-200 text-[0.9em]">
          {m[4]}
        </code>
      );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) tokens.push(text.slice(lastIndex));
  return <>{tokens}</>;
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 items-center">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
    </span>
  );
}

function expectedUserTurns(minutes: number): number {
  if (minutes <= 15) return 5;
  if (minutes <= 30) return 10;
  if (minutes <= 45) return 15;
  return 20;
}

function ProgressBar({
  userTurns,
  durationMinutes,
}: {
  userTurns: number;
  durationMinutes: number;
}) {
  const expected = expectedUserTurns(durationMinutes);
  // 첫 트리거 "면접을 시작해주세요" 도 user 턴으로 카운팅됨 — 1 빼서 보정
  const effective = Math.max(0, userTurns - 1);
  const pct = Math.min(100, Math.round((effective / expected) * 100));
  return (
    <div className="mt-3" aria-label={`면접 진행률 ${pct}%`}>
      <div className="flex justify-between items-center text-[10px] sm:text-xs text-slate-500 mb-1">
        <span>진행 {effective} / 약 {expected} 턴</span>
        <span>{pct}%</span>
      </div>
      <div
        className="h-1.5 bg-slate-100 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-gradient-to-r from-primary to-primary-deep transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center max-w-md shadow-sm">
        {children}
      </div>
    </main>
  );
}

function ConsentGate({
  token,
  candidateName,
  jobTitle,
  items,
  onAccepted,
}: {
  token: string;
  candidateName: string;
  jobTitle: string;
  items: ConsentItem[];
  onAccepted: () => void;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((i) => [i.key, false]))
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const allRequiredChecked = items
    .filter((i) => i.required)
    .every((i) => checks[i.key]);

  const submit = async () => {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/interview/${token}/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consents: checks }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    onAccepted();
  };

  return (
    <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col flex-1 min-h-0">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <header className="px-6 py-5 border-b border-slate-100 bg-gradient-to-br from-primary-soft to-primary-soft/60">
          <div className="text-xs text-slate-500 mb-1">{candidateName} 님</div>
          <h1 className="text-lg font-bold text-slate-900">
            {jobTitle} AI 면접 — 개인정보 처리 동의
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            면접을 진행하기 전, 개인정보 보호법(PIPA) 에 따라 아래 항목에
            동의해 주세요. 모든 <strong className="text-danger">필수</strong>{" "}
            항목에 동의해야 면접을 시작할 수 있습니다.
          </p>
        </header>

        <ul className="divide-y divide-slate-100">
          {items.map((it) => (
            <li key={it.key} className="px-6 py-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checks[it.key] ?? false}
                  onChange={(e) =>
                    setChecks({ ...checks, [it.key]: e.target.checked })
                  }
                  className="mt-1 w-4 h-4 rounded border-slate-300"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-900">
                      {it.title}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        it.required
                          ? "bg-danger-soft text-danger"
                          : "bg-surface-alt text-ink-soft"
                      }`}
                    >
                      {it.required ? "필수" : "선택"}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {it.legalBasis}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {it.description}
                  </p>
                </div>
              </label>
            </li>
          ))}
        </ul>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50">
          <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
            동의 거부 시 면접 절차에 참여할 수 없습니다. 자동화 의사결정 결과에
            대해서는 본인 식별 후 설명 요청 및 이의제기 권리가 있습니다 (PIPA
            §37의2). 자세한 사항은 채용 담당자 또는{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-deep underline hover:text-primary-deep"
            >
              개인정보 처리방침
            </a>
            을 확인하세요.
          </p>
          {err && (
            <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-3">
              {err}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={!allRequiredChecked || busy}
              className="flex-1 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "처리 중..." : "동의하고 면접 시작"}
            </button>
            <button
              onClick={() => window.close()}
              className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm"
            >
              거부
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

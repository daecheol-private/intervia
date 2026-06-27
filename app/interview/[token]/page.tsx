"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useVoiceInput } from "./use-voice-input";
import { LogoMark, Logo } from "@/app/components/Logo";
import { MicHelpModal } from "@/app/components/MicHelpModal";
import { t, normalizeLang, type Lang } from "@/lib/i18n/interview";

type Message = { role: "user" | "model"; content: string };

// 탭/창 이탈 집계 기준 — 이 시간(ms) 이상 페이지를 실제로 벗어나 있었을 때만 '이탈 1회'로 센다.
// 모바일 키보드 토글·알림 배너·인앱 브라우저(카카오톡 등) 포커스 변화처럼 답변 도중 흔히
// 발생하는 짧은 깜빡임을 외부 도구 참조로 오인하지 않기 위함. (이 신호는 단독으로는
// 'LLM 보조 의심' 판정에 쓰지 않고, 사람 검토자용 참고 정황으로만 쓰인다 — lib/interview-signals.ts)
const BLUR_MIN_AWAY_MS = 10_000;

type ConsentItem = {
  key: string;
  kind: "consent" | "notice";
  required: boolean;
  title: string;
  summary: string;
  description: string;
  legalBasis: string;
};

type PersonalityInfo = {
  required: boolean;
  /** 강제선택형 — 문항당 진술 2개 중 더 나에 가까운 쪽 선택 */
  items?: Array<{ id: string; a: string; b: string }>;
};

type McqInfo = {
  required: boolean;
  /** 4지선다 — 문항당 보기 4개 중 정답 1개 선택 (정답은 비노출) */
  items?: Array<{ id: string; question: string; options: string[] }>;
  /** 영어 면접: 번역 캐시가 아직 없어 백그라운드 번역 중 — 폴링으로 대기 */
  translating?: boolean;
};

type SessionInfo = {
  session: {
    id: number;
    status: "pending" | "in_progress" | "completed" | "expired";
    messages: Message[];
    startedAt?: string | null;
  };
  candidate: { id: number; name: string };
  /** 후보자 화면 맥락 표시용 회사명 (legacy 공고는 orgId 없어 null 가능) */
  organization?: { name: string } | null;
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
  withdrawn?: boolean;
  terminated?: boolean;
  superseded?: boolean;
  /** 면접 진행 언어 — 지원자가 시작 화면에서 고른 값. 동의 항목도 이 언어로 내려온다. */
  language?: Lang;
  consentRequired?: boolean;
  consentVersion?: string;
  consentItems?: ConsentItem[];
  personality?: PersonalityInfo;
  mcq?: McqInfo;
  /** 면접 전체 단계 구성 — required 와 무관하게 이 면접에 어떤 단계가 있는지 (프로그레스 표시용) */
  flow?: { hasPersonality: boolean; hasMcq: boolean };
};

/** 면접 진행 단계 — 동의는 단계에 포함하지 않음(전제). 인성·객관식은 공고 설정에 따라 가변. */
type StepKey = "personality" | "mcq" | "interview";
type Step = { key: StepKey; label: string };

/**
 * 이 면접의 진행 단계 목록을 만든다. flow(서버가 항상 내려줌) 우선,
 * 없으면 required 플래그로 fallback (채팅 시작 전 화면에서만 정확).
 */
function buildSteps(info: SessionInfo, lang: Lang): Step[] {
  const hasPersonality =
    info.flow?.hasPersonality ?? !!info.personality?.required;
  const hasMcq = info.flow?.hasMcq ?? !!info.mcq?.required;
  const steps: Step[] = [];
  if (hasPersonality)
    steps.push({ key: "personality", label: t(lang, "step.personality") });
  if (hasMcq) steps.push({ key: "mcq", label: t(lang, "step.mcq") });
  steps.push({ key: "interview", label: t(lang, "step.interview") });
  return steps;
}

export default function InterviewPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [info, setInfo] = useState<SessionInfo | null>(null);
  // 면접 진행 언어 — info fetch 로 서버값 반영, 언어 게이트에서 확정.
  const [lang, setLang] = useState<Lang>("ko");
  const [langChosen, setLangChosen] = useState(false);
  const [error, setError] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ended, setEnded] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [micHelp, setMicHelp] = useState(false);
  // 전체 타이머 fallback — 첫 메시지 전송 시점을 클라이언트가 기록.
  // (서버 startedAt 은 첫 chat 호출 때 기록되지만 info 를 재요청하지 않아 클라이언트엔 null 로 남음.
  //  새로고침 시엔 info 재로드로 서버 startedAt 이 채워져 그쪽이 우선.)
  const [clientStartedAt, setClientStartedAt] = useState<string | null>(null);
  // LLM 보조 신호 탐지용 — 현재 입력 turn 동안 누적 (sendMessage 후 리셋)
  const turnSignals = useRef<{
    pasteCount: number;
    pastedChars: number;
    typedChars: number;
    firstInputAt: number | null;
    lastPasteAt: number | null;
    blurCount: number;
    copyAttempts: number;
  }>({
    pasteCount: 0,
    pastedChars: 0,
    typedChars: 0,
    firstInputAt: null,
    lastPasteAt: null,
    blurCount: 0,
    copyAttempts: 0,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initRef = useRef(false);
  // 페이지가 hidden 으로 바뀐 시각 — visible 복귀 시 이탈 지속시간 계산용.
  const hiddenAtRef = useRef<number | null>(null);

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
        setLang(normalizeLang(d.language));
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
      !info.personality?.required &&
      !info.mcq?.required &&
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

  // LLM 보조 신호 — 답변 중 탭 전환·창 이탈(다른 앱/창으로 이동) 횟수 집계.
  // 면접 종료 후엔 무의미하므로 ended 면 미부착. turn 단위로 sendMessage 에서 리셋됨.
  // 짧은 깜빡임(모바일 키보드 토글·알림·인앱 브라우저 포커스 변화)은 오탐이므로,
  // hidden 지속시간이 BLUR_MIN_AWAY_MS 이상일 때만 '이탈 1회'로 센다.
  useEffect(() => {
    if (ended) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
      } else if (hiddenAtRef.current != null) {
        const awayMs = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (awayMs >= BLUR_MIN_AWAY_MS) turnSignals.current.blurCount += 1;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [ended]);

  async function sendMessage(text: string) {
    setStreaming(true);
    // 첫 전송 = 면접 시작 → 전체 타이머 기준점 기록 (서버 startedAt 부재 시 fallback).
    setClientStartedAt((prev) => prev ?? new Date().toISOString());
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
      blurCount: sig.blurCount,
      copyAttempts: sig.copyAttempts,
    };
    // 리셋
    turnSignals.current = {
      pasteCount: 0,
      pastedChars: 0,
      typedChars: 0,
      firstInputAt: null,
      lastPasteAt: null,
      blurCount: 0,
      copyAttempts: 0,
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
      // 청크마다 setState 하면 메시지 누적 시 전체 버블 리렌더가 초당 수십 회 —
      // 80ms 스로틀로 묶고 종료 후 1회 최종 반영 (저사양 모바일 입력 끊김 방지).
      let lastFlush = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const now = Date.now();
        if (now - lastFlush >= 80) {
          lastFlush = now;
          setMessages([...next, { role: "model", content: acc }]);
        }
      }
      setMessages([...next, { role: "model", content: acc }]);
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
    lang: lang === "en" ? "en-US" : "ko-KR",
    onFinalText: (txt) => setInput((prev) => (prev ? prev + " " + txt : txt)),
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
      alert(t(lang, "interview.tooShort"));
      return;
    }
    if (!confirm(t(lang, "interview.confirmEnd"))) return;
    setFinalizing(true);
    setEnded(true);
    await finalizeSilently();
    setFinalizing(false);
  };

  if (error) {
    return (
      <CenteredCard>
        <div className="text-3xl mb-3">🚫</div>
        <h1 className="text-xl font-bold text-ink">{t(lang, "gate.error.title")}</h1>
        <p className="text-ink-soft mt-2">{error}</p>
      </CenteredCard>
    );
  }

  if (!info)
    return (
      <main className="p-6 text-ink-muted text-center mt-20">
        {t(lang, "gate.loading")}
      </main>
    );

  // 이 면접의 진행 단계(인성/객관식/면접) — 동의 화면·게이트·면접 헤더의 프로그레스 표시에 공유.
  const steps = buildSteps(info, lang);

  // 지원취소된 후보 — 토큰이 살아있어도 재진입 시 동의 화면 대신 안내.
  if (info.withdrawn) {
    return (
      <CenteredCard>
        <div className="text-3xl mb-3">🗑️</div>
        <h1 className="text-xl font-bold text-ink">
          {t(lang, "gate.withdrawn.title")}
        </h1>
        <p className="text-ink-soft mt-2 leading-relaxed">
          {t(lang, "gate.withdrawn.body")}
          <br />
          {t(lang, "gate.withdrawn.thanks")}
        </p>
      </CenteredCard>
    );
  }

  // 그 외 종결(합격·불합격 등) 후보 — 면접 재진입 차단.
  if (info.terminated) {
    return (
      <CenteredCard>
        <div className="text-3xl mb-3">✅</div>
        <h1 className="text-xl font-bold text-ink">
          {t(lang, "gate.terminated.title")}
        </h1>
        <p className="text-ink-soft mt-2 leading-relaxed">
          {t(lang, "gate.terminated.body")}
        </p>
      </CenteredCard>
    );
  }

  // 종결은 아니지만 다음 전형으로 진행되어 이 AI 면접 링크가 무효화된 경우.
  if (info.superseded) {
    return (
      <CenteredCard>
        <div className="text-3xl mb-3">➡️</div>
        <h1 className="text-xl font-bold text-ink">
          {t(lang, "gate.superseded.title")}
        </h1>
        <p className="text-ink-soft mt-2 leading-relaxed">
          {t(lang, "gate.superseded.body")}
        </p>
      </CenteredCard>
    );
  }

  if (info.expired) {
    return (
      <CenteredCard>
        <div className="text-3xl mb-3">⏱️</div>
        <h1 className="text-xl font-bold text-ink">
          {t(lang, "gate.expired.title")}
        </h1>
        <p className="text-ink-soft mt-2">{t(lang, "gate.expired.body")}</p>
      </CenteredCard>
    );
  }

  // 언어 선택 게이트 — 동의가 필요한(아직 시작 전) 세션에서, 언어를 아직 안 골랐으면
  // 동의 화면 앞에 한/영 선택을 먼저 받는다. 선택 후 동의 항목을 그 언어로 다시 받아온다.
  if (info.consentRequired && !langChosen) {
    return (
      <LanguageGate
        token={token}
        current={info}
        onChoose={(d) => {
          setInfo(d);
          setLang(normalizeLang(d.language));
          setLangChosen(true);
        }}
      />
    );
  }

  if (info.consentRequired && info.consentItems) {
    return (
      <ConsentGate
        token={token}
        lang={lang}
        candidateName={info.candidate.name}
        orgName={info.organization?.name ?? null}
        jobTitle={info.job.title}
        items={info.consentItems}
        steps={steps}
        onAccepted={() => {
          setInfo({ ...info, consentRequired: false });
        }}
      />
    );
  }

  // 인성검사 단계 — 동의 후 · 채팅 시작 전. 완료 시 다음 단계(객관식 또는 면접)로.
  if (!ended && info.personality?.required && info.personality.items) {
    return (
      <PersonalityGate
        token={token}
        lang={lang}
        orgName={info.organization?.name ?? null}
        jobTitle={info.job.title}
        items={info.personality.items}
        steps={steps}
        onDone={() => {
          setInfo({ ...info, personality: { required: false } });
        }}
      />
    );
  }

  // 객관식 사전 문항 단계 — 인성검사 후 · 채팅 시작 전. 완료 시 면접 자동 시작.
  // 영어 면접: 객관식 번역이 아직 준비 중이면 잠깐 폴링 대기(대부분 동의·인성검사 중에 끝남).
  if (!ended && info.mcq?.required && info.mcq.translating && !info.mcq.items) {
    return (
      <McqPreparing token={token} lang={lang} onReady={(d) => setInfo(d)} />
    );
  }

  if (!ended && info.mcq?.required && info.mcq.items) {
    return (
      <McqGate
        token={token}
        lang={lang}
        orgName={info.organization?.name ?? null}
        jobTitle={info.job.title}
        items={info.mcq.items}
        steps={steps}
        onDone={() => {
          setInfo({ ...info, mcq: { required: false } });
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
      <div className="bg-card border border-border-default rounded-2xl p-3 sm:p-4 mb-3 sm:mb-4 shadow-sm shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <LogoMark size={36} className="shrink-0" />
            <div className="min-w-0">
            {info.organization?.name ? (
              <>
                <h1 className="font-bold text-ink truncate text-lg sm:text-xl leading-tight">
                  {info.organization.name}
                </h1>
                <p className="text-xs sm:text-sm font-medium text-ink-soft truncate leading-tight mt-0.5">
                  {info.job.title}
                </p>
              </>
            ) : (
              <h1 className="font-bold text-ink truncate text-base sm:text-lg leading-tight">
                {info.job.title}
              </h1>
            )}
            <p className="text-[11px] sm:text-xs text-ink-muted mt-0.5 truncate">
              {info.job.position} · {info.job.level} · {info.job.employmentType}
              {info.job.interviewDurationMinutes
                ? ` · ${t(lang, "interview.approxMinutes", { minutes: info.job.interviewDurationMinutes })}`
                : ""}
            </p>
            </div>
          </div>
          {!ended && (
            <button
              onClick={finalize}
              disabled={finalizing || messages.length < 2}
              aria-label={t(lang, "interview.end")}
              className="shrink-0 px-3 py-2 rounded-lg border border-border-strong hover:bg-surface-alt text-xs sm:text-sm text-ink-soft disabled:opacity-40 min-h-[36px]"
            >
              {t(lang, "interview.end")}
            </button>
          )}
        </div>

        {!ended && steps.length > 1 && (
          <div className="mt-3 pt-3 border-t border-border-default">
            <StepProgress steps={steps} current="interview" lang={lang} />
          </div>
        )}

        {!ended && (
          <Timer
            startedAt={info.session.startedAt ?? clientStartedAt}
            messages={messages}
            streaming={streaming}
            lang={lang}
          />
        )}
        {/* 막힌 후보자가 종료 화면에 도달하지 못해도 쓸 수 있는 상시 신고 채널 */}
        <div className="mt-2 text-right">
          <a
            href={`/interview/${token}/inquiry`}
            className="text-[11px] text-ink-muted hover:text-ink-soft underline"
          >
            {t(lang, "interview.report")}
          </a>
        </div>
      </div>

      {/* Chat container */}
      <div className="flex-1 flex flex-col bg-card border border-border-default rounded-2xl shadow-sm min-h-0 overflow-hidden">
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-label={t(lang, "interview.chatLogAria")}
          className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 sm:space-y-4 bg-gradient-to-b from-surface-alt/50 to-card"
          // 복사 방지 — 질문을 외부 LLM 으로 옮기는 행위 억제 + 시도 횟수 기록.
          // 차단해도 스크린샷 등 우회는 가능 → 억제·신호 수집 목적.
          onCopy={(e) => {
            e.preventDefault();
            turnSignals.current.copyAttempts += 1;
          }}
          onCut={(e) => {
            e.preventDefault();
            turnSignals.current.copyAttempts += 1;
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {messages
            .filter((m, i) => !(i === 0 && m.role === "user"))
            .map((m, i) => (
              <ChatBubble
                key={i}
                role={m.role}
                content={m.content.replace("[INTERVIEW_END]", "")}
                lang={lang}
              />
            ))}
          {streaming && messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start" aria-label={t(lang, "interview.generating")}>
              <div className="bg-slate-100 rounded-2xl px-4 py-3">
                <TypingDots />
              </div>
            </div>
          )}
        </div>

        {!ended && (
          <div
            className="border-t border-border-default p-2 sm:p-3 bg-card"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          >
            {/* 음성 인식 중간 텍스트 — input 위에 미리보기 */}
            {voice.listening && (
              <div className="mb-2 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                </span>
                <span className="font-medium">{t(lang, "interview.listening")}</span>
                {voice.interim && (
                  <span className="text-ink-soft truncate italic">
                    {voice.interim}
                  </span>
                )}
              </div>
            )}
            {voice.error && (
              <div className="mb-2 flex items-start justify-between gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                <span className="leading-relaxed">{voice.error}</span>
                <button
                  type="button"
                  onClick={() => setMicHelp(true)}
                  className="shrink-0 underline font-medium hover:text-rose-900"
                >
                  {t(lang, "interview.settingsHow")}
                </button>
              </div>
            )}
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                aria-label={t(lang, "interview.answerAria")}
                className="flex-1 border border-border-strong rounded-xl px-3 py-2.5 text-base sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent min-h-[44px] max-h-[120px]"
                rows={1}
                placeholder={voice.listening ? t(lang, "interview.inputPlaceholderListening") : t(lang, "interview.inputPlaceholder")}
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
                  aria-label={voice.listening ? t(lang, "interview.voiceStop") : t(lang, "interview.voiceStart")}
                  title={voice.listening ? t(lang, "interview.voiceStopTitle") : t(lang, "interview.voiceStartTitle")}
                  className={
                    "rounded-xl text-sm font-medium shadow-sm min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors " +
                    (voice.listening
                      ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                      : "bg-surface-alt hover:bg-slate-200 text-ink-soft border border-border-strong")
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
                aria-label={t(lang, "interview.send")}
                className="bg-primary hover:bg-primary-deep active:bg-primary-deep text-surface px-4 sm:px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 shadow-sm min-h-[44px] min-w-[60px]"
              >
                {t(lang, "interview.send")}
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-[10px] text-ink-muted hidden sm:block">
                {t(lang, "interview.enterHint")}
                {voice.supported && t(lang, "interview.micHint")}
              </p>
              {voice.supported && (
                <button
                  type="button"
                  onClick={() => setMicHelp(true)}
                  className="text-[11px] text-ink-muted hover:text-primary-deep underline shrink-0"
                >
                  {t(lang, "interview.micTrouble")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {ended && (
        <div className="mt-4 bg-gradient-to-br from-primary-soft to-accent-soft/40 border border-primary/30 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-bold text-ink">
            {t(lang, "interview.ended.title")}
          </h2>
          <p className="text-sm text-ink-soft mt-2 leading-relaxed">
            {t(lang, "interview.ended.thanks")}
            <br />
            {t(lang, "interview.ended.resultNote")}
          </p>
          <p className="text-xs text-ink-muted mt-4">
            {t(lang, "interview.ended.closeWindow")}
          </p>
          <div className="mt-5 pt-5 border-t border-primary/30 text-xs text-ink-soft space-y-1">
            <div>
              <a
                href={`/interview/${token}/me`}
                className="text-primary-deep underline hover:text-primary-deep"
              >
                {t(lang, "interview.ended.myInfo")}
              </a>
            </div>
            <div>
              <a
                href={`/interview/${token}/appeal`}
                className="text-primary-deep underline hover:text-primary-deep"
              >
                {t(lang, "interview.ended.appeal")}
              </a>
            </div>
          </div>
        </div>
      )}

      <MicHelpModal open={micHelp} onClose={() => setMicHelp(false)} />
    </main>
  );
}

function ChatBubble({
  role,
  content,
  lang,
}: {
  role: "user" | "model";
  content: string;
  lang: Lang;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end" role="article" aria-label={t(lang, "interview.bubble.mine")}>
        <div className="max-w-[85%] sm:max-w-[80%] bg-primary text-surface rounded-2xl rounded-br-md px-3.5 py-2.5 text-[15px] sm:text-sm leading-relaxed whitespace-pre-wrap shadow-sm break-words">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-2" role="article" aria-label={t(lang, "interview.bubble.interviewer")}>
      <LogoMark size={32} className="shrink-0 rounded-full" />
      {/* select-none — 질문 텍스트 선택/복사 방지 (외부 LLM 전달 억제) */}
      <div className="max-w-[85%] sm:max-w-[80%] bg-slate-100 text-slate-900 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[15px] sm:text-sm leading-relaxed whitespace-pre-wrap break-words select-none">
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
      <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-bounce [animation-delay:-0.3s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-bounce [animation-delay:-0.15s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-ink-muted animate-bounce" />
    </span>
  );
}

/**
 * 면접 진행 단계 표시 — 인성검사 · 직무 역량 · 면접 순. 동의는 단계에 미포함(전제).
 * current=null 이면 어느 단계도 강조하지 않음(동의 화면의 "앞으로 진행될 단계" 미리보기).
 * 단계가 1개(면접만)뿐이면 표시하지 않는다.
 */
function StepProgress({
  steps,
  current,
  size = "sm",
  lang,
}: {
  steps: Step[];
  current: StepKey | null;
  size?: "sm" | "lg";
  lang: Lang;
}) {
  if (steps.length < 2) return null;
  const currentIdx = current ? steps.findIndex((s) => s.key === current) : -1;
  const lg = size === "lg";
  return (
    <ol
      className={`flex items-center ${lg ? "gap-1.5 sm:gap-2" : "gap-1 sm:gap-1.5"}`}
      aria-label={t(lang, "step.progressAria")}
    >
      {steps.map((s, i) => {
        const done = currentIdx >= 0 && i < currentIdx;
        const active = i === currentIdx;
        return (
          <li
            key={s.key}
            className={`flex items-center ${lg ? "gap-1.5 sm:gap-2" : "gap-1 sm:gap-1.5"} min-w-0`}
            aria-current={active ? "step" : undefined}
          >
            {i > 0 && (
              <span
                className={`h-px shrink-0 ${lg ? "w-4 sm:w-8" : "w-2.5 sm:w-5"} ${
                  done || active ? "bg-primary" : "bg-slate-200"
                }`}
                aria-hidden
              />
            )}
            <span
              className={`shrink-0 inline-flex items-center justify-center rounded-full font-bold ${
                lg ? "w-7 h-7 text-xs" : "w-5 h-5 text-[10px]"
              } ${
                active
                  ? "bg-primary text-surface ring-2 ring-primary/25"
                  : done
                    ? "bg-primary text-surface"
                    : "bg-surface-alt text-ink-muted"
              }`}
              aria-hidden
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={`whitespace-nowrap ${
                lg ? "text-sm sm:text-[15px]" : "text-[11px] sm:text-xs"
              } ${
                active
                  ? "font-bold text-primary-deep"
                  : done
                    ? "font-medium text-ink-soft"
                    : "text-ink-muted"
              }`}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** ms → "m:ss" */
function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * 면접 타이머 — 2개 카운트업 (예상 시간/진행률 X — 면접 길이는 대화에 따라 가변).
 *   - 전체: session.startedAt 기준 (서버가 첫 chat 호출 시 기록)
 *   - 이번 질문: 마지막 AI 메시지 도착 시점 기준 (사용자 전송 시 리셋)
 */
function Timer({
  startedAt,
  messages,
  streaming,
  lang,
}: {
  startedAt: string | null;
  messages: Message[];
  streaming: boolean;
  lang: Lang;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  const [answerStartAt, setAnswerStartAt] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (messages.length === 0) {
      setAnswerStartAt(null);
      return;
    }
    const last = messages[messages.length - 1];
    if (last.role === "model" && !streaming) {
      setAnswerStartAt((prev) => prev ?? Date.now());
    } else if (last.role === "user") {
      setAnswerStartAt(null);
    }
  }, [messages, streaming]);

  const startMs = startedAt ? new Date(startedAt).getTime() : now;
  const elapsedMs = Math.max(0, now - startMs);
  const answerMs = answerStartAt != null ? now - answerStartAt : null;

  return (
    <div
      className="mt-3 flex items-center gap-4 text-xs text-ink-muted"
      aria-label={t(lang, "interview.timer.elapsedAria", { time: fmtTime(elapsedMs) })}
    >
      <span className="flex items-center gap-1.5">
        <span className="text-[10px] text-ink-muted uppercase tracking-wider">{t(lang, "interview.timer.total")}</span>
        <span className="tabular-nums font-semibold text-ink-soft text-sm">
          {fmtTime(elapsedMs)}
        </span>
      </span>
      <span className="text-border-default">|</span>
      <span className="flex items-center gap-1.5">
        <span className="text-[10px] text-ink-muted uppercase tracking-wider">{t(lang, "interview.timer.thisQuestion")}</span>
        <span
          className={`tabular-nums font-semibold text-sm ${
            answerMs != null ? "text-primary-deep" : "text-ink-muted"
          }`}
        >
          {fmtTime(answerMs ?? 0)}
        </span>
      </span>
    </div>
  );
}

/**
 * 인성검사(사전 문항) 게이트 — 강제선택형: 둘 다 바람직한 진술 중 더 나에 가까운 쪽 택1.
 * 한 번에 한 문항, 탭하면 짧은 피드백 후 자동 진행. 점수·특성은 후보자에게 비노출.
 */
function PersonalityGate({
  token,
  lang,
  orgName,
  jobTitle,
  items,
  steps,
  onDone,
}: {
  token: string;
  lang: Lang;
  orgName: string | null;
  jobTitle: string;
  items: Array<{ id: string; a: string; b: string }>;
  steps: Step[];
  onDone: () => void;
}) {
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  // 선택 직후 짧은 하이라이트 동안 추가 탭 방지
  const advancing = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  const total = items.length;
  const current = items[idx];
  const answeredCount = Object.keys(answers).length;

  const submit = async (finalAnswers: Record<string, number>) => {
    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch(`/api/interview/${token}/personality`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responses: items.map((it) => ({
            itemId: it.id,
            value: finalAnswers[it.id],
          })),
          elapsedMs: startedAtRef.current
            ? Date.now() - startedAtRef.current
            : undefined,
        }),
      });
      if (!res.ok) {
        setErr(await res.text());
        setSubmitting(false);
        return;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  const select = (value: number) => {
    if (advancing.current || submitting) return;
    advancing.current = true;
    const next = { ...answers, [current.id]: value };
    setAnswers(next);
    // 선택 피드백을 잠깐 보여준 뒤 진행 — 즉시 넘기면 탭이 씹힌 듯한 느낌
    setTimeout(() => {
      advancing.current = false;
      if (idx < total - 1) {
        setIdx(idx + 1);
      } else {
        void submit(next);
      }
    }, 220);
  };

  if (!started) {
    return (
      <CenteredCard>
        {orgName && (
          <p className="text-lg font-bold text-ink leading-tight">
            {orgName}
          </p>
        )}
        <p className="text-xs text-ink-muted mt-0.5 mb-4">{jobTitle} {t(lang, "interview.aiInterview")}</p>
        <div className="text-3xl mb-3">📝</div>
        <h1 className="text-xl font-bold text-ink">{t(lang, "personality.start.title")}</h1>
        {steps.length > 1 && (
          <div className="mt-4 flex justify-center">
            <StepProgress steps={steps} current="personality" lang={lang} />
          </div>
        )}
        <p className="text-sm text-ink-soft mt-4 leading-relaxed text-left">
          <strong>{jobTitle}</strong>{t(lang, "personality.start.intro1")}
          <strong>{total}{t(lang, "personality.start.intro2")}</strong>{t(lang, "personality.start.intro3")}
          <strong>{t(lang, "personality.start.intro4")}</strong>{t(lang, "personality.start.intro5")}
        </p>
        <ul className="text-xs text-ink-muted mt-4 space-y-1.5 text-left bg-surface-alt border border-border-default rounded-xl p-4">
          <li>{t(lang, "personality.start.bullet1")}</li>
          <li>
            · <strong className="text-ink-soft">{t(lang, "personality.start.bullet2a")}</strong>{" "}
            {t(lang, "personality.start.bullet2b")}
          </li>
          <li>{t(lang, "personality.start.bullet3")}</li>
          <li>{t(lang, "personality.start.bullet4")}</li>
        </ul>
        <button
          onClick={() => {
            startedAtRef.current = Date.now();
            setStarted(true);
          }}
          className="mt-6 w-full px-4 py-3 rounded-xl bg-primary hover:bg-primary-deep text-surface text-sm font-semibold shadow-sm"
        >
          {t(lang, "common.start")}
        </button>
      </CenteredCard>
    );
  }

  if (submitting) {
    return (
      <CenteredCard>
        <div className="flex justify-center mb-4">
          <TypingDots />
        </div>
        <h1 className="text-lg font-bold text-ink">{t(lang, "common.submitting")}</h1>
        <p className="text-sm text-ink-muted mt-2">
          {t(lang, "common.submittingHint")}
        </p>
      </CenteredCard>
    );
  }

  const selected = answers[current.id];

  return (
    <main className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col flex-1 min-h-0 justify-center">
      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
        {/* 브랜드·맥락 헤더 — 어느 회사·공고의 AI 면접인지 + Intervia 로고 (캡처 문의 반영) */}
        <div className="px-5 py-3.5 border-b border-border-default flex items-center gap-2.5">
          <LogoMark size={32} className="shrink-0" />
          <div className="min-w-0 flex-1">
            {orgName ? (
              <>
                <p className="text-base font-bold text-ink truncate leading-tight">
                  {orgName}
                </p>
                <p className="text-[11px] text-ink-muted truncate leading-tight">
                  {jobTitle} <span className="text-ink-muted">{t(lang, "interview.aiInterview")}</span>
                </p>
              </>
            ) : (
              <p className="text-base font-bold text-ink truncate leading-tight">
                {jobTitle}{" "}
                <span className="font-normal text-ink-muted">{t(lang, "interview.aiInterview")}</span>
              </p>
            )}
          </div>
        </div>
        {steps.length > 1 && (
          <div className="px-5 pt-3.5">
            <StepProgress steps={steps} current="personality" lang={lang} />
          </div>
        )}
        {/* 진행 헤더 */}
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
              {t(lang, "personality.sectionLabel")}
            </span>
            <span
              className="text-xs font-semibold text-ink-soft tabular-nums"
              aria-label={t(lang, "personality.progressAria", { total, idx: idx + 1 })}
            >
              {idx + 1} / {total}
            </span>
          </div>
          <div
            className="h-1.5 bg-surface-alt rounded-full overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answeredCount}
          >
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${(answeredCount / total) * 100}%` }}
            />
          </div>
        </div>

        {/* 문항 — 강제선택: 두 진술 중 더 나에 가까운 쪽 */}
        <div className="px-5 py-6">
          <p className="text-sm font-medium text-ink-muted">
            {t(lang, "personality.choicePromptA")}
            <strong className="text-ink">{t(lang, "personality.choicePromptB")}</strong>
            {t(lang, "personality.choicePromptC")}
          </p>

          <div className="mt-4 space-y-3" role="radiogroup" aria-label={t(lang, "personality.choiceAria")}>
            {(
              [
                [1, current.a],
                [2, current.b],
              ] as const
            ).map(([value, text]) => {
              const isSelected = selected === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => select(value)}
                  className={`w-full text-left px-4 py-4 rounded-xl border text-[15px] sm:text-sm font-medium leading-relaxed transition-all min-h-[64px] ${
                    isSelected
                      ? "border-primary bg-primary-soft text-primary-deep ring-2 ring-primary/30"
                      : "border-border-default bg-card text-ink-soft hover:border-primary/40 hover:bg-surface-alt active:bg-primary-soft"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? "border-primary" : "border-border-strong"
                      }`}
                      aria-hidden
                    >
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-primary" />
                      )}
                    </span>
                    {text}
                  </span>
                </button>
              );
            })}
          </div>

          {err && (
            <div className="mt-4 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
              {err}
              <button
                type="button"
                onClick={() => void submit(answers)}
                className="ml-2 underline font-medium"
              >
                {t(lang, "common.resubmit")}
              </button>
            </div>
          )}
        </div>

        {/* 하단 내비게이션 */}
        <div className="px-5 pb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => idx > 0 && setIdx(idx - 1)}
            disabled={idx === 0}
            className="text-xs text-ink-muted hover:text-ink-soft disabled:opacity-0 px-2 py-1.5"
          >
            {t(lang, "common.prevQuestion")}
          </button>
          <span className="text-[10px] text-ink-muted">
            {t(lang, "personality.footerHint")}
          </span>
        </div>
      </div>
    </main>
  );
}

/**
 * 객관식 영어 번역 대기 화면 — 영어 면접에서 prefetch 가 아직 안 끝났을 때만 잠깐 노출.
 * 2.5초마다 세션을 다시 받아 mcq.items 가 오면(번역 완료) 상위로 올려 McqGate 로 넘어간다.
 */
function McqPreparing({
  token,
  lang,
  onReady,
}: {
  token: string;
  lang: Lang;
  onReady: (info: SessionInfo) => void;
}) {
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/interview/${token}`);
        if (!r.ok) return;
        const d = (await r.json()) as SessionInfo;
        if (alive && d.mcq?.items) onReady(d);
      } catch {
        /* 다음 틱에 재시도 */
      }
    };
    const timer = setInterval(() => void poll(), 2500);
    void poll();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token, onReady]);

  return (
    <CenteredCard>
      <div className="flex justify-center mb-4">
        <TypingDots />
      </div>
      <h1 className="text-lg font-bold text-ink">{t(lang, "mcq.preparing.title")}</h1>
      <p className="text-sm text-ink-muted mt-2">{t(lang, "mcq.preparing.hint")}</p>
    </CenteredCard>
  );
}

function McqGate({
  token,
  lang,
  orgName,
  jobTitle,
  items,
  steps,
  onDone,
}: {
  token: string;
  lang: Lang;
  orgName: string | null;
  jobTitle: string;
  items: Array<{ id: string; question: string; options: string[] }>;
  steps: Step[];
  onDone: () => void;
}) {
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  // 선택 직후 짧은 하이라이트 동안 추가 탭 방지 (인성검사와 동일 패턴)
  const advancing = useRef(false);

  const total = items.length;
  const current = items[idx];
  const answeredCount = Object.keys(answers).length;
  const isLast = idx === total - 1;
  const selected = answers[current.id];

  const submit = async (finalAnswers: Record<string, number>) => {
    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch(`/api/interview/${token}/mcq`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responses: items.map((it) => ({
            questionId: it.id,
            chosen: finalAnswers[it.id],
          })),
        }),
      });
      if (!res.ok) {
        setErr(await res.text());
        setSubmitting(false);
        return;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  // 선택 → 짧은 피드백 후 자동으로 다음 문제(마지막이면 제출). 이전 버튼으로 되돌아갈 수 있음.
  const select = (value: number) => {
    if (advancing.current || submitting) return;
    advancing.current = true;
    const next = { ...answers, [current.id]: value };
    setAnswers(next);
    setTimeout(() => {
      advancing.current = false;
      if (idx < total - 1) {
        setIdx(idx + 1);
      } else {
        void submit(next);
      }
    }, 220);
  };

  if (!started) {
    return (
      <CenteredCard>
        {orgName && (
          <p className="text-lg font-bold text-ink leading-tight">
            {orgName}
          </p>
        )}
        <p className="text-xs text-ink-muted mt-0.5 mb-4">{jobTitle} {t(lang, "interview.aiInterview")}</p>
        <div className="text-3xl mb-3">📋</div>
        <h1 className="text-xl font-bold text-ink">{t(lang, "mcq.start.title")}</h1>
        {steps.length > 1 && (
          <div className="mt-4 flex justify-center">
            <StepProgress steps={steps} current="mcq" lang={lang} />
          </div>
        )}
        <p className="text-sm text-ink-soft mt-4 leading-relaxed text-left">
          <strong>{jobTitle}</strong>{t(lang, "mcq.start.intro1")}
          <strong>{total}{t(lang, "mcq.start.intro2")}</strong>{t(lang, "mcq.start.intro3")}
          <strong>{t(lang, "mcq.start.intro4")}</strong>{t(lang, "mcq.start.intro5")}
        </p>
        <ul className="text-xs text-ink-muted mt-4 space-y-1.5 text-left bg-surface-alt border border-border-default rounded-xl p-4">
          <li>{t(lang, "mcq.start.bullet1")}</li>
          <li>{t(lang, "mcq.start.bullet2")}</li>
          <li>{t(lang, "mcq.start.bullet3")}</li>
        </ul>
        <button
          onClick={() => setStarted(true)}
          className="mt-6 w-full px-4 py-3 rounded-xl bg-primary hover:bg-primary-deep text-surface text-sm font-semibold shadow-sm"
        >
          {t(lang, "common.start")}
        </button>
      </CenteredCard>
    );
  }

  if (submitting) {
    return (
      <CenteredCard>
        <div className="flex justify-center mb-4">
          <TypingDots />
        </div>
        <h1 className="text-lg font-bold text-ink">{t(lang, "common.submitting")}</h1>
        <p className="text-sm text-ink-muted mt-2">{t(lang, "common.submittingHint")}</p>
      </CenteredCard>
    );
  }

  return (
    <main className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col flex-1 min-h-0 justify-center">
      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
        {/* 브랜드·맥락 헤더 */}
        <div className="px-5 py-3.5 border-b border-border-default flex items-center gap-2.5">
          <LogoMark size={32} className="shrink-0" />
          <div className="min-w-0 flex-1">
            {orgName ? (
              <>
                <p className="text-base font-bold text-ink truncate leading-tight">
                  {orgName}
                </p>
                <p className="text-[11px] text-ink-muted truncate leading-tight">
                  {jobTitle} <span className="text-ink-muted">{t(lang, "interview.aiInterview")}</span>
                </p>
              </>
            ) : (
              <p className="text-base font-bold text-ink truncate leading-tight">
                {jobTitle}{" "}
                <span className="font-normal text-ink-muted">{t(lang, "interview.aiInterview")}</span>
              </p>
            )}
          </div>
        </div>
        {steps.length > 1 && (
          <div className="px-5 pt-3.5">
            <StepProgress steps={steps} current="mcq" lang={lang} />
          </div>
        )}
        {/* 진행 헤더 */}
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
              {t(lang, "mcq.sectionLabel")}
            </span>
            <span
              className="text-xs font-semibold text-ink-soft tabular-nums"
              aria-label={t(lang, "mcq.progressAria", { total, idx: idx + 1 })}
            >
              {idx + 1} / {total}
            </span>
          </div>
          <div
            className="h-1.5 bg-surface-alt rounded-full overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answeredCount}
          >
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${(answeredCount / total) * 100}%` }}
            />
          </div>
        </div>

        {/* 문제 본문 + 보기 4개 */}
        <div className="px-5 py-6">
          <p className="text-[15px] sm:text-sm font-semibold text-ink leading-relaxed whitespace-pre-wrap">
            {current.question}
          </p>

          <div className="mt-4 space-y-2.5" role="radiogroup" aria-label={t(lang, "mcq.optionsAria")}>
            {current.options.map((text, i) => {
              const isSelected = selected === i;
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => select(i)}
                  className={`w-full text-left px-4 py-3.5 rounded-xl border text-[15px] sm:text-sm font-medium leading-relaxed transition-all ${
                    isSelected
                      ? "border-primary bg-primary-soft text-primary-deep ring-2 ring-primary/30"
                      : "border-border-default bg-card text-ink-soft hover:border-primary/40 hover:bg-surface-alt active:bg-primary-soft"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                        isSelected
                          ? "border-primary text-primary"
                          : "border-border-strong text-ink-muted"
                      }`}
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    {text}
                  </span>
                </button>
              );
            })}
          </div>

          {err && (
            <div className="mt-4 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
        </div>

        {/* 하단 내비게이션 — 선택 시 자동으로 다음 문제로 진행. 이전 버튼으로 되돌아갈 수 있음. */}
        <div className="px-5 pb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => idx > 0 && setIdx(idx - 1)}
            disabled={idx === 0}
            className="text-xs text-ink-muted hover:text-ink-soft disabled:opacity-0 px-2 py-2"
          >
            {t(lang, "common.prev")}
          </button>
          <span className="text-[10px] text-ink-muted">
            {isLast ? t(lang, "mcq.footerLast") : t(lang, "mcq.footerNext")}
          </span>
        </div>
      </div>
    </main>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="bg-card border border-border-default rounded-2xl p-10 text-center max-w-md shadow-sm">
        <div className="flex justify-center mb-5">
          <Logo size={36} />
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * 면접 언어 선택 게이트 — 동의 화면 앞 단계. 언어가 아직 확정되지 않은 화면이라
 * 이 화면만 한/영을 병기한다(lang.* 키는 ko·en 사전이 동일). 선택 시 언어를 저장하고
 * 동의 항목을 그 언어로 다시 받아와(onChoose) 다음 단계(동의)로 넘긴다.
 */
function LanguageGate({
  token,
  current,
  onChoose,
}: {
  token: string;
  current: SessionInfo;
  onChoose: (d: SessionInfo) => void;
}) {
  const [busy, setBusy] = useState(false);

  const choose = async (chosen: Lang) => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/interview/${token}/language`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: chosen }),
      });
      // 선택 언어로 동의 항목을 다시 받기 위해 GET 재요청.
      const r = await fetch(`/api/interview/${token}`);
      const d = (await r.json()) as SessionInfo;
      onChoose({ ...d, language: normalizeLang(d.language) });
    } catch {
      // 네트워크 등 실패 — 화면이 멈추지 않게 기존 info 를 유지하고 언어만 반영해 진행.
      // (동의 항목은 이전 언어로 남을 수 있으나 화면 정지보다는 낫다.)
      onChoose({ ...current, language: chosen });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredCard>
      <h1 className="text-xl font-bold text-ink">{t("ko", "lang.title")}</h1>
      <p className="text-ink-soft mt-2 leading-relaxed">{t("ko", "lang.hint")}</p>
      <div className="mt-6 flex flex-col gap-3">
        <button
          onClick={() => void choose("ko")}
          disabled={busy}
          className="w-full px-4 py-3 rounded-xl bg-primary hover:bg-primary-deep text-surface text-sm font-semibold shadow-sm disabled:opacity-50"
        >
          {t("ko", "lang.ko")}
        </button>
        <button
          onClick={() => void choose("en")}
          disabled={busy}
          className="w-full px-4 py-3 rounded-xl border border-border-strong text-ink-soft hover:bg-surface-alt text-sm font-semibold disabled:opacity-50"
        >
          {t("ko", "lang.en")}
        </button>
      </div>
    </CenteredCard>
  );
}

function ConsentGate({
  token,
  lang,
  candidateName,
  orgName,
  jobTitle,
  items,
  steps,
  onAccepted,
}: {
  token: string;
  lang: Lang;
  candidateName: string;
  orgName: string | null;
  jobTitle: string;
  items: ConsentItem[];
  steps: Step[];
  onAccepted: () => void;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((i) => [i.key, false]))
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // H5 — 본인 확인용 이메일 (지원 시 등록한 메일과 일치 여부 서버 검증)
  const [email, setEmail] = useState("");
  const [withdrawn, setWithdrawn] = useState(false);
  // 항목별 전문 펼침 상태. 기본은 접힘(요약만 노출)으로 첫 화면 글자수를 줄인다.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // 지원취소 — 자의로 지원 철회 시 outcome=withdrawn + 본문 즉시 폐기.
  const withdraw = async () => {
    if (!confirm(t(lang, "consent.withdrawConfirm"))) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/interview/${token}/withdraw`, {
      method: "POST",
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setWithdrawn(true);
  };

  // 체크 동의 항목과 고지 항목 분리. (kind 미지정 레거시는 동의로 간주)
  const consentItems = items.filter((i) => i.kind !== "notice");
  const noticeItems = items.filter((i) => i.kind === "notice");
  const allRequiredChecked = consentItems
    .filter((i) => i.required)
    .every((i) => checks[i.key]);
  const emailFilled = email.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    setErr("");
    // 고지(notice) 항목은 화면에 제시되었고 사용자가 진행했으므로 '확인'으로 기록(감사 증거).
    const consentsPayload: Record<string, boolean> = { ...checks };
    for (const it of noticeItems) consentsPayload[it.key] = true;
    const res = await fetch(`/api/interview/${token}/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consents: consentsPayload, email: email.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      let msg = await res.text();
      try {
        const data = JSON.parse(msg);
        if (data?.error) msg = data.error;
      } catch {
        /* plain text */
      }
      setErr(msg);
      return;
    }
    onAccepted();
  };

  if (withdrawn) {
    return (
      <CenteredCard>
        <div className="text-3xl mb-3">🗑️</div>
        <h1 className="text-xl font-bold text-ink">{t(lang, "consent.withdrawn.title")}</h1>
        <p className="text-ink-soft mt-2 leading-relaxed">
          {t(lang, "consent.withdrawn.body")}
          <br />
          {t(lang, "consent.withdrawn.thanks")}
        </p>
      </CenteredCard>
    );
  }

  return (
    <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col flex-1 min-h-0">
      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
        <header className="px-6 py-5 border-b border-border-default bg-gradient-to-br from-primary-soft to-primary-soft/60">
          <div className="mb-3">
            <Logo size={32} />
          </div>
          <div className="text-xs text-ink-muted mb-1.5">
            {t(lang, "consent.candidateHonorific", { name: candidateName })}
          </div>
          {orgName ? (
            <>
              <div className="text-xl sm:text-2xl font-bold text-ink leading-tight">
                {orgName}
              </div>
              <h1 className="text-sm sm:text-base font-semibold text-ink-soft mt-1">
                {t(lang, "consent.title", { job: jobTitle })}
              </h1>
            </>
          ) : (
            <h1 className="text-lg sm:text-xl font-bold text-ink">
              {t(lang, "consent.title", { job: jobTitle })}
            </h1>
          )}
        </header>

        {/* 영어판은 법적 정본이 한국어임을 헤더 아래에 작은 안내문으로 고지. (ko 는 빈 문자열) */}
        {lang === "en" && t(lang, "consent.governingNotice") && (
          <div className="px-6 py-2.5 border-b border-border-default bg-surface-alt/60">
            <p className="text-[11px] text-ink-muted leading-relaxed">
              {t(lang, "consent.governingNotice")}
            </p>
          </div>
        )}

        {steps.length > 1 && (
          <div className="px-6 py-5 border-b border-border-default bg-card">
            <p className="text-[15px] font-bold text-ink mb-3">
              {t(lang, "consent.flowTitle")}
              <span className="font-medium text-ink-soft text-xs ml-1.5">
                {t(lang, "consent.flowSteps", { n: steps.length })}
              </span>
            </p>
            <StepProgress steps={steps} current={null} size="lg" lang={lang} />
          </div>
        )}

        <ul className="divide-y divide-border-default">
          {consentItems.map((it) => (
            <li key={it.key} className="px-6 py-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checks[it.key] ?? false}
                  onChange={(e) =>
                    setChecks({ ...checks, [it.key]: e.target.checked })
                  }
                  className="mt-1 w-4 h-4 rounded border-border-strong"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-ink">
                      {it.title}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        it.required
                          ? "bg-danger-soft text-danger"
                          : "bg-surface-alt text-ink-soft"
                      }`}
                    >
                      {it.required ? t(lang, "common.required") : t(lang, "common.optional")}
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {it.legalBasis}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-soft mt-1 leading-relaxed whitespace-pre-line">
                    {expanded[it.key] ? it.description : it.summary}
                  </p>
                </div>
              </label>
              <button
                type="button"
                onClick={() => toggleExpanded(it.key)}
                className="ml-7 mt-1.5 text-[11px] font-medium text-primary hover:underline"
              >
                {expanded[it.key] ? t(lang, "consent.collapse") : t(lang, "consent.expand")}
              </button>
            </li>
          ))}
        </ul>

        {noticeItems.length > 0 && (
          <div className="px-6 py-3 border-t border-border-default bg-surface-alt/60">
            <div className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-2">
              {t(lang, "consent.noticeSection")}
            </div>
            <ul className="space-y-2.5">
              {noticeItems.map((it) => (
                <li key={it.key}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-ink">
                      {it.title}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-surface-alt text-ink-soft">
                      {t(lang, "consent.noticeBadge")}
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {it.legalBasis}
                    </span>
                  </div>
                  {expanded[it.key] && (
                    <p className="text-[11px] text-ink-soft mt-1 leading-relaxed">
                      {it.description}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleExpanded(it.key)}
                    className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
                  >
                    {expanded[it.key] ? t(lang, "consent.collapse") : t(lang, "consent.expand")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="px-6 py-4 border-t border-border-default bg-surface-alt">
          <div className="mb-4 bg-card border border-border-default rounded-xl p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink mb-2">
              {t(lang, "consent.identityLabel")}
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-danger-soft text-danger">
                {t(lang, "common.required")}
              </span>
            </label>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ${
                allRequiredChecked && !emailFilled
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-border-strong"
              }`}
            />
            <p className="text-[11px] text-ink-muted mt-1.5">
              {t(lang, "consent.identityHint")}
            </p>
          </div>
          <p className="text-[11px] text-ink-muted leading-relaxed mb-3">
            {t(lang, "consent.legalIntro1")}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-deep underline hover:text-primary-deep"
            >
              {t(lang, "consent.privacyPolicy")}
            </a>
            {t(lang, "consent.legalIntro2")}
          </p>
          {err && (
            <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-3">
              {err}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={!allRequiredChecked || !emailFilled || busy}
              className="flex-1 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy
                ? t(lang, "consent.busy")
                : !allRequiredChecked
                  ? t(lang, "consent.needRequired")
                  : !emailFilled
                    ? t(lang, "consent.needEmail")
                    : t(lang, "consent.submit")}
            </button>
            <button
              onClick={withdraw}
              disabled={busy}
              className="px-4 py-2.5 rounded-lg border border-danger/40 text-danger hover:bg-danger-soft text-sm disabled:opacity-50"
            >
              {t(lang, "consent.withdraw")}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

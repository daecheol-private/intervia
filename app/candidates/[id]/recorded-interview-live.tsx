"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { notify } from "@/app/components/Dialog";
import { useVoiceInput } from "@/app/interview/[token]/use-voice-input";

// 준실시간 라이브 면접 레코더 — 브라우저 STT(Web Speech API) 로 말하는 즉시 받아쓰기하고,
// 잠깐 멈출 때마다(=발화 경계) 그 사이 쌓인 원문만 서버→LLM 으로 보내 화자(면접관/지원자)별로
// 정리한다. 즉시 보이는 원문 위에 정리된 전사가 몇 초 간격으로 따라붙는다.
// 오디오는 브라우저 밖(Intervia)으로 나가지 않는다 — 텍스트만 저장. 설계: docs/LIVE_INTERVIEW_PLAN.md

type CleanSeg = {
  seq: number;
  role: "candidate" | "interviewer" | "unknown";
  text: string;
};

const MAX_SUGGESTIONS = 5; // 추천 질문은 최대 5개까지 누적

type WakeLockNav = Navigator & {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
};
type WakeLockSentinelLike = { release(): Promise<void> };

// 마이크가 잠깐 쉬면(마지막 확정 후 이만큼 조용) 정리하러 보낸다. 길게 말하면 쉬기 전에도 보낸다
// (정리본이 원문보다 너무 뒤처지지 않게).
const PAUSE_FLUSH_MS = 1500;
const MAX_PENDING_CHARS = 220;
// 라이브 녹음 최대 1시간 — 지나면 자동 종료(세션·누적 데이터 한도, 업로드 파일 크기 제한과 균형).
const MAX_DURATION_SEC = 60 * 60;

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function roleKo(role: CleanSeg["role"]): string {
  return role === "candidate"
    ? "지원자"
    : role === "interviewer"
      ? "면접관"
      : "미상";
}

export function LiveRecorder({
  candidateId,
  round,
  consentConfirmed,
  onClose,
  onFinished,
}: {
  candidateId: number;
  round: "round1" | "round2";
  consentConfirmed: boolean;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [phase, setPhase] = useState<
    "idle" | "starting" | "recording" | "finishing"
  >("idle");
  const [cleaned, setCleaned] = useState<CleanSeg[]>([]); // 정리된(화자 구분) 전사
  const [rawTail, setRawTail] = useState(""); // 아직 정리 전 원문(화면용)
  const [suggestions, setSuggestions] = useState<string[]>([]); // 추천 질문(누적, 최대 5)
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const doneRef = useRef(false);
  const riIdRef = useRef<number | null>(null);
  const sessionStartRef = useRef(0);
  const pendingRef = useRef(""); // 정리 대기 중인 원문 누적
  const flushTimerRef = useRef<number | null>(null);
  const cleanChainRef = useRef<Promise<void>>(Promise.resolve()); // 정리 요청 순차 체인
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const suggestTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<string[]>([]); // 폴링(인터벌 클로저)에서 현재 질문 읽기용

  const beforeUnload = useCallback((e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = "";
  }, []);

  // 정리 대기 원문 한 덩어리를 서버로 보내 화자별 정리본을 받아 누적. 순차 체인이라 순서 보존.
  const flushPending = useCallback((): Promise<void> => {
    const raw = pendingRef.current.trim();
    pendingRef.current = "";
    setRawTail("");
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const riId = riIdRef.current;
    if (!raw || !riId) return cleanChainRef.current;
    const p = cleanChainRef.current
      .then(async () => {
        try {
          const r = await fetch(
            `/api/candidates/${candidateId}/recorded-interview/live`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "clean",
                recordedInterviewId: riId,
                rawText: raw,
              }),
            }
          );
          if (r.ok) {
            const body = (await r.json()) as { segments: CleanSeg[] };
            if (body.segments?.length) {
              // seq 로 병합 — 직전 row 가 이어붙여졌으면(같은 seq) 교체, 새 턴은 추가.
              setCleaned((prev) => {
                const map = new Map(prev.map((s) => [s.seq, s]));
                for (const s of body.segments) map.set(s.seq, s);
                return Array.from(map.values()).sort((a, b) => a.seq - b.seq);
              });
            }
            setErr(null);
          } else {
            // 실패 — 원문을 대기열 앞에 되돌려 다음 정리 때 재시도(긴 면접 중 유실 방지).
            pendingRef.current = pendingRef.current
              ? `${raw} ${pendingRef.current}`
              : raw;
            setRawTail(pendingRef.current);
            setErr("일부 구간 정리가 지연되고 있습니다 — 자동 재시도합니다.");
          }
        } catch {
          pendingRef.current = pendingRef.current
            ? `${raw} ${pendingRef.current}`
            : raw;
          setRawTail(pendingRef.current);
          setErr("정리 전송이 지연되고 있습니다 — 자동 재시도합니다.");
        }
      })
      .catch(() => {});
    cleanChainRef.current = p;
    return p;
  }, [candidateId]);

  // STT 확정 발화 → 원문 누적 + (쉬면/길어지면) 정리 예약.
  const handleFinal = useCallback(
    (text: string) => {
      pendingRef.current =
        (pendingRef.current ? pendingRef.current + " " : "") + text;
      setRawTail(pendingRef.current);
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
      if (pendingRef.current.length >= MAX_PENDING_CHARS) {
        void flushPending();
      } else {
        flushTimerRef.current = window.setTimeout(() => {
          void flushPending();
        }, PAUSE_FLUSH_MS);
      }
    },
    [flushPending]
  );

  const voice = useVoiceInput({ lang: "ko-KR", onFinalText: handleFinal });

  // 새 내용이 오면 전사 박스를 맨 아래로.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [cleaned, rawTail, voice.interim]);

  // 폴링 인터벌 클로저에서 최신 추천 질문 목록을 읽도록 ref 동기화.
  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  const cleanup = () => {
    voice.stop();
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    if (suggestTimerRef.current) window.clearInterval(suggestTimerRef.current);
    if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
    flushTimerRef.current = null;
    suggestTimerRef.current = null;
    elapsedTimerRef.current = null;
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    window.removeEventListener("beforeunload", beforeUnload);
  };

  // 언마운트 시 안전 정리.
  useEffect(() => {
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollSuggestion = async () => {
    const riId = riIdRef.current;
    if (!riId) return;
    // 이미 5개면 새로 받지 않는다 — 클릭해 비우면 그때 다시 채워진다(과도한 갱신 방지).
    if (suggestionsRef.current.length >= MAX_SUGGESTIONS) return;
    try {
      const have = encodeURIComponent(suggestionsRef.current.join("\n"));
      const r = await fetch(
        `/api/candidates/${candidateId}/recorded-interview/live?riId=${riId}&have=${have}`
      );
      if (!r.ok) return;
      const body = (await r.json()) as { suggestions?: string[] };
      const incoming = Array.isArray(body.suggestions) ? body.suggestions : [];
      if (incoming.length === 0) return;
      // 교체가 아니라 누적 — 중복 아닌 중요한 새 질문만 5개까지 추가.
      setSuggestions((prev) => {
        const next = [...prev];
        for (const q of incoming) {
          const t = q.trim();
          if (t && next.length < MAX_SUGGESTIONS && !next.includes(t)) next.push(t);
        }
        return next;
      });
    } catch {
      /* 비치명적 */
    }
  };

  const start = async () => {
    setErr(null);
    setCleaned([]);
    setRawTail("");
    setSuggestions([]);
    suggestionsRef.current = [];
    setPhase("starting");
    if (!voice.supported) {
      setErr(
        "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome·Edge·Safari 를 권장합니다."
      );
      setPhase("idle");
      return;
    }
    try {
      const r = await fetch(
        `/api/candidates/${candidateId}/recorded-interview/live`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", round, consentConfirmed }),
        }
      );
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        let msg = t;
        try {
          const j = JSON.parse(t) as { message?: string };
          if (j.message) msg = j.message;
        } catch {
          /* plain */
        }
        throw new Error(msg || "라이브 세션 시작 실패");
      }
      riIdRef.current = ((await r.json()) as { id: number }).id;

      try {
        const wl = (navigator as WakeLockNav).wakeLock;
        if (wl) wakeLockRef.current = await wl.request("screen");
      } catch {
        /* 화면 꺼짐 방지 실패는 비치명적 */
      }
      window.addEventListener("beforeunload", beforeUnload);

      sessionStartRef.current = Date.now();
      pendingRef.current = "";
      doneRef.current = false;
      cleanChainRef.current = Promise.resolve();
      setPhase("recording");
      voice.start(); // 브라우저 STT 시작

      elapsedTimerRef.current = window.setInterval(() => {
        // 경과는 세션 시작 시각 기준으로 계산(탭 throttle 시 드리프트 방지).
        const sec = Math.round((Date.now() - sessionStartRef.current) / 1000);
        setElapsed(sec);
        // 최대 1시간 — 지나면 자동 종료 후 평가.
        if (sec >= MAX_DURATION_SEC && !doneRef.current) {
          notify("최대 1시간이 되어 면접을 자동 종료합니다. 평가 리포트를 생성합니다.", {
            title: "자동 종료",
            tone: "info",
          });
          setPhase("finishing");
          void doFinish();
        }
      }, 1000);
      suggestTimerRef.current = window.setInterval(() => {
        void pollSuggestion();
      }, 45_000);
    } catch (e) {
      cleanup();
      setPhase("idle");
      setErr(e instanceof Error ? e.message : "녹음을 시작하지 못했습니다.");
    }
  };

  const doFinish = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    voice.stop();
    if (suggestTimerRef.current) window.clearInterval(suggestTimerRef.current);
    if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
    void wakeLockRef.current?.release().catch(() => {});
    window.removeEventListener("beforeunload", beforeUnload);

    const riId = riIdRef.current;
    if (!riId) {
      setPhase("idle");
      onClose();
      return;
    }

    // 남은 원문 마지막 정리 + 진행 중 정리 모두 완료까지 대기 — 그래야 finalize 가 전체를 본다.
    try {
      await flushPending();
      await cleanChainRef.current;
    } catch {
      /* 비치명적 */
    }

    const durationSeconds = Math.round(
      (Date.now() - sessionStartRef.current) / 1000
    );
    try {
      const r = await fetch(
        `/api/candidates/${candidateId}/recorded-interview/live`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "finish",
            recordedInterviewId: riId,
            durationSeconds,
          }),
        }
      );
      const body = (await r.json().catch(() => ({}))) as { status?: string };
      if (body.status === "failed") {
        notify("정리·평가 중 오류가 발생했습니다. 다시 시도해 주세요.", {
          title: "처리 실패",
          tone: "danger",
        });
      } else {
        notify("대면 면접 평가 리포트가 생성되었습니다.", {
          title: "완료",
          tone: "success",
        });
      }
    } catch {
      notify("종료 처리 중 네트워크 오류가 발생했습니다.", {
        title: "오류",
        tone: "danger",
      });
    } finally {
      onFinished();
      onClose();
    }
  };

  const finish = () => {
    if (phase === "finishing") return;
    setPhase("finishing");
    void doFinish();
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary-soft/20 p-4 space-y-4">
      {phase === "idle" ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft leading-relaxed">
            노트북 마이크로{" "}
            <strong>{round === "round2" ? "2차" : "1차"} 대면 면접</strong>을
            기록합니다. 말하면 <strong>바로 화면에 텍스트</strong>가 뜨고, 잠깐
            멈출 때마다 화자(면접관/지원자)별로 정리됩니다. 시작하면 마이크 권한을
            허용해 주세요. 진행 중 <strong>이 탭을 닫지 마세요.</strong>
          </p>
          <p className="text-[11px] text-ink-muted">
            음성 인식은 브라우저 기능을 사용합니다 — Chrome·Edge·Safari 권장
            (Firefox 미지원). 녹음 파일은 만들지 않으며, 음성은 기기 밖으로
            저장되지 않습니다.
          </p>
          {err && <p className="text-sm text-danger">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={start}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium shadow-sm"
            >
              ● 녹음 시작
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm"
            >
              취소
            </button>
          </div>
        </div>
      ) : phase === "starting" ? (
        <div className="flex items-center gap-2 text-sm text-primary-deep py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> 준비 중...
        </div>
      ) : phase === "finishing" ? (
        <div className="flex items-center gap-2 text-sm text-primary-deep py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> 마지막 구간 정리 후 평가
          리포트를 생성하는 중입니다... (최대 수 분)
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium text-danger">
              <span className="w-2.5 h-2.5 rounded-full bg-danger animate-pulse" />
              녹음 중 · <span className="tabular-nums">{fmtElapsed(elapsed)}</span>
            </span>
            <button
              onClick={finish}
              className="px-4 py-2 rounded-lg bg-danger hover:opacity-90 text-white text-sm font-medium shadow-sm"
            >
              ■ 면접 종료
            </button>
          </div>

          {err && <p className="text-xs text-warning">{err}</p>}

          {/* 정리된 대화 (화자 구분) — 메인 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                정리된 대화 (화자 구분)
              </span>
              <span className="text-[10px] text-ink-muted">
                말이 멈출 때마다 정리
              </span>
            </div>
            <div className="h-72 overflow-y-auto rounded-lg border border-border-default bg-card p-3 space-y-2 text-sm leading-relaxed">
              {cleaned.length === 0 ? (
                <p className="text-ink-muted text-xs">
                  화자별로 정리된 대화가 여기에 쌓입니다. (아래 실시간 인식이 먼저
                  뜹니다)
                </p>
              ) : (
                cleaned.map((s) => (
                  <div key={s.seq} className="flex gap-2">
                    <span
                      className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded h-fit ${
                        s.role === "candidate"
                          ? "bg-card text-info border border-info/40"
                          : "bg-surface-alt text-ink-soft border border-border-default"
                      }`}
                    >
                      {roleKo(s.role)}
                    </span>
                    <span className="text-ink">{s.text}</span>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {/* 실시간 인식 (정리 전) — 즉시 피드백 */}
          <div>
            <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
              실시간 인식
            </div>
            <div className="min-h-[3rem] rounded-lg border border-border-default bg-surface-alt p-3 text-sm text-ink-soft leading-relaxed">
              {rawTail || voice.interim ? (
                <>
                  <span>{rawTail}</span>{" "}
                  <span className="text-ink-muted italic">{voice.interim}</span>
                </>
              ) : (
                <span className="text-ink-muted text-xs">
                  {voice.listening
                    ? "말씀하세요 — 인식되는 즉시 표시됩니다."
                    : "마이크 준비 중..."}
                </span>
              )}
            </div>
          </div>

          {/* 추천 질문 — 누적(최대 5). 클릭하면 사용 처리(목록에서 제거). */}
          {suggestions.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
                추천 질문{" "}
                <span className="text-ink-muted normal-case font-normal">
                  · 클릭하면 목록에서 제거
                </span>
              </div>
              <div className="space-y-1.5">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() =>
                      setSuggestions((prev) => prev.filter((x) => x !== q))
                    }
                    className="block w-full text-left rounded-md border border-primary/20 bg-primary-soft/40 hover:bg-white hover:border-primary/40 px-2.5 py-1.5 text-xs text-primary-deep leading-relaxed transition-colors"
                    title="클릭하면 목록에서 제거"
                  >
                    “{q}”
                  </button>
                ))}
              </div>
            </div>
          )}

          {voice.error && <p className="text-xs text-warning">{voice.error}</p>}

          <p className="text-[11px] text-ink-muted">
            실시간 인식은 즉시, 화자 구분 정리는 몇 초 간격으로 따라붙습니다. 음성은
            저장하지 않으며, 종료 시 전체를 한 번 더 정리해 평가합니다.{" "}
            <strong>최대 1시간까지 녹음되며, 지나면 자동 종료됩니다.</strong>
          </p>
        </div>
      )}
    </div>
  );
}

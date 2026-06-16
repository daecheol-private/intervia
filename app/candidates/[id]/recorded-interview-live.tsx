"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { notify } from "@/app/components/Dialog";

// 준실시간 라이브 면접 레코더 (서기 1명이 노트북으로 사용).
// MediaRecorder 의 timeslice 조각은 첫 조각만 독립 디코딩되므로(webm 헤더),
// stop/start 사이클로 매 조각을 완결 파일로 만들어 순차 전송한다.
// 설계: docs/LIVE_INTERVIEW_PLAN.md §3

type LiveSuggestion = {
  answer_summary: string;
  positives: string[];
  to_confirm: string[];
  suggestions: string[];
};
type LiveSeg = { seq: number; text: string; lowConfidence: boolean };

type WakeLockNav = Navigator & {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
};
type WakeLockSentinelLike = { release(): Promise<void> };

const CHUNK_MS = 20_000;

function pickMime(): string {
  const cands = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of cands) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c)
    )
      return c;
  }
  return "";
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  const [segments, setSegments] = useState<LiveSeg[]>([]);
  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const runningRef = useRef(false);
  const doneRef = useRef(false);
  const chunkIdxRef = useRef(0);
  const sessionStartRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);
  const suggestTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const riIdRef = useRef<number | null>(null);
  const mimeRef = useRef("");
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // 새 세그먼트가 오면 전사 박스를 맨 아래로.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [segments]);

  const cleanup = () => {
    runningRef.current = false;
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    if (suggestTimerRef.current) window.clearInterval(suggestTimerRef.current);
    if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
    stopTimerRef.current = null;
    suggestTimerRef.current = null;
    elapsedTimerRef.current = null;
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive")
        recorderRef.current.stop();
    } catch {
      /* noop */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    window.removeEventListener("beforeunload", beforeUnload);
  };

  const beforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = "";
  };

  // 언마운트 시 안전 정리.
  useEffect(() => {
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendChunk = async (blob: Blob, baseMs: number, chunkIndex: number) => {
    const riId = riIdRef.current;
    if (!riId) return;
    try {
      const b64 = toBase64(await blob.arrayBuffer());
      const r = await fetch(
        `/api/candidates/${candidateId}/recorded-interview/live`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chunk",
            recordedInterviewId: riId,
            audioBase64: b64,
            mimeType: blob.type || mimeRef.current || "audio/webm",
            baseMs,
            chunkIndex,
          }),
        }
      );
      if (r.ok) {
        const body = (await r.json()) as { segments: LiveSeg[] };
        if (body.segments?.length)
          setSegments((prev) => [...prev, ...body.segments]);
        setErr(null);
      } else {
        // 비치명적 — 녹음은 계속, 한 조각만 누락.
        setErr("일부 구간 전사에 실패했습니다 (녹음은 계속됩니다).");
      }
    } catch {
      setErr("일부 구간 전송에 실패했습니다 (녹음은 계속됩니다).");
    }
  };

  const startChunkCycle = () => {
    const stream = streamRef.current;
    if (!stream || !runningRef.current) return;
    const base = Math.round(performance.now() - sessionStartRef.current);
    const idx = chunkIdxRef.current++;
    const rec = new MediaRecorder(
      stream,
      mimeRef.current ? { mimeType: mimeRef.current } : undefined
    );
    recorderRef.current = rec;
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    rec.onstop = async () => {
      const blob = new Blob(parts, {
        type: rec.mimeType || mimeRef.current || "audio/webm",
      });
      if (blob.size > 0) await sendChunk(blob, base, idx);
      if (runningRef.current) startChunkCycle();
      else void doFinish();
    };
    rec.start();
    stopTimerRef.current = window.setTimeout(() => {
      if (rec.state !== "inactive") rec.stop();
    }, CHUNK_MS);
  };

  const pollSuggestion = async () => {
    const riId = riIdRef.current;
    if (!riId) return;
    try {
      const r = await fetch(
        `/api/candidates/${candidateId}/recorded-interview/live?riId=${riId}`
      );
      if (r.ok) setSuggestion((await r.json()) as LiveSuggestion);
    } catch {
      /* 비치명적 */
    }
  };

  const start = async () => {
    setErr(null);
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      mimeRef.current = pickMime();

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
      const body = (await r.json()) as { id: number };
      riIdRef.current = body.id;

      try {
        const wl = (navigator as WakeLockNav).wakeLock;
        if (wl) wakeLockRef.current = await wl.request("screen");
      } catch {
        /* 화면 꺼짐 방지 실패는 비치명적 */
      }
      window.addEventListener("beforeunload", beforeUnload);

      sessionStartRef.current = performance.now();
      chunkIdxRef.current = 0;
      doneRef.current = false;
      runningRef.current = true;
      setPhase("recording");

      elapsedTimerRef.current = window.setInterval(
        () => setElapsed((s) => s + 1),
        1000
      );
      suggestTimerRef.current = window.setInterval(() => {
        void pollSuggestion();
      }, 30_000);

      startChunkCycle();
    } catch (e) {
      cleanup();
      setPhase("idle");
      const msg =
        e instanceof DOMException
          ? "마이크 권한이 필요합니다. 브라우저에서 마이크 사용을 허용해 주세요."
          : e instanceof Error
            ? e.message
            : "녹음을 시작하지 못했습니다.";
      setErr(msg);
    }
  };

  const doFinish = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const riId = riIdRef.current;
    // 타이머·스트림·웨이크락 정리 (recorder 는 이미 정지).
    if (suggestTimerRef.current) window.clearInterval(suggestTimerRef.current);
    if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void wakeLockRef.current?.release().catch(() => {});
    window.removeEventListener("beforeunload", beforeUnload);

    if (!riId) {
      setPhase("idle");
      onClose();
      return;
    }
    try {
      const r = await fetch(
        `/api/candidates/${candidateId}/recorded-interview/live`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "finish", recordedInterviewId: riId }),
        }
      );
      const body = (await r.json().catch(() => ({}))) as { status?: string };
      if (body.status === "failed") {
        notify("전사·평가 중 오류가 발생했습니다. 다시 시도해 주세요.", {
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
    runningRef.current = false;
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") {
      rec.stop(); // onstop → 마지막 조각 전송 → doFinish
    } else {
      void doFinish();
    }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary-soft/20 p-4 space-y-4">
      {phase === "idle" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-700 leading-relaxed">
            노트북 마이크로 <strong>{round === "round2" ? "2차" : "1차"} 대면 면접</strong>을
            준실시간으로 기록합니다. 시작하면 마이크 권한을 허용해 주세요. 진행 중
            <strong> 이 탭을 닫거나 화면을 잠그지 마세요.</strong>
          </p>
          {err && <p className="text-sm text-danger">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={start}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium shadow-sm"
            >
              ● 녹음 시작
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
            >
              취소
            </button>
          </div>
        </div>
      ) : phase === "starting" ? (
        <div className="flex items-center gap-2 text-sm text-primary-deep py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> 마이크 준비 중...
        </div>
      ) : phase === "finishing" ? (
        <div className="flex items-center gap-2 text-sm text-primary-deep py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> 마지막 구간 전사 후 평가
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

          <div className="grid md:grid-cols-2 gap-4">
            {/* 실시간 스크립트 */}
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                실시간 스크립트
              </div>
              <div className="h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 space-y-1.5 text-xs leading-relaxed">
                {segments.length === 0 ? (
                  <p className="text-slate-400">
                    발화가 인식되면 여기에 표시됩니다. (전사는 약 20초 단위로
                    갱신됩니다)
                  </p>
                ) : (
                  segments.map((s) => (
                    <p
                      key={s.seq}
                      className={
                        s.lowConfidence
                          ? "text-slate-500 border-b border-dotted border-warning inline-block"
                          : "text-slate-700"
                      }
                    >
                      {s.text}
                    </p>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>

            {/* AI 어시스턴트 */}
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                AI 어시스턴트
              </div>
              <div className="h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 space-y-3 text-xs">
                {!suggestion ? (
                  <p className="text-slate-400">
                    면접이 진행되면 답변 요약·추천 질문이 표시됩니다. (약 30초마다
                    갱신)
                  </p>
                ) : (
                  <>
                    {suggestion.answer_summary && (
                      <div>
                        <div className="font-semibold text-primary-deep mb-0.5">
                          답변 요약
                        </div>
                        <p className="text-slate-700 leading-relaxed">
                          {suggestion.answer_summary}
                        </p>
                      </div>
                    )}
                    {suggestion.positives.length > 0 && (
                      <div>
                        <div className="font-semibold text-success mb-0.5">
                          긍정 신호
                        </div>
                        <ul className="list-disc pl-4 text-slate-700 space-y-0.5">
                          {suggestion.positives.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {suggestion.to_confirm.length > 0 && (
                      <div>
                        <div className="font-semibold text-warning mb-0.5">
                          확인 필요
                        </div>
                        <ul className="list-disc pl-4 text-slate-700 space-y-0.5">
                          {suggestion.to_confirm.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {suggestion.suggestions.length > 0 && (
                      <div>
                        <div className="font-semibold text-slate-600 mb-1">
                          추가 질문 추천
                        </div>
                        <div className="space-y-1.5">
                          {suggestion.suggestions.map((q, i) => (
                            <div
                              key={i}
                              className="rounded-md border border-primary/20 bg-primary-soft/40 px-2.5 py-1.5 text-primary-deep leading-relaxed"
                            >
                              “{q}”
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            준실시간이라 화면 표시는 실제 대화보다 15~40초 늦을 수 있습니다. 녹음
            파일은 저장하지 않으며, 종료 시 전체를 한 번 더 정리해 평가합니다.
          </p>
        </div>
      )}
    </div>
  );
}

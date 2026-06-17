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
  const [level, setLevel] = useState(0); // 마이크 입력 레벨 0~1 (실시간 피드백)
  const [noInput, setNoInput] = useState(false); // 일정 시간 무입력이면 마이크 경고

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
  // 청크 전송 순차 체인 — 녹음은 끊김 없이 계속하되 전송은 순서대로 직렬화한다.
  //  ① 녹음 연속(구간 유실 방지)  ② 전송 순서 보존(seq=시간순)  ③ 종료 시 체인 전체 대기(레이스 방지).
  const sendChainRef = useRef<Promise<void>>(Promise.resolve());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const lastSoundRef = useRef(0); // 마지막으로 유의미한 입력이 감지된 시각(performance.now)

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
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    levelRafRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
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
    rec.onstop = () => {
      const blob = new Blob(parts, {
        type: rec.mimeType || mimeRef.current || "audio/webm",
      });
      // 다음 사이클을 **먼저** 시작 — 전사 대기 동안 녹음이 멈추지 않게 한다(구간 유실 방지).
      // (이전엔 await sendChunk 후 시작이라 전사 5~10초 동안 마이크 음성이 통째로 버려졌다.)
      if (runningRef.current) startChunkCycle();
      // 전송은 순차 체인에 얹어 동시에 진행 — 순서 보존 + sendChunk 는 내부 try/catch 라 reject 없음.
      if (blob.size > 0) {
        sendChainRef.current = sendChainRef.current
          .then(() => sendChunk(blob, base, idx))
          .catch(() => {});
      }
      // 녹음 종료 후의 마지막 onstop 이면, 큐에 쌓인 전송이 모두 끝난 뒤 finalize.
      if (!runningRef.current) void doFinish();
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
    setLevel(0);
    setNoInput(false);
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      mimeRef.current = pickMime();

      // 마이크 입력 레벨 미터 — 전사는 ~20초 단위라 지연이 커서, 사용자가 "내 말이 들어가고
      // 있다"를 즉시 확인할 수단이 없었다(원래 화면엔 아무것도 안 떠 "안 되는 것처럼" 보임).
      // 레벨 바 + 무입력 경고로 실시간 피드백을 준다.
      lastSoundRef.current =
        typeof performance !== "undefined" ? performance.now() : 0;
      try {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ac = new AC();
        audioCtxRef.current = ac;
        const srcNode = ac.createMediaStreamSource(stream);
        const analyser = ac.createAnalyser();
        analyser.fftSize = 512;
        srcNode.connect(analyser);
        const audioBuf = new Uint8Array(analyser.fftSize);
        let lastPaint = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(audioBuf);
          let sum = 0;
          for (let i = 0; i < audioBuf.length; i++) {
            const v = (audioBuf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / audioBuf.length);
          const now = performance.now();
          if (rms > 0.04) lastSoundRef.current = now; // 유의미한 입력 감지
          if (now - lastPaint > 66) {
            lastPaint = now;
            setLevel(Math.min(1, rms * 3));
          }
          levelRafRef.current = requestAnimationFrame(tick);
        };
        levelRafRef.current = requestAnimationFrame(tick);
      } catch {
        /* 레벨 미터 실패는 비치명적 */
      }

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
      sendChainRef.current = Promise.resolve(); // 새 세션 — 전송 체인 초기화
      runningRef.current = true;
      setPhase("recording");

      elapsedTimerRef.current = window.setInterval(() => {
        setElapsed((s) => s + 1);
        // 4초 넘게 유의미한 입력이 없으면 마이크 경고(연결·음소거·권한 문제 조기 발견).
        setNoInput(performance.now() - lastSoundRef.current > 4000);
      }, 1000);
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
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    levelRafRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    window.removeEventListener("beforeunload", beforeUnload);

    if (!riId) {
      setPhase("idle");
      onClose();
      return;
    }
    // 체인에 쌓인 모든 청크 전사·저장이 끝날 때까지 대기 — 안 그러면 서버 finalize 가
    // 청크 세그먼트를 못 보고 "전사 세그먼트가 없습니다"로 실패한다(레이스).
    // sendChunk 는 서버 200 응답(=세그먼트 커밋 완료) 후에야 resolve 되므로, 체인을 기다리면
    // 마지막 청크까지 모두 저장된 뒤 종료된다. (sendChunk 는 reject 없음 → 체인 안전)
    try {
      await sendChainRef.current;
    } catch {
      /* 방어적 — 체인은 reject 되지 않지만 만약을 위해 */
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

          {/* 마이크 입력 레벨 — 전사(약 20초 지연)와 별개로 "소리가 들어가는 중"을 즉시 표시 */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 shrink-0">마이크 입력</span>
            <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden max-w-[260px]">
              <div
                className={`h-full rounded-full transition-[width] duration-75 ${
                  noInput ? "bg-warning" : "bg-success"
                }`}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
          </div>
          {noInput && (
            <p className="text-xs text-warning">
              마이크 입력이 감지되지 않습니다 — 마이크 연결·음소거·브라우저 권한을
              확인해 주세요. (전사 결과는 약 20초 단위로 아래에 표시됩니다)
            </p>
          )}

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

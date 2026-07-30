"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { notify } from "@/app/components/Dialog";
import { useVoiceInput } from "@/app/interview/[token]/use-voice-input";
import {
  idbAppendChunk,
  idbCompleteSession,
  idbDeleteSession,
  idbStartSession,
  uploadLiveRecording,
  type LiveRecSession,
} from "./live-recording-store";

// 준실시간 라이브 면접 레코더 — 브라우저 STT(Web Speech API) 로 말하는 즉시 받아쓰기하고,
// 잠깐 멈출 때마다(=발화 경계) 그 사이 쌓인 원문만 서버→LLM 으로 보내 화자(면접관/지원자)별로
// 정리한다. 즉시 보이는 원문 위에 정리된 전사가 몇 초 간격으로 따라붙는다.
//
// A안: 화면 받아쓰기(Web Speech)와 **병행**으로 오디오를 MediaRecorder 로 녹음해 IndexedDB 에
// 청크로 쌓는다. 종료 시 그 오디오를 서버에 올려 Gemini 로 **재전사**한 결과가 최종 리포트의
// 근거가 된다 — 라이브 인식이 뭉개져도(말 많음·화자 다수) 리포트 품질은 영향받지 않는다.
// IndexedDB 에 있으므로 업로드 도중 새로고침해도 유실 없이 재개된다. 설계: docs/LIVE_INTERVIEW_PLAN.md

// 서버 MIN_INTERVIEW_DURATION_SECONDS(5분) 와 동기 — 이보다 짧은 라이브 녹음은 오녹음으로 보고
// 종료 시 오디오 업로드·평가·과금을 전부 건너뛴다(서버 finish 게이트가 too_short 실패로 마킹).
const MIN_INTERVIEW_DURATION_SECONDS = 300;

// Opus 48kbps mono — 파트당 8분이라 파트 1건 ≈ 2.9MB(서버 18MB 한도에 여유). 24kbps 에서
// 올린 이유: 저비트레이트가 목소리의 스펙트럼 특성을 깎아 화자 분리를 어렵게 한다.
const AUDIO_BITS_PER_SECOND = 48_000;
// 5초마다 청크 → IndexedDB 적재(새로고침을 견디게). 마지막 청크는 stop 시 flush.
const CHUNK_TIMESLICE_MS = 5_000;
// 8분마다 MediaRecorder 를 stop/start 해 **완결 파일 1개**(=파트)를 만든다. 파트별로 따로
// 전사해야 긴 면접에서 발화 뭉침·뒷부분 누락이 안 생긴다(2026-07-30 운영 실측 — 42분 단일
// 요청이 61턴으로 뭉치고, 30분은 뒤 22% 가 통째로 빠졌다). 서버 LIVE_AUDIO_PART_SECONDS 와
// MAX_AUDIO_PARTS 의 클라이언트 복제(기존 MAX_AUDIO_BYTES 패턴 — 서버 유틸을 번들에 안 끌어옴).
const AUDIO_PART_MS = 480_000;
const MAX_AUDIO_PARTS = 16;

// 브라우저가 지원하는 오디오 컨테이너 선택 (Chrome/Edge=webm/opus, Safari=mp4).
function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const prefs = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const m of prefs) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* isTypeSupported 미구현 브라우저 — 무시 */
    }
  }
  return "";
}

type CleanSeg = {
  seq: number;
  role: "candidate" | "interviewer" | "unknown";
  text: string;
};

const MAX_SUGGESTIONS = 5; // 추천 질문은 최대 5개까지 누적
// 추천질문 호출 게이트 — 직전 호출 이후 정리된 전사가 이만큼 늘어야 다시 물어본다.
// 45초 타이머는 대화가 없어도 계속 돌기 때문에, 이 게이트가 없으면 같은 전사로 같은 질문을
// 반복해서 뽑느라 LLM 비용만 나간다(침묵·짧은 응답 구간).
const SUGGEST_MIN_NEW_CHARS = 200;

// 연속 같은 화자 세그먼트를 한 묶음으로 — 문장 단위로 끊긴 전사를 화자별로 합쳐 보여준다.
function groupByRole<T extends { role: unknown }>(
  segs: T[]
): { role: T["role"]; segs: T[] }[] {
  const groups: { role: T["role"]; segs: T[] }[] = [];
  for (const s of segs) {
    const last = groups[groups.length - 1];
    if (last && last.role === s.role) last.segs.push(s);
    else groups.push({ role: s.role, segs: [s] });
  }
  return groups;
}

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
  // 대면(같은 방, 마이크 1개) vs 온라인(화상, 화면 공유 오디오로 상대 목소리 캡처).
  const [mode, setMode] = useState<"inperson" | "online">("inperson");

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
  // 추천질문 호출 게이트 — 정리된 전사 총 글자수와, 마지막으로 추천을 받아온 시점의 글자수.
  const transcriptCharsRef = useRef(0);
  const lastSuggestCharsRef = useRef(0);

  // A안 병행 오디오 녹음.
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioOkRef = useRef(false); // 병행 녹음 성공 여부(실패 시 텍스트 폴백)
  const audioMimeRef = useRef("audio/webm");
  const appendChainRef = useRef<Promise<void>>(Promise.resolve()); // 청크 IndexedDB 적재 순차 체인
  // 파트 분할(8분) — 현재 파트 번호 / 그 파트의 세션 시작 기준 오프셋 / 회전 타이머.
  const partIndexRef = useRef(0);
  const partOffsetRef = useRef(0);
  const partTimerRef = useRef<number | null>(null);
  // 온라인 모드 전용: 화면 공유(상대 오디오) 스트림 + 마이크와 믹싱하는 AudioContext.
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

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

  // 같은 목적의 ref 동기화 — 추천질문 호출 게이트가 "새 발화량"을 보고 판단한다.
  useEffect(() => {
    transcriptCharsRef.current = cleaned.reduce((a, c) => a + c.text.length, 0);
  }, [cleaned]);

  const cleanup = () => {
    voice.stop();
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    if (suggestTimerRef.current) window.clearInterval(suggestTimerRef.current);
    if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
    if (partTimerRef.current) window.clearTimeout(partTimerRef.current);
    flushTimerRef.current = null;
    suggestTimerRef.current = null;
    elapsedTimerRef.current = null;
    partTimerRef.current = null;
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    // 마이크·레코더 해제 (언마운트 시). 진행 중이던 오디오는 IndexedDB 에 남는다.
    try {
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") mr.stop();
    } catch {
      /* 비치명적 */
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
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
    // 직전 호출 이후 새 발화가 거의 없으면 건너뛴다. 45초 타이머는 대화가 없어도 계속 도는데,
    // 같은 전사로 다시 물어봐야 같은 질문만 나온다(호출당 LLM 비용만 나감).
    const chars = transcriptCharsRef.current;
    if (chars - lastSuggestCharsRef.current < SUGGEST_MIN_NEW_CHARS) return;
    const prevMark = lastSuggestCharsRef.current;
    lastSuggestCharsRef.current = chars;
    try {
      const have = encodeURIComponent(suggestionsRef.current.join("\n"));
      const r = await fetch(
        `/api/candidates/${candidateId}/recorded-interview/live?riId=${riId}&have=${have}`
      );
      if (!r.ok) {
        lastSuggestCharsRef.current = prevMark; // 실패는 소비로 치지 않는다 — 다음 주기에 재시도.
        return;
      }
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
      lastSuggestCharsRef.current = prevMark;
    }
  };

  // 파트 1개 녹음 시작. MediaRecorder 의 timeslice 조각은 첫 조각만 헤더가 있어 임의 지점부터
  // 조립할 수 없다 — 그래서 파트 경계마다 stop/start 로 **완결 파일**을 새로 연다.
  const startPartRecorder = (riId: number, stream: MediaStream): string => {
    const chosen = pickAudioMime();
    const mr = new MediaRecorder(
      stream,
      chosen
        ? { mimeType: chosen, audioBitsPerSecond: AUDIO_BITS_PER_SECOND }
        : { audioBitsPerSecond: AUDIO_BITS_PER_SECOND }
    );
    audioMimeRef.current = mr.mimeType || chosen || "audio/webm";
    const part = partIndexRef.current;
    const offsetMs = partOffsetRef.current;
    mr.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        // 순차 체인 — 마지막 청크까지 커밋 순서 보존(종료 시 이 체인을 await).
        appendChainRef.current = appendChainRef.current
          .then(() => idbAppendChunk(riId, e.data, part, offsetMs))
          .catch(() => {});
      }
    };
    mr.start(CHUNK_TIMESLICE_MS);
    mediaRecorderRef.current = mr;
    if (partIndexRef.current + 1 < MAX_AUDIO_PARTS) {
      partTimerRef.current = window.setTimeout(
        () => void rotatePart(riId, stream),
        AUDIO_PART_MS
      );
    }
    return audioMimeRef.current;
  };

  // 파트 회전 — 현재 레코더를 닫고(그 파일 완결) 다음 파트를 연다. 경계의 공백은 수십 ms 수준.
  const rotatePart = async (riId: number, stream: MediaStream): Promise<void> => {
    partTimerRef.current = null;
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive" || doneRef.current) return;
    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
      try {
        mr.stop();
      } catch {
        resolve();
      }
    });
    if (doneRef.current) return;
    partIndexRef.current += 1;
    partOffsetRef.current = Date.now() - sessionStartRef.current;
    try {
      startPartRecorder(riId, stream);
    } catch {
      // 새 파트를 못 열면 이후 오디오는 유실되지만, 이미 저장된 파트로 평가는 진행된다.
      mediaRecorderRef.current = null;
    }
  };

  // 병행 오디오 녹음 시작 — 실패(권한 거부 등)해도 라이브 화면은 계속되고, 종료 시 텍스트로 폴백.
  // displayStream 이 있으면(온라인 모드) 마이크(면접관)와 화면 공유 오디오(지원자)를 Web Audio 로
  // 한 트랙으로 믹싱해 녹음한다 — 종료 시 이 믹싱 오디오를 재전사해 양쪽 발언이 평가에 담긴다.
  const startAudioCapture = async (
    riId: number,
    displayStream: MediaStream | null
  ) => {
    audioOkRef.current = false;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
      return;
    try {
      // 후처리(에코 제거·노이즈 억제·자동이득)를 끈다 — 대면 면접엔 스피커 출력이 없어 에코가
      // 없고, 이 필터들이 목소리를 균질화해 화자 분리를 방해한다. 원음이 전사·분리 모두 유리.
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      mediaStreamRef.current = micStream;

      // 녹음할 스트림 — 대면은 마이크 그대로, 온라인은 마이크+화면오디오 믹싱 결과.
      let recordStream: MediaStream = micStream;
      if (displayStream) {
        const dispAudio = displayStream.getAudioTracks();
        // 사용자가 브라우저 '공유 중지'를 누르면 상대 오디오가 끊긴다 — 자동 종료 처리.
        if (dispAudio[0]) {
          dispAudio[0].addEventListener("ended", () => {
            if (!doneRef.current) {
              setPhase("finishing");
              void doFinish();
            }
          });
        }
        try {
          const AC =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          const ac = new AC();
          audioContextRef.current = ac;
          // 자동재생 정책으로 suspended 상태면 오디오가 흐르지 않아 무음이 녹음된다 — 명시적 resume.
          void ac.resume().catch(() => {});
          const dest = ac.createMediaStreamDestination();
          ac.createMediaStreamSource(micStream).connect(dest);
          if (dispAudio[0]) {
            ac
              .createMediaStreamSource(new MediaStream([dispAudio[0]]))
              .connect(dest);
          }
          recordStream = dest.stream;
        } catch {
          // 믹싱 실패 시 최소한 마이크(면접관)만이라도 녹음 — 상대 목소리는 빠질 수 있음.
          recordStream = micStream;
        }
      }

      appendChainRef.current = Promise.resolve();
      partIndexRef.current = 0;
      partOffsetRef.current = 0;
      const mime = startPartRecorder(riId, recordStream);
      const session: LiveRecSession = {
        riId,
        candidateId,
        round,
        mime,
        state: "recording",
        durationSeconds: 0,
        createdAt: Date.now(),
      };
      await idbStartSession(session);
      audioOkRef.current = true;
    } catch {
      audioOkRef.current = false;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      mediaRecorderRef.current = null;
    }
  };

  // 녹음 중지 + 마지막 청크(dataavailable)까지 IndexedDB 커밋 완료 대기 + 마이크 해제.
  const stopAudioCapture = async (): Promise<void> => {
    if (partTimerRef.current) {
      window.clearTimeout(partTimerRef.current);
      partTimerRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (mr && mr.state !== "inactive") {
      await new Promise<void>((resolve) => {
        mr.onstop = () => resolve();
        try {
          mr.stop();
        } catch {
          resolve();
        }
      });
    }
    try {
      await appendChainRef.current;
    } catch {
      /* 비치명적 */
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const start = async () => {
    setErr(null);
    setCleaned([]);
    setRawTail("");
    setSuggestions([]);
    suggestionsRef.current = [];
    setPhase("starting");
    const online = mode === "online";

    // 대면은 브라우저 STT(실시간 받아쓰기)가 핵심 — 미지원 브라우저면 중단.
    if (!online && !voice.supported) {
      setErr(
        "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome·Edge·Safari 를 권장합니다."
      );
      setPhase("idle");
      return;
    }
    // 온라인은 화면(탭/시스템) 오디오 캡처가 필수.
    if (
      online &&
      (typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getDisplayMedia)
    ) {
      setErr(
        "이 브라우저는 화면 오디오 캡처를 지원하지 않습니다. 온라인 모드는 Chrome·Edge 데스크톱을 권장합니다."
      );
      setPhase("idle");
      return;
    }

    // 온라인: 서버 세션을 만들기 전에 화면 오디오부터 확보 — 여기서 실패하면 세션을 안 만든다
    // (recording 상태 row 가 남아 '처리 중' 카드로 뜨는 것 방지).
    let displayStream: MediaStream | null = null;
    if (online) {
      try {
        const disp = await navigator.mediaDevices.getDisplayMedia({
          video: true, // 오디오 공유 체크박스가 뜨려면 video 요청이 필요(브라우저 정책)
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        // 비디오는 쓰지 않는다(오디오만 필요) — 즉시 정지.
        disp.getVideoTracks().forEach((t) => t.stop());
        if (disp.getAudioTracks().length === 0) {
          disp.getTracks().forEach((t) => t.stop());
          throw new Error("NO_DISPLAY_AUDIO");
        }
        displayStream = disp;
      } catch (e) {
        setPhase("idle");
        setErr(
          e instanceof Error && e.message === "NO_DISPLAY_AUDIO"
            ? "화면 공유 시 '시스템 오디오'(또는 탭 오디오)도 함께 공유해 주세요 — 지원자 목소리가 녹음되지 않습니다. 다시 시도해 주세요."
            : "화면 공유가 취소되었습니다. 온라인 모드는 화면(탭/시스템) 오디오 공유가 필요합니다."
        );
        return;
      }
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
      displayStreamRef.current = displayStream; // cleanup 대상 등록(온라인만 non-null)

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
      // 병행 오디오 녹음 시작(A안). 온라인이면 마이크+화면오디오를 믹싱해 녹음.
      await startAudioCapture(riIdRef.current, displayStream);
      setPhase("recording");
      // 실시간 받아쓰기·화자정리·추천질문은 대면 전용 — 온라인은 녹음만 하고 종료 후 평가.
      if (!online) voice.start(); // 브라우저 STT 시작

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
      if (!online) {
        suggestTimerRef.current = window.setInterval(() => {
          // 백그라운드 탭에서는 LLM 추천 질문 폴링 스킵.
          if (document.visibilityState === "visible") void pollSuggestion();
        }, 45_000);
      }
    } catch (e) {
      if (displayStream) displayStream.getTracks().forEach((t) => t.stop());
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

    // 5분 미만 = 오녹음 — 오디오 업로드·평가·과금을 전부 스킵. IndexedDB 오디오는 폐기하고,
    // 서버 recording 행은 finish(too_short)로 실패 마킹시킨다(실패 카드로 노출). 정상 면접이었다면
    // 사용자가 다시 진행하면 된다.
    if (durationSeconds < MIN_INTERVIEW_DURATION_SECONDS) {
      await stopAudioCapture().catch(() => {});
      await idbDeleteSession(riId).catch(() => {});
      try {
        await fetch(`/api/candidates/${candidateId}/recorded-interview/live`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "finish",
            recordedInterviewId: riId,
            durationSeconds,
          }),
        });
      } catch {
        /* 서버 마킹 실패는 비치명적 — recording 행이 남아도 무해(과금 없음) */
      }
      notify(
        "녹음이 5분 미만이라 평가하지 않았습니다. 정상적인 면접이었다면 다시 진행해 주세요.",
        { title: "녹음이 너무 짧음", tone: "danger" }
      );
      onFinished();
      onClose();
      return;
    }

    // ── A안 주 경로: 병행 녹음한 오디오를 올려 재전사·평가 ──────────────────────
    // 라이브 화면의 Web Speech 초안이 아니라 이 오디오가 최종 리포트의 근거가 된다.
    // 업로드는 백그라운드 큐로 넘어가므로, 이후 화면을 닫거나 새로고침해도 된다.
    if (audioOkRef.current) {
      await stopAudioCapture();
      await idbCompleteSession(riId, durationSeconds);
      const session: LiveRecSession = {
        riId,
        candidateId,
        round,
        mime: audioMimeRef.current,
        state: "complete",
        durationSeconds,
        createdAt: Date.now(),
      };
      let result: Awaited<ReturnType<typeof uploadLiveRecording>>;
      try {
        result = await uploadLiveRecording(session);
      } catch {
        result = "retry";
      }
      if (result !== "empty") {
        if (result === "uploaded") {
          notify(
            "녹음 업로드 완료 — 전사·평가는 백그라운드에서 진행됩니다. 이 화면을 닫거나 새로고침해도 됩니다.",
            { title: "완료", tone: "success" }
          );
        } else if (result === "retry") {
          // 오디오는 IndexedDB 에 안전하게 남아, 이 페이지를 다시 열면 자동 재개된다.
          notify(
            "녹음은 저장됐지만 업로드가 지연되고 있습니다 — 이 페이지를 다시 열면 자동으로 업로드를 재개합니다.",
            { title: "업로드 지연", tone: "info" }
          );
        } else {
          notify(
            "녹음 업로드에 실패했습니다(파일 문제). 위 '녹음 업로드' 로 파일을 다시 올려 주세요.",
            { title: "업로드 실패", tone: "danger" }
          );
        }
        onFinished();
        onClose();
        return;
      }
      // result === "empty" — 오디오가 비어 있음(캡처 실패) → 아래 텍스트 폴백.
    }

    // ── 폴백: 오디오가 없으면 라이브 초안 세그먼트로 즉시 평가(기존 동작) ────────────
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
          {/* 대면 / 온라인 선택 — 방식에 따라 캡처·표시가 달라진다. */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
              면접 방식
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode("inperson");
                  setErr(null);
                }}
                aria-pressed={mode === "inperson"}
                className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  mode === "inperson"
                    ? "border-primary bg-primary-soft/50 ring-1 ring-primary/30"
                    : "border-border-default bg-card hover:bg-surface-alt"
                }`}
              >
                <span className="block text-sm font-medium text-ink">대면</span>
                <span className="block text-xs text-ink-muted mt-0.5 leading-snug">
                  같은 공간에서 노트북 마이크로 진행. 실시간 화자 분리·추천 질문
                  제공.
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("online");
                  setErr(null);
                }}
                aria-pressed={mode === "online"}
                className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  mode === "online"
                    ? "border-primary bg-primary-soft/50 ring-1 ring-primary/30"
                    : "border-border-default bg-card hover:bg-surface-alt"
                }`}
              >
                <span className="block text-sm font-medium text-ink">
                  온라인 (화상)
                </span>
                <span className="block text-xs text-ink-muted mt-0.5 leading-snug">
                  Zoom 등 화상 면접. 화면 공유로 상대 목소리까지 녹음. 녹음만
                  진행.
                </span>
              </button>
            </div>
          </div>

          {mode === "inperson" ? (
            <p className="text-[15px] text-ink-soft leading-relaxed">
              노트북 마이크로 <strong>대면 면접</strong>을 기록합니다. 말하면{" "}
              <strong>바로 화면에 텍스트</strong>가 뜨고, 잠깐 멈출 때마다
              화자(면접관/지원자)별로 정리됩니다. 시작하면 마이크 권한을 허용해
              주세요. 진행 중 <strong>이 탭을 닫지 마세요.</strong>
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[15px] text-ink-soft leading-relaxed">
                <strong>온라인 면접</strong>을 기록합니다. 지원자 목소리는
                스피커·헤드폰으로 나오기 때문에, 기술적인 이유로{" "}
                <strong>화면 공유에 담긴 소리를 통해서만</strong> 녹음할 수 있어요.
                그래서 시작하면 화면 공유 창이 한 번 뜹니다.
              </p>
              <p className="text-[15px] text-ink-soft leading-relaxed">
                화면은 <strong>무엇을 골라도 괜찮아요</strong> — 전체 화면을 골라도
                됩니다. 중요한 건 화면이 아니라 <strong>소리</strong>거든요. 공유 창
                아래쪽의 <strong>‘시스템 오디오 공유’</strong>(Zoom을 브라우저 탭으로
                쓰면 ‘탭 오디오’)를 <strong>꼭 켜 주세요.</strong> 이것만 켜져 있으면
                지원자 목소리가 녹음됩니다. 공유한 화면 영상은 저장하지 않고 소리만
                씁니다. 진행 중 <strong>이 탭을 닫지 마세요.</strong>
              </p>
              <div className="rounded-lg border border-warning/30 bg-warning-soft/40 px-3 py-2.5 text-sm text-ink-soft leading-relaxed">
                온라인 모드에서는{" "}
                <strong>실시간 화자 분리와 추천 질문이 제공되지 않습니다</strong> —
                녹음만 진행되고 <strong>평가 리포트는 면접 종료 후 생성</strong>
                됩니다. (양쪽 목소리가 모두 녹음되어 평가 정확도는 대면과
                동일합니다.) Chrome·Edge 데스크톱 권장.
              </div>
            </div>
          )}
          <p className="text-xs text-ink-muted">
            정확한 평가를 위해 음성이 녹음되어 전사에만 쓰이며, 전사 직후
            폐기됩니다(보관하지 않음).
          </p>
          {err && <p className="text-sm text-danger">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={start}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium shadow-sm inline-flex items-center gap-1.5"
            >
              <Mic className="w-4 h-4" />
              {mode === "online" ? "화면 공유하고 녹음 시작" : "녹음 시작"}
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
              className="px-4 py-2 rounded-lg bg-danger hover:opacity-90 text-white text-sm font-medium shadow-sm inline-flex items-center gap-1.5"
            >
              <Square className="w-4 h-4" fill="currentColor" />
              면접 종료
            </button>
          </div>

          {err && <p className="text-xs text-warning">{err}</p>}

          {mode === "online" ? (
            /* 온라인: 실시간 화자분리·추천질문 없이 '녹음 중' 표시만. 평가는 종료 후. */
            <div className="space-y-3">
              <div className="rounded-lg border border-border-default bg-card p-4 space-y-2">
                <p className="flex items-center gap-2 text-sm text-ink">
                  <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
                  화면 공유 오디오로{" "}
                  <strong>양쪽(면접관·지원자) 목소리를 녹음 중</strong>입니다.
                </p>
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  온라인 모드에서는 실시간 화자 분리·추천 질문이 표시되지 않습니다.
                  면접이 끝나면 <strong>면접 종료</strong>를 눌러 주세요 — 녹음을
                  재전사해 평가 리포트를 생성합니다. 화면 공유를 중지하면 자동으로
                  종료됩니다.
                </p>
              </div>
              <p className="text-[11px] text-ink-muted">
                음성은 종료 후 재전사에만 쓰이며 전사 직후 폐기됩니다.{" "}
                <strong>최대 1시간까지 녹음되며, 지나면 자동 종료됩니다.</strong>
              </p>
            </div>
          ) : (
            <>
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
                      화자별로 정리된 대화가 여기에 쌓입니다. (아래 실시간 인식이
                      먼저 뜹니다)
                    </p>
                  ) : (
                    groupByRole(cleaned).map((g) => (
                      <div key={g.segs[0].seq} className="flex gap-2">
                        <span
                          className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded h-fit ${
                            g.role === "candidate"
                              ? "bg-card text-info border border-info/40"
                              : "bg-surface-alt text-ink-soft border border-border-default"
                          }`}
                        >
                          {roleKo(g.role)}
                        </span>
                        <span className="text-ink">
                          {g.segs.map((s) => s.text).join(" ")}
                        </span>
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
                      <span className="text-ink-muted italic">
                        {voice.interim}
                      </span>
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
                        onClick={() => {
                          setSuggestions((prev) => {
                            const next = prev.filter((x) => x !== q);
                            suggestionsRef.current = next; // 폴링 클로저가 즉시 최신값 읽도록
                            return next;
                          });
                          // 45초 폴링을 안 기다리고 즉시 빈자리를 다시 채운다.
                          void pollSuggestion();
                        }}
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
                실시간 인식은 즉시, 화자 구분 정리는 몇 초 간격으로 따라붙습니다.
                종료 시 녹음된 음성을 다시 전사해 더 정확한 평가 리포트를 만들며,
                음성은 전사 직후 폐기됩니다.{" "}
                <strong>최대 1시간까지 녹음되며, 지나면 자동 종료됩니다.</strong>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

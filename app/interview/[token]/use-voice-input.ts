/**
 * Web Speech API 기반 음성 입력 hook.
 *
 * 브라우저별 지원:
 *   - Chrome, Edge, Safari: ✓ (한국어 ko-KR 인식 정확)
 *   - Firefox: ✗ (현재 미지원)
 *   - iOS Safari: ✓ (다만 첫 호출 시 사용자가 시작 동작 명시 필요 — 버튼 클릭은 OK)
 *
 * 사용:
 *   const { supported, listening, interim, start, stop, error } = useVoiceInput({
 *     lang: "ko-KR",
 *     onFinalText: (t) => setInput((prev) => prev ? prev + " " + t : t),
 *   });
 *
 * 동작:
 *   - start(): 마이크 권한 요청 → 듣기 시작. interim(중간) 텍스트는 listening 중 갱신.
 *   - 사용자가 한참 말을 멈추면 자동으로 final 처리 → onFinalText 호출 (input 누적)
 *   - stop(): 명시적 종료.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }> & { length: number };
};

type Win = typeof window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function getCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as Win;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type UseVoiceInputOpts = {
  lang?: string;
  onFinalText: (text: string) => void;
};

export function useVoiceInput({
  lang = "ko-KR",
  onFinalText,
}: UseVoiceInputOpts) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const stoppingRef = useRef(false);

  useEffect(() => {
    setSupported(!!getCtor());
  }, []);

  const start = useCallback(() => {
    // 에러 문구 한/영 분기 — lang 은 "ko-KR"/"en-US" 형식. 로직·재시작 동작은 동일, 문구만 변경.
    const en = lang.startsWith("en");
    setError(null);
    const Ctor = getCtor();
    if (!Ctor) {
      setError(
        en
          ? "This browser does not support voice input. (Chrome/Edge/Safari recommended)"
          : "이 브라우저는 음성 입력을 지원하지 않습니다. (Chrome/Edge/Safari 권장)"
      );
      return;
    }
    // 기존 인스턴스 정리 — stoppingRef 먼저 true 로 만들어 onend 자동재시작 차단
    if (recRef.current) {
      stoppingRef.current = true;
      const old = recRef.current;
      recRef.current = null;
      try {
        old.abort();
      } catch {
        /* ignore */
      }
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let interimAcc = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0].transcript;
        if (r.isFinal) {
          if (t.trim()) onFinalText(t.trim());
        } else {
          interimAcc += t;
        }
      }
      setInterim(interimAcc);
      // 인식 결과가 돌아왔다 = 정상 동작 = 이전 일시 오류(network 등) 문구 제거.
      // network 오류는 onend 자동재시작으로 복구되는데 error 문구가 남아 있던 버그 방지.
      setError(null);
    };
    rec.onerror = (e) => {
      const map: Record<string, string> = en
        ? {
            "not-allowed":
              "Microphone access was denied. Please allow it in your browser settings.",
            "service-not-allowed": "The speech recognition service is blocked.",
            "no-speech": "", // 자주 발생 — 자동 재시작에 의존하므로 알림 X
            "audio-capture": "No microphone device was found.",
            network: "Speech recognition network error.",
            aborted: "",
          }
        : {
            "not-allowed": "마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.",
            "service-not-allowed": "음성 인식 서비스가 차단되어 있습니다.",
            "no-speech": "", // 자주 발생 — 자동 재시작에 의존하므로 알림 X
            "audio-capture": "마이크 장치를 찾을 수 없습니다.",
            network: "음성 인식 네트워크 오류.",
            aborted: "",
          };
      const msg = map[e.error] ?? (en ? `Voice input error: ${e.error}` : `음성 입력 오류: ${e.error}`);
      if (msg) setError(msg);
      // 권한 거부 류는 즉시 정지 처리
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        stoppingRef.current = true;
        recRef.current = null;
        setListening(false);
        setInterim("");
      }
    };
    rec.onend = () => {
      // 사용자가 명시적으로 stop() 호출했거나, 다른 rec 으로 교체되었으면 종료 처리
      if (stoppingRef.current || recRef.current !== rec) {
        setListening(false);
        setInterim("");
        return;
      }
      // Chrome 등이 ~60초 후 자동 종료 — 같은 세션 유지 위해 재시작 시도
      try {
        rec.start();
        // listening 은 유지 (true)
      } catch {
        // 이미 종료/이중호출 — 정리
        recRef.current = null;
        setListening(false);
        setInterim("");
      }
    };
    recRef.current = rec;
    stoppingRef.current = false;
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      recRef.current = null;
    }
  }, [lang, onFinalText]);

  const stop = useCallback(() => {
    // 1. 자동재시작 차단 플래그 먼저
    stoppingRef.current = true;
    // 2. recRef 비우기 — onend 가 비동기로 발화해도 == rec 검사 실패 → 재시작 안 됨
    const rec = recRef.current;
    recRef.current = null;
    // 3. abort 가 stop 보다 안전 — 즉시 종료 + 보류된 결과 폐기
    if (rec) {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      // 일부 환경에서 abort 가 onend 를 안 부르는 경우 대비 — 동기적으로도 정리
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
    }
    setListening(false);
    setInterim("");
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      const rec = recRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return { supported, listening, interim, start, stop, error };
}

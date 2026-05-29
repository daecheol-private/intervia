import type { InterviewMessage } from "@/lib/schema";
import type { TranscriptStats } from "@/lib/prompts";

/**
 * 면접 대화록(messages)에서 평가 LLM 에 넘길 객관 통계 + 외부 LLM 보조 의심 신호를 집계한다.
 *
 * 신호 출처: 클라이언트가 각 사용자 턴에 실어 보낸 `inputSignals`
 * (붙여넣기/타이핑/탭이탈/질문복사 시도). complete · reevaluate 가 동일 로직을
 * 쓰도록 한 곳으로 모음 — 두 경로의 점수·노트 일관성 보장.
 */
export function computeTranscriptStats(
  messages: InterviewMessage[]
): TranscriptStats {
  const userMsgs = messages.filter((m) => m.role === "user");
  const candidateChars = userMsgs.reduce(
    (sum, m) => sum + m.content.trim().length,
    0
  );

  let pastedChars = 0;
  let typedChars = 0;
  let pasteEvents = 0;
  let blurEvents = 0;
  let copyAttempts = 0;
  for (const m of userMsgs) {
    const s = m.inputSignals;
    if (!s) continue;
    pastedChars += s.pastedChars ?? 0;
    typedChars += s.typedChars ?? 0;
    pasteEvents += s.pasteCount ?? 0;
    blurEvents += s.blurCount ?? 0;
    copyAttempts += s.copyAttempts ?? 0;
  }

  const totalInputChars = pastedChars + typedChars;
  const pasteRatio = totalInputChars > 0 ? pastedChars / totalInputChars : 0;
  // 의심 판정 — 셋 중 하나라도 임계 초과면 suspicious.
  //   · 붙여넣기 비율 60%+ & 200자+ (단순 메모 붙여넣기와 구분)
  //   · 질문 복사 시도 2회+ (질문을 외부로 옮기려 한 정황)
  //   · 탭/창 이탈 3회+ (답변 중 외부 도구 참조 정황)
  const suspicious =
    (pasteRatio >= 0.6 && pastedChars >= 200) ||
    copyAttempts >= 2 ||
    blurEvents >= 3;

  return {
    totalTurns: messages.length,
    candidateTurns: userMsgs.length,
    candidateChars,
    candidateAvgChars: userMsgs.length
      ? Math.round(candidateChars / userMsgs.length)
      : 0,
    interviewerTurns: messages.length - userMsgs.length,
    llmAssistSignal: {
      pasteEvents,
      pastedChars,
      typedChars,
      pasteRatio: Math.round(pasteRatio * 100) / 100,
      blurEvents,
      copyAttempts,
      suspicious,
    },
  };
}

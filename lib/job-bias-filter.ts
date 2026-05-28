/**
 * 채용 평가 가이드 (evaluationFocus) 의 차별 항목 사전 필터.
 *
 * 채용절차의공정화에관한법률 제4조의3 + 남녀고용평등법 제7조 + 고용상연령차별금지법 등에 따라
 * 채용 평가 시 성별·나이·결혼·출신지·종교·외모 등을 사유로 한 차별이 금지된다.
 * LLM 프롬프트 안에 "무시하라" 지시만 두는 것은 우회 위험 — 입력 단계에서 라인 단위 차단.
 *
 * 단순 substring 매칭이라 false positive 가능 (예: "연령대별 사용자 경험"). 그래도 입력은 채용
 * 담당자가 직접 검토 후 제출하는 텍스트라 보수적으로 차단해 안전을 우선.
 */
const BANNED_PATTERNS = [
  // 성별
  /성별/, /여성만/, /남성만/, /여자만/, /남자만/, /female only/i, /male only/i,
  // 나이/연령
  /\b\d{1,2}\s*대\b/, /\b\d{2}\s*세\b/, /연령\s*제한/, /나이\s*제한/,
  // 결혼 상태
  /기혼\s/, /\s기혼/, /^기혼/, /미혼\s/, /\s미혼/, /^미혼/, /신혼/, /결혼\s*여부/,
  // 출신지/지역
  /출신지/, /고향/, /본적/,
  // 종교
  /종교/,
  // 외모/신체
  /외모/, /얼굴/, /키\s*\d/, /몸무게/, /체중/,
  // 장애
  /장애\s*여부/, /장애인\s*제외/,
];

export function stripBiasedLines(text: string): {
  cleaned: string;
  removed: string[];
} {
  if (!text) return { cleaned: "", removed: [] };
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const ln of lines) {
    const trimmed = ln.trim();
    if (trimmed && BANNED_PATTERNS.some((re) => re.test(trimmed))) {
      removed.push(trimmed);
      continue;
    }
    kept.push(ln);
  }
  return { cleaned: kept.join("\n"), removed };
}

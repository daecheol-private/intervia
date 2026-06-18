/**
 * AI 면접 객관식 사전 문항 — 공고 단위 4지선다 사실형 문제 + 결정적 채점.
 *
 * 인성검사(lib/personality.ts)와 같은 계열의 "채팅 전 사전 단계"지만 목적이 다르다:
 * 인성검사 = 성향(무정답), 객관식 = 직무 기본기 확인(정답 있음).
 *
 * 설계 원칙(인성검사와 공유):
 * - 문항은 **공고 단위로 고정**된 한 세트 — 같은 공고 후보자 전원 동일 문제(공정성·비교가능성).
 *   LLM 이 공고 상세에서 생성하지만, 후보자별 즉석 생성이 아니라 HR 이 확정한 세트를 재사용한다.
 * - 채점은 LLM 이 아니라 이 모듈의 결정적 코드(정답 인덱스 비교) — 같은 응답이면 항상 같은 점수.
 * - 점수는 합불 평가(evaluation.overall_score)에 **미반영** — 면접 리포트의 참고 정보로만 표기
 *   (무감독·자동생성 문항을 자동 의사결정에 넣지 않는다). "LLM 도구로 풀어도 본인 역량"으로 간주.
 * - 난이도는 공고 요구 수준보다 **한 단계 낮게** 생성 — 변별이 아니라 기본기·성의 확인이 목적.
 */

/** 문항 1개. answer 는 options 의 0-기반 정답 인덱스. */
export type McqQuestion = {
  id: string;
  question: string;
  /** 항상 MCQ_OPTION_COUNT(4)개 */
  options: string[];
  /** 0 ~ options.length-1 */
  answer: number;
  /**
   * LLM 자가검증 결과 — 생성 직후 정답을 숨기고 모델이 다시 풀게 해 생성 시 정답과 일치하는지 확인.
   * false = 불일치(정답 오류·복수정답 의심) → HR 검토 화면에서 강조. undefined = 검증 안 함(레거시).
   */
  verified?: boolean;
};

/** 후보자 화면·API 로 내보내는 형태 — 정답(answer)·검증플래그 비노출(정답 추론 차단) */
export type PublicMcqQuestion = { id: string; question: string; options: string[] };

/** value: 선택한 보기 인덱스(0-기반) */
export type McqResponse = { questionId: string; chosen: number };

export const MCQ_OPTION_COUNT = 4;
/** 생성 목표 문항 수 — HR 이 검토 단계에서 일부 삭제하면 더 적어질 수 있다. */
export const MCQ_TARGET_COUNT = 15;
/** 한 세트 최대 문항 — 생성 응답 폭주·검토 부담 상한 */
export const MCQ_MAX_COUNT = 30;
/**
 * 생성 진행(mcqGeneratingAt)을 "진행 중"으로 볼 최대 경과 시간(ms).
 * 이 시간이 지나면 after() 백그라운드 작업이 중단된 것으로 보고 재생성을 허용한다(stale).
 */
export const MCQ_GEN_STALE_MS = 3 * 60 * 1000;

/** 공고에 객관식 문항 세트가 존재하는지 — 비어있지 않은 배열이면 true.
 *  (실제 면접 출제 여부는 job.mcqEnabled 토글과 AND 로 판정한다.) */
export function hasMcqQuestions(
  set: McqQuestion[] | null | undefined
): boolean {
  return Array.isArray(set) && set.length > 0;
}

export function toPublicMcq(set: McqQuestion[]): PublicMcqQuestion[] {
  return set.map(({ id, question, options }) => ({ id, question, options }));
}

/** 응답 검증 — 출제 세트와 정확히 일치해야 함. 오류 메시지 반환, 정상이면 null */
export function validateMcqResponses(
  set: McqQuestion[],
  responses: McqResponse[]
): string | null {
  const expected = new Map(set.map((q) => [q.id, q]));
  const seen = new Set<string>();
  for (const r of responses) {
    const q = expected.get(r.questionId);
    if (!q) return `알 수 없는 문항: ${r.questionId}`;
    if (seen.has(r.questionId)) return `중복 응답: ${r.questionId}`;
    if (
      !Number.isInteger(r.chosen) ||
      r.chosen < 0 ||
      r.chosen >= q.options.length
    )
      return `잘못된 응답 값: ${r.questionId}`;
    seen.add(r.questionId);
  }
  if (seen.size !== set.length) return "모든 문항에 응답해야 합니다.";
  return null;
}

export type McqResult = {
  /** 맞힌 문항 수 */
  score: number;
  /** 채점된 총 문항 수 */
  total: number;
};

/**
 * 응시 결과 스냅샷 — 세션에 저장해 리포트에서 "어떤 문항을 틀렸는지" 보여준다.
 * 응시 당시의 문항(질문·보기·정답)을 통째로 담으므로, 이후 공고 문제를 수정/삭제해도 정확하다.
 */
export type McqAnswerRecord = {
  id: string;
  question: string;
  options: string[];
  /** 정답 보기 인덱스 */
  answer: number;
  /** 응시자가 고른 보기 인덱스 (미응답 = -1) */
  chosen: number;
};

/** 결정적 채점 — 정답 인덱스 비교. 응답은 validateMcqResponses 통과를 전제로 한다. */
export function scoreMcq(
  set: McqQuestion[],
  responses: McqResponse[]
): McqResult {
  const byId = new Map(responses.map((r) => [r.questionId, r.chosen]));
  let score = 0;
  for (const q of set) {
    const chosen = byId.get(q.id);
    if (chosen != null && chosen === q.answer) score++;
  }
  return { score, total: set.length };
}

/**
 * 채점 + 응시 스냅샷 생성 (제출 시 1회). 세트 순서대로 문항·정답·응시자 선택을 기록한다.
 * 점수는 결정적(정답 인덱스 비교). 응답은 validateMcqResponses 통과를 전제.
 */
export function gradeMcq(
  set: McqQuestion[],
  responses: McqResponse[]
): { score: number; total: number; records: McqAnswerRecord[] } {
  const byId = new Map(responses.map((r) => [r.questionId, r.chosen]));
  const records: McqAnswerRecord[] = [];
  let score = 0;
  for (const q of set) {
    const chosen = byId.get(q.id) ?? -1;
    if (chosen === q.answer) score++;
    records.push({
      id: q.id,
      question: q.question,
      options: q.options,
      answer: q.answer,
      chosen,
    });
  }
  return { score, total: set.length, records };
}

/**
 * 외부 입력(LLM 생성 결과·HR 편집/삭제 결과)을 안전한 McqQuestion[] 로 정규화.
 * 형식이 깨진 문항은 버리고, options 4개·answer 범위를 강제한다. id 는 q1.. 로 재부여
 * (HR 이 일부 삭제해도 후보자 응답 매칭이 안정되도록 저장 직전 1회 재부여).
 */
export function sanitizeMcqSet(input: unknown): McqQuestion[] {
  if (!Array.isArray(input)) return [];
  const out: McqQuestion[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const question = typeof o.question === "string" ? o.question.trim() : "";
    const options = Array.isArray(o.options)
      ? o.options
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
      : [];
    const answer =
      typeof o.answer === "number" ? o.answer : Number(o.answer);
    if (!question || options.length !== MCQ_OPTION_COUNT) continue;
    if (options.some((x) => !x)) continue;
    if (!Number.isInteger(answer) || answer < 0 || answer >= MCQ_OPTION_COUNT)
      continue;
    out.push({
      id: `q${out.length + 1}`,
      question,
      options,
      answer,
      verified: typeof o.verified === "boolean" ? o.verified : undefined,
    });
    if (out.length >= MCQ_MAX_COUNT) break;
  }
  return out;
}

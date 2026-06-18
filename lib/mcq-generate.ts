/**
 * AI 면접 객관식 사전 문항 생성 오케스트레이션 (서버 전용 — LLM 호출).
 *
 * 2단계: ① JD 기반 4지선다 생성 → ② 정답 숨기고 재풀이(자가검증) → 일치 여부 표시.
 * 채점·검증 순수 로직은 lib/mcq.ts, 프롬프트는 lib/prompts.ts. 여기는 둘을 엮기만 한다.
 */
import { generateJSON } from "./gemini";
import { buildMcqGenerationPrompt, buildMcqVerificationPrompt } from "./prompts";
import { sanitizeMcqSet, toPublicMcq, type McqQuestion } from "./mcq";

export type McqJobInput = {
  company?: string | null;
  position: string;
  level: string;
  employmentType: string;
  responsibilities: string;
  requirements: string;
  idealProfile?: string;
};

/**
 * 공고 JD 로 객관식 세트 생성 + 자가검증. 저장은 호출부(라우트)가 HR 확정 후 수행한다.
 * 생성이 빈 결과면 throw. 자가검증 실패는 치명적이지 않음(verified=undefined 로 둠).
 */
export async function generateMcqSet(
  job: McqJobInput,
  count: number
): Promise<McqQuestion[]> {
  const gen = await generateJSON<{ questions?: unknown }>(
    buildMcqGenerationPrompt(job, count),
    { task: "questionGen", temperature: 0.4 }
  );
  let set = sanitizeMcqSet(gen.questions);
  if (set.length === 0) {
    throw new Error("객관식 문항 생성 결과가 비어 있습니다. 다시 시도해 주세요.");
  }

  // 자가검증 — 정답을 숨긴 공개 문항을 LLM 이 다시 풀어 생성 시 정답과 대조.
  try {
    const ver = await generateJSON<{
      answers?: Array<{ id: string; chosen: number; confident?: boolean }>;
    }>(buildMcqVerificationPrompt(toPublicMcq(set)), {
      task: "questionGen",
      temperature: 0,
    });
    const byId = new Map((ver.answers ?? []).map((a) => [a.id, a]));
    set = set.map((q) => {
      const a = byId.get(q.id);
      // 재풀이 답 == 정답 && 모델이 명확한 정답이 있다고 판단 → 통과
      const verified = a
        ? a.chosen === q.answer && a.confident !== false
        : undefined;
      return { ...q, verified };
    });
  } catch {
    // 검증 호출 실패는 무시 — HR 수동 검토가 최종 게이트.
  }

  return set;
}

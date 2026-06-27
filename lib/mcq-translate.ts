/**
 * 객관식(MCQ) 세트 영어 번역 — 영어 면접 지원자에게 보여줄 캐시 생성용(서버 전용).
 *
 * 핵심 불변식: question/options 텍스트만 번역하고 id·answer 인덱스·verified·보기 순서는
 * 그대로 둔다 → 결정적 채점(정답 인덱스 비교)이 깨지지 않는다. 번역이 형식을 어기거나
 * 실패한 항목은 원본(한국어)으로 폴백한다(빈 화면보다 한국어라도 보여주는 게 낫다).
 *
 * "생성"이 아니라 "번역"이라 빠르다(flash). 공고 단위로 1회 캐시(job_postings.mcqSetEn).
 */
import { generateJSON } from "./gemini";
import type { McqQuestion } from "./mcq";
import { hasMcqQuestions, MCQ_GEN_STALE_MS } from "./mcq";
import { db } from "./db";
import { jobPostings } from "./schema";
import { eq } from "drizzle-orm";
import { log } from "./logger";

export async function translateMcqSetToEn(
  set: McqQuestion[]
): Promise<McqQuestion[]> {
  if (set.length === 0) return [];

  const payload = set.map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
  }));

  const prompt = `You are a professional translator. Translate the following Korean job-knowledge multiple-choice questions into natural, professional English.

STRICT RULES:
- Translate ONLY the "question" text and each string inside "options".
- Keep the SAME number of options in the EXACT SAME ORDER. Never reorder, add, or drop options — the correct-answer index is tracked separately and must stay valid.
- Keep each "id" exactly as provided.
- Preserve technical terms, product names, units, and code verbatim where appropriate.
- Output ONLY a JSON array of objects {"id","question","options"} in the same order as the input.

INPUT:
${JSON.stringify(payload, null, 2)}`;

  const translated = await generateJSON<
    Array<{ id: string; question: string; options: string[] }>
  >(prompt, { task: "screening", temperature: 0 });

  const byId = new Map(translated.map((t) => [t.id, t]));

  return set.map((q) => {
    const t = byId.get(q.id);
    // 형식이 어긋난(개수 불일치·빈 문자열 등) 항목은 채점 안전을 위해 원본 유지.
    if (
      !t ||
      typeof t.question !== "string" ||
      !t.question.trim() ||
      !Array.isArray(t.options) ||
      t.options.length !== q.options.length ||
      t.options.some((o) => typeof o !== "string" || !o.trim())
    ) {
      return q;
    }
    return {
      ...q,
      question: t.question.trim(),
      options: t.options.map((o) => o.trim()),
    };
  });
}

/**
 * 공고의 영어 MCQ 캐시를 보장한다(없으면 번역해 job_postings.mcqSetEn 에 저장).
 * 멱등 — 이미 번역됐거나 다른 요청이 번역 중(stale 아님)이면 아무것도 하지 않는다.
 * English 선택(PATCH /language) 시 prefetch 로, MCQ 단계 GET 에서 백업으로 호출한다.
 * 백그라운드(after) 실행 전제 — 예외는 삼키고 진행표시만 정리한다(다음 트리거가 재시도).
 */
export async function ensureMcqTranslated(jobId: number): Promise<void> {
  const [job] = await db
    .select({
      mcqSet: jobPostings.mcqSet,
      mcqSetEn: jobPostings.mcqSetEn,
      mcqEnabled: jobPostings.mcqEnabled,
      translatingAt: jobPostings.mcqEnTranslatingAt,
    })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job || !job.mcqEnabled) return;
  if (!hasMcqQuestions(job.mcqSet)) return;
  if (hasMcqQuestions(job.mcqSetEn)) return; // 이미 캐시됨

  // 다른 요청이 번역 중(stale 아님)이면 중복 번역 방지로 skip.
  if (job.translatingAt) {
    const age = Date.now() - new Date(job.translatingAt).getTime();
    if (age >= 0 && age < MCQ_GEN_STALE_MS) return;
  }

  // 진행 마킹 — 동시 트리거 차단.
  await db
    .update(jobPostings)
    .set({ mcqEnTranslatingAt: new Date().toISOString() })
    .where(eq(jobPostings.id, jobId));
  try {
    const en = await translateMcqSetToEn(job.mcqSet!);
    await db
      .update(jobPostings)
      .set({ mcqSetEn: en, mcqEnTranslatingAt: null })
      .where(eq(jobPostings.id, jobId));
  } catch (e) {
    // 실패 시 진행표시를 비워 다음 트리거가 재시도할 수 있게 한다.
    await db
      .update(jobPostings)
      .set({ mcqEnTranslatingAt: null })
      .where(eq(jobPostings.id, jobId));
    log.error("mcq_translate_failed", {
      jobId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

import { db } from "./db";
import { candidates, jobPostings, candidateAttachments } from "./schema";
import { eq, and, isNotNull, ne } from "drizzle-orm";
import { buildScreeningPrompt } from "./prompts";
import { generateJSON } from "./gemini";
import { refundFeature } from "./tokens";

type ScreeningResult = {
  score: number;
  recommendation: "강력추천" | "추천" | "보류" | "비추천";
  summary: string;
  strengths: string[];
  concerns: string[];
  matched_keywords: string[];
  breakdown?: {
    tech_fit?: { score: number; reason: string };
    experience_depth?: { score: number; reason: string };
    role_match?: { score: number; reason: string };
    growth_attitude?: { score: number; reason: string };
  };
  interview_focus?: string[];
  career_info?: {
    career_years?: number | null;
    career_summary?: string | null;
  };
};

export class ScreeningError extends Error {
  constructor(
    message: string,
    public readonly transient: boolean
  ) {
    super(message);
  }
}

/**
 * 1건의 서류 평가 실행.
 * 성공 시 candidates 업데이트, 실패 시 ScreeningError throw.
 * 큐 워커가 호출하며 retry/refund 정책은 큐가 결정 (이 함수는 환불 X).
 *
 * @throws ScreeningError(transient=true) — 일시적 (429/503/timeout) → 큐가 재시도
 * @throws ScreeningError(transient=false) — 영구 (마스킹 텍스트 없음, JSON 파싱 실패 등)
 */
export async function runScreeningOnce(candidateId: number): Promise<void> {
  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!candidate) {
    throw new ScreeningError(`candidate ${candidateId} 없음`, false);
  }
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (!job) {
    throw new ScreeningError(`job ${candidate.jobId} 없음`, false);
  }

  const masked = candidate.resumeMaskedText ?? "";
  if (masked.length < 30) {
    throw new ScreeningError("마스킹된 이력서 텍스트 없음/부족", false);
  }

  // 첨부 (포트폴리오·자소서·기타) — maskedText 있는 것만, kind=resume 은 제외 (이력서 중복).
  const atts = await db
    .select({
      kind: candidateAttachments.kind,
      originalName: candidateAttachments.originalName,
      maskedText: candidateAttachments.maskedText,
    })
    .from(candidateAttachments)
    .where(
      and(
        eq(candidateAttachments.candidateId, candidateId),
        isNotNull(candidateAttachments.maskedText),
        ne(candidateAttachments.kind, "resume")
      )
    );
  const attachmentsForPrompt = atts
    .filter((a) => a.maskedText && a.maskedText.trim().length > 30)
    .map((a) => ({
      kind: a.kind,
      originalName: a.originalName,
      maskedText: a.maskedText as string,
    }));

  let result: ScreeningResult;
  try {
    result = await generateJSON<ScreeningResult>(
      buildScreeningPrompt(
        {
          position: job.position,
          level: job.level,
          employmentType: job.employmentType,
          responsibilities: job.responsibilities,
          requirements: job.requirements,
          idealProfile: job.idealProfile,
          tone: job.tone,
        },
        masked,
        attachmentsForPrompt
      ),
      { task: "screening" }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Gemini RPM/quota/timeout 류는 transient 으로 — 큐가 백오프 후 재시도
    const transient =
      /429|quota|rate|503|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg);
    throw new ScreeningError(msg, transient);
  }

  type UpdateFields = {
    screeningScore: number;
    screeningReport: ScreeningResult;
    careerYears?: number | null;
    careerSummary?: string | null;
    stage?: "screened";
  };
  const updateFields: UpdateFields = {
    screeningScore: result.score,
    screeningReport: result,
  };
  // 서류평가 완료 → 전형 단계도 "서류평가" 로 자동 전환.
  // 단, 운영자가 이미 면접대기/1차합격/결정 단계 등으로 진행시켰다면 건드리지 않음.
  if (candidate.stage === "applied") {
    updateFields.stage = "screened";
  }
  const ci = result.career_info ?? {};
  if (typeof ci.career_years === "number") updateFields.careerYears = ci.career_years;
  if (ci.career_summary) updateFields.careerSummary = ci.career_summary;

  await db
    .update(candidates)
    .set(updateFields)
    .where(eq(candidates.id, candidateId));
}

/** 영구 실패 시 candidate status='failed' + 토큰 환불. 큐가 호출. */
export async function markScreeningPermanentlyFailed(
  candidateId: number,
  reason: string
): Promise<void> {
  const [candidate] = await db
    .select({ orgId: candidates.orgId, name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!candidate) return;
  // 실패는 screeningJobs.status='failed' 로 추적. candidate row 는 변경 없음.
  if (candidate.orgId) {
    await refundFeature({
      orgId: candidate.orgId,
      feature: "resume_upload",
      refType: "candidate",
      refId: candidateId,
      memo: `평가 실패 자동환불: ${reason.slice(0, 100)}`,
    });
  }
}

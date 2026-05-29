import { db } from "./db";
import { candidates, jobPostings, candidateAttachments } from "./schema";
import { eq, and, isNotNull, ne } from "drizzle-orm";
import { buildScreeningPrompt } from "./prompts";
import { generateJSON } from "./gemini";
import { refundFeature } from "./tokens";
import { extractTextFromBuffer } from "./parsers";
import { extractPII } from "./pii-extract";
import { extractEducation } from "./education-extract";
import { maskText } from "./mask";
import { sanitizeResumeText } from "./prompt-safety";
import { readStoredFile } from "./storage";
import { looksLikeKoreanName } from "./file-classify";
import { log } from "./logger";

const TEXT_EXTRACTABLE = new Set(["pdf", "docx", "txt", "md", "html", "htm"]);
function extOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

/**
 * 후보자 이력서·첨부 파싱 + 마스킹 (비동기 1단계).
 *
 * 업로드 시 후보자는 "껍데기"(파일명 기반 이름 + 파싱 전)로 즉시 생성되고,
 * 무거운 텍스트 추출·PII/학력 추출·마스킹은 워커가 평가 직전에 수행한다.
 * → 100MB ZIP 업로드 시 POST 가 파싱을 기다리지 않아 카드가 즉시 뜬다.
 *
 * 멱등 — resumeMaskedText 가 이미 채워져 있으면 즉시 반환(재시도 시 중복 파싱 방지).
 *
 * @throws ScreeningError(transient=false) — 파일 파싱 실패/스캔 PDF (영구 → 환불)
 * @throws ScreeningError(transient=true)  — 저장소 일시 오류 (재시도)
 */
export async function ensureParsed(candidateId: number): Promise<void> {
  const [c] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!c) throw new ScreeningError(`candidate ${candidateId} 없음`, false);
  if (c.resumeMaskedText && c.resumeMaskedText.length >= 30) return; // 이미 파싱됨

  // 메인 이력서 첨부(kind=resume) — 파일 경로·원본명.
  const [resumeAtt] = await db
    .select({
      filePath: candidateAttachments.filePath,
      originalName: candidateAttachments.originalName,
    })
    .from(candidateAttachments)
    .where(
      and(
        eq(candidateAttachments.candidateId, candidateId),
        eq(candidateAttachments.kind, "resume")
      )
    )
    .limit(1);
  const filePath = resumeAtt?.filePath ?? c.resumeFilePath;
  const originalName = resumeAtt?.originalName ?? "resume.pdf";
  if (!filePath) throw new ScreeningError("이력서 파일 경로 없음", false);

  const buf = await readStoredFile(filePath);
  if (!buf)
    throw new ScreeningError("저장된 이력서 파일을 읽지 못했습니다.", true);

  let resumeText = "";
  try {
    resumeText = await extractTextFromBuffer(buf, originalName);
  } catch (e) {
    throw new ScreeningError(
      `파일 파싱 오류: ${e instanceof Error ? e.message : String(e)}`,
      false
    );
  }
  if (resumeText.length < 30)
    throw new ScreeningError(
      "이력서 텍스트 추출 실패 (스캔 PDF 또는 빈 파일).",
      false
    );

  const pii = extractPII(resumeText, {
    // 파일명/수동입력으로 이미 사람 이름이 잡혔으면 그걸 힌트로.
    providedName:
      c.name && c.name !== "(이름 미상)" && looksLikeKoreanName(c.name)
        ? c.name
        : null,
    providedEmail: c.email,
  });
  const education = extractEducation(resumeText);

  // 이름 승격 — 껍데기 이름이 "(이름 미상)" 일 때만 파싱 이름 사용.
  // (파일명/수동입력 이름은 파싱 이름보다 우선이라 그대로 유지.)
  const finalName = c.name === "(이름 미상)" && pii.name ? pii.name : c.name;

  const masked = maskText(resumeText, {
    level: "standard",
    known: {
      name: finalName,
      emails: [pii.email, c.email].filter(Boolean) as string[],
      phones: [pii.phone].filter(Boolean) as string[],
      companies: pii.companies,
    },
  });
  const sanitized = sanitizeResumeText(masked);
  if (sanitized.injectionAttempt) {
    log.warn("resume_injection_attempt", { candidateId, filename: originalName });
  }

  await db
    .update(candidates)
    .set({
      name: finalName,
      email: c.email || pii.email || null,
      phone: c.phone || pii.phone,
      age: c.age ?? pii.age,
      educationLevel: education.level,
      educationSchool: education.school,
      educationMajor: education.major,
      resumeMaskedText: sanitized.text,
    })
    .where(eq(candidates.id, candidateId));

  // 첨부(포트폴리오·자소서 등) 파싱+마스킹 — 텍스트 추출 가능 + 아직 미마스킹만.
  const atts = await db
    .select({
      id: candidateAttachments.id,
      filePath: candidateAttachments.filePath,
      originalName: candidateAttachments.originalName,
      kind: candidateAttachments.kind,
      maskedText: candidateAttachments.maskedText,
    })
    .from(candidateAttachments)
    .where(eq(candidateAttachments.candidateId, candidateId));
  for (const a of atts) {
    if (a.kind === "resume") continue;
    if (a.maskedText) continue;
    if (!TEXT_EXTRACTABLE.has(extOf(a.originalName))) continue;
    const abuf = await readStoredFile(a.filePath);
    if (!abuf) continue;
    try {
      const raw = await extractTextFromBuffer(abuf, a.originalName);
      if (raw.trim().length > 0) {
        const s = sanitizeResumeText(maskText(raw));
        await db
          .update(candidateAttachments)
          .set({ maskedText: s.text })
          .where(eq(candidateAttachments.id, a.id));
      }
    } catch (e) {
      log.warn("attachment_parse_failed", {
        candidateId,
        filename: a.originalName,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

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
    achievement?: { score: number; reason: string };
    stability?: { score: number; reason: string };
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
  // 1단계 — 아직 파싱 안 됐으면 여기서 파싱+마스킹 (업로드 시 껍데기로만 생성됨).
  await ensureParsed(candidateId);

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
          evaluationFocus: job.evaluationFocus,
          tone: job.tone,
        },
        masked,
        attachmentsForPrompt,
        // 학력 수준·전공만 — 출신 학교명은 전달 안 함(학벌 차별 방지, 블라인드 유지)
        { level: candidate.educationLevel, major: candidate.educationMajor }
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

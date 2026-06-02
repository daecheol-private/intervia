import { db } from "./db";
import {
  candidates,
  jobPostings,
  candidateAttachments,
  organizations,
} from "./schema";
import { eq, and, isNotNull, ne } from "drizzle-orm";
import { buildScreeningPrompt } from "./prompts";
import { parseChecklist } from "./job-checklist";
import { generateJSON, generateJSONMultimodal } from "./gemini";
import { chargeFeature } from "./tokens";
import { extractTextFromBuffer } from "./parsers";
import { extractPII } from "./pii-extract";
import { extractEducation } from "./education-extract";
import { maskText } from "./mask";
import { sanitizeResumeText } from "./prompt-safety";
import { readStoredFile } from "./storage";
import { looksLikeKoreanName } from "./file-classify";
import { log } from "./logger";
import { logAudit } from "./audit";

const TEXT_EXTRACTABLE = new Set(["pdf", "docx", "txt", "md", "html", "htm"]);
function extOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

// OCR fallback(스캔 PDF) — Gemini 멀티모달에 PDF 원본을 직접 넘겨 텍스트 추출.
// 인라인 요청 한도(Vertex ~20MB) 고려, base64 팽창(+33%) 감안해 원본 14MB 까지만 시도.
const OCR_MAX_BYTES = 14 * 1024 * 1024;

/** 법인이 스캔 PDF OCR(원본→AI 전송)을 허용했는지. orgId 없거나 미허용이면 false. */
async function orgAllowsScanOcr(orgId: number | null): Promise<boolean> {
  if (!orgId) return false;
  const [org] = await db
    .select({ allow: organizations.allowScanOcr })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return !!org?.allow;
}

/**
 * 텍스트 레이어가 없는 스캔 PDF 를 Gemini 멀티모달로 OCR.
 * 추출 실패/빈 결과면 빈 문자열 반환(호출부가 기존 에러로 폴백).
 *
 * 별도 OCR 인프라 없이 이미 쓰는 Vertex 서울 리전 flash 를 그대로 사용 →
 * 데이터 국외이전 없이(§28의8 회피 유지) 스캔 이력서도 평가 가능.
 */
async function ocrPdfToText(buf: Buffer): Promise<string> {
  if (buf.length > OCR_MAX_BYTES) return "";
  const prompt =
    "이것은 스캔된 이력서 PDF 입니다. 페이지 순서대로 본문에 적힌 모든 글자를 " +
    "빠짐없이 그대로 추출하세요. 표·머리글·날짜·회사명·기술 스택도 포함합니다. " +
    "요약·해석·번역하지 말고 원문 텍스트만, 줄바꿈을 살려 그대로 옮기세요. " +
    '응답은 반드시 {"text": "추출한 전체 텍스트"} JSON 한 개만 반환하세요.';
  try {
    const out = await generateJSONMultimodal<{ text?: string }>(
      [
        { text: prompt },
        { inlineData: { mimeType: "application/pdf", data: buf.toString("base64") } },
      ],
      { task: "screening" }
    );
    return typeof out?.text === "string" ? out.text.trim() : "";
  } catch (e) {
    log.warn("resume_ocr_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return "";
  }
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
  // 텍스트 레이어가 없는 스캔 PDF — pdf-parse 가 빈 결과를 뱉음.
  // 곧장 실패시키지 않고 Gemini 멀티모달 OCR 로 한 번 더 시도.
  // 단, OCR 은 마스킹 *전* 원본 이력서를 AI 수탁자에 전송하므로(정상 PDF 의
  // "마스킹 후 전송" 원칙과 달라짐) 법인이 명시적으로 허용(allowScanOcr)한 경우만.
  if (resumeText.length < 30 && extOf(originalName) === "pdf") {
    const allowed = await orgAllowsScanOcr(c.orgId);
    if (allowed) {
      const ocr = await ocrPdfToText(buf);
      if (ocr.length >= 30) {
        log.info("resume_ocr_recovered", { candidateId, chars: ocr.length });
        resumeText = ocr;
        // 감사 로그 — 마스킹 전 원본이 외부 AI 수탁자로 전송된 사실을 기록(분쟁 시 입증).
        logAudit(null, {
          actorRole: "system",
          action: "candidate.scan_ocr",
          resourceType: "candidate",
          resourceId: candidateId,
          orgId: c.orgId ?? null,
          metadata: { filename: originalName, chars: ocr.length },
        });
      }
    }
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

type Confidence = "high" | "medium" | "low";

type ScreeningResult = {
  score: number;
  recommendation: "강력추천" | "추천" | "보류" | "비추천";
  summary: string;
  strengths: string[];
  concerns: string[];
  matched_keywords: string[];
  breakdown?: {
    tech_fit?: { score: number; reason: string; confidence?: Confidence };
    experience_depth?: { score: number; reason: string; confidence?: Confidence };
    role_match?: { score: number; reason: string; confidence?: Confidence };
    achievement?: { score: number; reason: string; confidence?: Confidence };
    stability?: { score: number; reason: string; confidence?: Confidence };
    growth_attitude?: { score: number; reason: string; confidence?: Confidence };
  };
  requirement_gate?: {
    applies?: boolean;
    verdict?: "pass" | "fail" | "unknown";
    missing?: string[];
    reason?: string;
  };
  requirement_coverage?: Array<{
    requirement: string;
    status: "direct" | "indirect" | "none";
    evidence?: string;
  }>;
  level_match?: {
    fit?: "under" | "over" | "fit";
    years?: number | null;
    penalty?: number;
    reason?: string;
  };
  focus_match?: {
    applies?: boolean;
    verdict?: "fatal_fail" | "fail" | "neutral" | "strong_pass";
    reason?: string;
  };
  interview_focus?: string[];
  career_info?: {
    career_years?: number | null;
    career_summary?: string | null;
  };
};

// 6축 가중치 — 프롬프트(prompts.ts buildScreeningPrompt)와 반드시 일치.
const AXIS_WEIGHTS: Record<string, number> = {
  tech_fit: 0.3,
  experience_depth: 0.2,
  role_match: 0.15,
  achievement: 0.15,
  stability: 0.1,
  growth_attitude: 0.1,
};

// HR 평가 가이드(evaluationFocus) 점수 반영 — 가산점 방식.
// 6축 점수를 고정값으로 덮어쓰지 않고 가감하여, 이력서별 점수 편차를 보존한다.
// (과거: fail→49 cap / strong_pass→70 floor 로 덮어써서 점수가 49·70에 양극화되던 문제 해결)
const FOCUS_STRONG_BONUS = 12; // strong_pass → 가점
const FOCUS_FAIL_PENALTY = -12; // fail → 감점
const FOCUS_FATAL_CAP = 15; // fatal_fail(필수/배제 조건 위반)만 하드캡 유지 — 진짜 결격 사유

// JD 본문에 명시된 필수/결격 요건 미충족(requirement_gate.verdict=fail) 시 하드캡.
// HR 가이드 fatal(15)보다는 약간 높게 — "결격에 가깝지만 면접 여지" 수준. unknown 은 감점 안 함.
const REQUIREMENT_GATE_CAP = 40;

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function recommendationFor(score: number): ScreeningResult["recommendation"] {
  if (score >= 85) return "강력추천";
  if (score >= 70) return "추천";
  if (score >= 55) return "보류";
  return "비추천";
}

/**
 * 종합 점수를 코드에서 직접 재계산 — LLM 이 뱉은 score 를 신뢰하지 않는다.
 * raw = 6축 가중평균(누락 축은 가중치에서 제외 후 정규화) + level_match 페널티 → clamp.
 * → "6축은 낮은데 종합은 높은" 모순을 구조적으로 차단하고 점수 일관성을 보장.
 * breakdown 이 전혀 없으면 LLM score 로 폴백.
 */
function recomputeScore(result: ScreeningResult): {
  score: number;
  recommendation: ScreeningResult["recommendation"];
} {
  const b = result.breakdown as
    | Record<string, { score?: number } | undefined>
    | undefined;
  let weighted = 0;
  let totalW = 0;
  if (b) {
    for (const [key, w] of Object.entries(AXIS_WEIGHTS)) {
      const axis = b[key];
      if (axis && typeof axis.score === "number") {
        weighted += clampScore(axis.score) * w;
        totalW += w;
      }
    }
  }
  const raw = totalW > 0 ? weighted / totalW : clampScore(result.score);
  // 페널티는 감점만 — under=-10 / over=-5 / fit=0. 범위 밖 값은 방어적으로 클램프.
  const rawPenalty =
    typeof result.level_match?.penalty === "number"
      ? result.level_match.penalty
      : 0;
  const penalty = Math.max(-10, Math.min(0, rawPenalty));
  let score = clampScore(raw + penalty);

  // HR 평가 가이드(evaluationFocus) 반영 — 6축 점수에 가감(가산점 방식).
  // strong_pass → +가점, fail → -감점, neutral → 변동 없음.
  // fatal_fail("보안 경력 필수인데 전무" 같은 필수/배제 위반)만 결격으로 보고 하드캡 유지.
  const fm = result.focus_match;
  if (fm?.applies) {
    if (fm.verdict === "fatal_fail") score = Math.min(score, FOCUS_FATAL_CAP);
    else if (fm.verdict === "fail")
      score = clampScore(score + FOCUS_FAIL_PENALTY);
    else if (fm.verdict === "strong_pass")
      score = clampScore(score + FOCUS_STRONG_BONUS);
  }

  // JD 명시 필수 요건 미충족 → 결격 수준 하드캡. (unknown/pass 는 변동 없음)
  const rg = result.requirement_gate;
  if (rg?.applies && rg.verdict === "fail") {
    score = Math.min(score, REQUIREMENT_GATE_CAP);
  }

  return { score, recommendation: recommendationFor(score) };
}

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
          requirementChecklist: parseChecklist(job.requirementChecklist),
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

  // 종합 점수·등급은 LLM 출력을 신뢰하지 않고 6축 + 페널티로 코드가 재계산.
  // (LLM 이 6축은 낮게 줘도 종합은 후하게 주는 인플레/모순을 차단)
  const recomputed = recomputeScore(result);
  result.score = recomputed.score;
  result.recommendation = recomputed.recommendation;

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

/**
 * 평가 성공 시 과금 — 평가가 정상 완료된 시점에만 호출(워커가 markDone 직후).
 *
 * 과금 모델: enqueue 가 아니라 "성공"에 과금한다. 따라서
 *   - 오류/재시도(영구실패 포함)는 여기 도달하지 않아 과금 안 됨 (환불 로직 불필요).
 *   - 재평가는 새 screening_job 이라 refId 가 달라 매 성공마다 1건 과금.
 *   - 같은 job 의 재시도가 결국 성공해도 refId(job.id) 가 같아 멱등 — 1건만 과금.
 */
export async function chargeScreeningSuccess(
  jobId: number,
  candidateId: number
): Promise<void> {
  const [candidate] = await db
    .select({ orgId: candidates.orgId, name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!candidate?.orgId) return;
  await chargeFeature({
    orgId: candidate.orgId,
    feature: "resume_upload",
    refType: "screening_job",
    refId: jobId,
    memo: candidate.name,
  });
}

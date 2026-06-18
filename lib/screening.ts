import { db } from "./db";
import {
  candidates,
  jobPostings,
  candidateAttachments,
  organizations,
  screeningCache,
  screeningJobs,
} from "./schema";
import { eq, and, isNotNull, ne, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { deleteFilesForCandidate } from "./candidate-files";
import {
  buildScreeningPrompt,
  hasEvaluationFocus,
  type CultureFitProfile,
} from "./prompts";
import { parseChecklist } from "./job-checklist";
import { generateJSON, generateJSONMultimodal } from "./gemini";
import { Type } from "@google/genai";
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

/**
 * 첨부 1건 텍스트 추출 + 마스킹. 추출 불가 형식(이미지 등)·빈 텍스트면 null.
 * 워커(ensureParsed)와 후보자 상세 첨부 추가 라우트가 공유 — 마스킹 규칙 단일화.
 * @throws 파싱 라이브러리 오류는 그대로 전파 — 호출부가 best-effort 처리.
 */
export async function maskAttachmentText(
  buf: Buffer,
  originalName: string
): Promise<string | null> {
  if (!TEXT_EXTRACTABLE.has(extOf(originalName))) return null;
  const raw = await extractTextFromBuffer(buf, originalName);
  if (raw.trim().length === 0) return null;
  return sanitizeResumeText(maskText(raw)).text;
}

/**
 * 이력서 본문 정규화 후 SHA-256 — "내용 동일" 중복 판정용.
 * 공백·대소문자 차이를 무시해, 바이트가 달라도(재저장·재export) 본문이 같으면 같은 해시.
 */
function contentHashOf(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
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
      // 55s 하드 타임아웃 — worker maxDuration(120s)·wall-clock 가드(70s) 안에서 OCR 가
      // 무한정 매달리지 않게. 초과 시 ocrPdfToText 의 catch 가 빈 문자열을 반환하고
      // 호출부가 기존 "텍스트 추출 실패"(영구 오류 → 환불)로 폴백한다.
      { task: "screening", timeoutMs: 55_000 }
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
  const isPdf = extOf(originalName) === "pdf";
  // OCR 허용 여부 — 아래 실패 메시지 분기에서도 재사용하므로 DB 조회는 여기 1회만.
  const ocrAllowed = isPdf ? await orgAllowsScanOcr(c.orgId) : false;
  if (resumeText.length < 30 && isPdf && ocrAllowed) {
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
  if (resumeText.length < 30) {
    // 스캔(이미지) PDF 인데 법인이 OCR 미허용 → OCR 을 켜면 평가 가능함을 명시해,
    // 운영자가 "텍스트 추출 실패"만 보고 막막해하지 않게 한다.
    // (OCR 허용인데도 빈 결과면 이미 OCR 까지 시도한 것이므로 generic 메시지.)
    if (isPdf && !ocrAllowed)
      throw new ScreeningError(
        "스캔(이미지) PDF로 보여 텍스트를 추출하지 못했습니다. 법인 설정에서 스캔 PDF OCR을 활성화하면 평가할 수 있습니다.",
        false
      );
    throw new ScreeningError(
      "이력서 텍스트 추출 실패 (스캔 PDF 또는 빈 파일).",
      false
    );
  }

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
      // 내용 기반 중복 판정용 — 파싱된 *원문* 기준(마스킹 전, 바이트 무관).
      resumeContentHash: contentHashOf(resumeText),
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
      const maskedAtt = await maskAttachmentText(abuf, a.originalName);
      if (maskedAtt) {
        await db
          .update(candidateAttachments)
          .set({ maskedText: maskedAtt })
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
    // 미충족(fail) 강도 — hard: 면허·법정자격 등 진짜 결격 / soft: 학력 등 경력으로 상쇄 가능.
    severity?: "hard" | "soft";
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
  // 이력서 자체의 증거 밀도 — 구체적 경력/성과 중심인가, 역량 형용사·스킬 나열인가.
  evidence_quality?: "specific" | "mixed" | "generic";
  // JD 핵심 전문 도메인 적합 — 범용 역량과 별개로 "그 도메인을 실제로 했는가".
  domain_fit?: {
    has_specialized_domain?: boolean;
    domain?: string;
    candidate_level?: "direct" | "adjacent" | "none";
    reason?: string;
  };
  interview_focus?: string[];
  // 법인 정성 항목 검토 — 무점수 (recomputeScore 에서 사용하지 않음). 면접 인계용.
  qualitative_review?: Array<{
    item: string;
    finding: string;
    evidence?: string;
    needs_interview?: boolean;
  }>;
  career_info?: {
    career_years?: number | null;
    career_summary?: string | null;
  };
};

// Gemini 구조화 출력 스키마 — prompts.ts buildScreeningPrompt 의 "출력 형식" JSON 과 일치.
// responseMimeType=json 만으로는 긴 한국어 자유서술 필드에서 모델이 간헐적으로 깨진
// JSON 을 뱉어(이스케이프 누락 등) 파싱 실패 → "AI 응답 형식 오류" 가 발생했다.
// responseSchema 를 주면 Vertex 가 스키마에 맞는 유효 JSON 을 보장한다.
const AXIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.INTEGER },
    reason: { type: Type.STRING },
    confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
  },
  required: ["score", "reason"],
  propertyOrdering: ["score", "reason", "confidence"],
};

const SCREENING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.INTEGER },
    recommendation: {
      type: Type.STRING,
      enum: ["강력추천", "추천", "보류", "비추천"],
    },
    summary: { type: Type.STRING },
    breakdown: {
      type: Type.OBJECT,
      properties: {
        tech_fit: AXIS_SCHEMA,
        experience_depth: AXIS_SCHEMA,
        role_match: AXIS_SCHEMA,
        achievement: AXIS_SCHEMA,
        stability: AXIS_SCHEMA,
        growth_attitude: AXIS_SCHEMA,
      },
      required: [
        "tech_fit",
        "experience_depth",
        "role_match",
        "achievement",
        "stability",
        "growth_attitude",
      ],
      propertyOrdering: [
        "tech_fit",
        "experience_depth",
        "role_match",
        "achievement",
        "stability",
        "growth_attitude",
      ],
    },
    requirement_gate: {
      type: Type.OBJECT,
      properties: {
        applies: { type: Type.BOOLEAN },
        verdict: { type: Type.STRING, enum: ["pass", "fail", "unknown"] },
        severity: { type: Type.STRING, enum: ["hard", "soft"] },
        missing: { type: Type.ARRAY, items: { type: Type.STRING } },
        reason: { type: Type.STRING },
      },
      // severity 를 필수로 — verdict=fail 시 코드가 hard/soft 별로 다른 캡을 적용하므로 항상 존재해야 함.
      required: ["verdict", "severity"],
      propertyOrdering: ["applies", "verdict", "severity", "missing", "reason"],
    },
    requirement_coverage: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          requirement: { type: Type.STRING },
          status: { type: Type.STRING, enum: ["direct", "indirect", "none"] },
          evidence: { type: Type.STRING },
        },
        required: ["requirement", "status"],
        propertyOrdering: ["requirement", "status", "evidence"],
      },
    },
    level_match: {
      type: Type.OBJECT,
      properties: {
        fit: { type: Type.STRING, enum: ["under", "over", "fit"] },
        years: { type: Type.INTEGER, nullable: true },
        penalty: { type: Type.INTEGER },
        reason: { type: Type.STRING },
      },
      propertyOrdering: ["fit", "years", "penalty", "reason"],
    },
    focus_match: {
      type: Type.OBJECT,
      properties: {
        applies: { type: Type.BOOLEAN },
        verdict: {
          type: Type.STRING,
          enum: ["fatal_fail", "fail", "neutral", "strong_pass"],
        },
        reason: { type: Type.STRING },
      },
      propertyOrdering: ["applies", "verdict", "reason"],
    },
    evidence_quality: {
      type: Type.STRING,
      enum: ["specific", "mixed", "generic"],
    },
    domain_fit: {
      type: Type.OBJECT,
      properties: {
        has_specialized_domain: { type: Type.BOOLEAN },
        domain: { type: Type.STRING },
        candidate_level: {
          type: Type.STRING,
          enum: ["direct", "adjacent", "none"],
        },
        reason: { type: Type.STRING },
      },
      propertyOrdering: [
        "has_specialized_domain",
        "domain",
        "candidate_level",
        "reason",
      ],
    },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    concerns: { type: Type.ARRAY, items: { type: Type.STRING } },
    matched_keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    interview_focus: { type: Type.ARRAY, items: { type: Type.STRING } },
    qualitative_review: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item: { type: Type.STRING },
          finding: { type: Type.STRING },
          evidence: { type: Type.STRING },
          needs_interview: { type: Type.BOOLEAN },
        },
        required: ["item", "finding"],
        propertyOrdering: ["item", "finding", "evidence", "needs_interview"],
      },
    },
    career_info: {
      type: Type.OBJECT,
      properties: {
        career_years: { type: Type.INTEGER, nullable: true },
        career_summary: { type: Type.STRING, nullable: true },
      },
      propertyOrdering: ["career_years", "career_summary"],
    },
  },
  required: [
    "score",
    "recommendation",
    "summary",
    "breakdown",
    "strengths",
    "concerns",
    "matched_keywords",
  ],
  propertyOrdering: [
    "score",
    "recommendation",
    "summary",
    "breakdown",
    "requirement_gate",
    "requirement_coverage",
    "level_match",
    "focus_match",
    "evidence_quality",
    "domain_fit",
    "strengths",
    "concerns",
    "matched_keywords",
    "interview_focus",
    "qualitative_review",
    "career_info",
  ],
};

// 채점 로직 버전 — recomputeScore 의 산식/상수를 바꾸면 반드시 +1.
// screening_cache 키에 포함되어, 로직을 고치면 옛 캐시(=옛 점수)가 자동 무효화(miss)되고 새로 계산된다.
// ⚠️ 이 값이 없던 시절(v1): 캐시 키가 job+프롬프트뿐이라 recomputeScore 를 고쳐도
//    이미 평가된 후보는 재평가해도 캐시가 옛 점수를 그대로 돌려줘 수정이 반영되지 않았다.
const SCREENING_SCORING_VERSION = 2;

// 6축 가중치 — 프롬프트(prompts.ts buildScreeningPrompt)와 반드시 일치.
const AXIS_WEIGHTS: Record<string, number> = {
  tech_fit: 0.2,
  experience_depth: 0.2,
  role_match: 0.25,
  achievement: 0.15,
  stability: 0.1,
  growth_attitude: 0.1,
};

// HR 평가 가이드(evaluationFocus) 점수 반영.
// strong_pass 만 가점(additive)이고, 나머지 미스매치는 다른 6개 게이트와 동일하게 *상한(cap)* 으로 처리한다.
// (cap 은 이미 낮은 점수엔 영향이 없어 적합도 낮은 후보를 한 자릿수로 폭락시키지 않는다 — 과거 additive −12 가
//  spread·직급 보정과 누적되며 "6축 30~50인데 종합 4점"이 나오던 문제 해결. 2026-06-18)
const FOCUS_STRONG_BONUS = 12; // strong_pass → 가점 (유일한 가산 항목)
const FOCUS_FAIL_CAP = 68; // fail(HR 핵심 기준 미달, 비치명) → 보류 상한(추천 70 직전). 고득점도 추천까진 못 감.
const FOCUS_FATAL_CAP = 15; // fatal_fail(필수/배제 조건 위반)만 결격 하드캡 — 진짜 결격 사유

// JD 본문에 명시된 필수/결격 요건 미충족(requirement_gate.verdict=fail) 시 캡.
// severity 로 강도를 나눈다 (LLM 판정):
//  · hard — 면허·국가자격·법정요건 등 없으면 직무 수행 자체가 불가한 진짜 결격 → 40 (비추천).
//  · soft — 학력 수준 등 강한 실무경력으로 상쇄 가능한 명목 요건 → 84 (추천까지 허용, 강력추천만 차단).
// 왜: 프롬프트가 "실무경력 ≫ 학력"(prompts.ts)을 명시하는데, 학력 미충족 하나로 12년 실무 후보를
// 40 으로 떨구던 모순을 막는다. 결격 배너는 점수와 무관하게 항상 떠 채용담당자가 인지한다. unknown 은 감점 안 함.
const REQUIREMENT_GATE_CAP = 40;
const REQUIREMENT_GATE_SOFT_CAP = 84; // 강력추천(85) 직전 — 명시 요건 미충족이면 최고 등급만 막고 추천은 허용.

// 변별력 보정 — 가중평균은 중앙으로 수렴해 후보 간 변별이 약해진다.
// 모집단 중앙값(≈60) 을 기준으로 편차를 SPREAD_FACTOR 배 확대해, 상위는 위로·하위는 아래로 벌린다.
// (채점 로직은 그대로 두고 순위 변별력만 끌어올리는 후처리)
// ⚠️ CENTER 를 50 으로 두면 평범한 후보(평균 60대)까지 위로 부풀어 인플레가 된다 — 반드시 모집단 중앙값 근처로.
const SPREAD_CENTER = 60;
const SPREAD_FACTOR = 1.4;
function spreadScore(raw: number): number {
  return SPREAD_CENTER + (raw - SPREAD_CENTER) * SPREAD_FACTOR;
}

// 약한 핵심축 캡 — 직무 적합의 핵심 3축(기술·직무매칭·경험깊이) 중 하나라도
// 임계 이하로 무너지면, 다른 축이 좋아도 종합을 보류 수준 이하로 캡한다.
// (가중평균이 약한 핵심축을 가려 "핵심은 비었는데 종합은 추천"이 나오는 문제 차단)
const CORE_AXES = ["tech_fit", "role_match", "experience_depth"] as const;
const WEAK_CORE_THRESHOLD = 40; // 핵심축이 이 미만이면
const WEAK_CORE_CAP = 58; // 종합 상한 (추천 70 미만 = 보류 이하)

// 증거 밀도 게이트 — "역량 형용사·스킬 나열" 위주 이력서(evidence_quality=generic)는
// 주장일 뿐 검증 불가 → 종합 캡. 스킬만 나열해도 고득점 나는 문제 차단.
const GENERIC_EVIDENCE_CAP = 60;

// confidence 디스카운트 — 6축 중 다수가 low(추정·근거 빈약)면 "인상은 좋으나 검증 불가" → 강력추천 상한 차단.
// (additive 감점이 아니라 cap — 근거 빈약을 이유로 낮은 점수를 더 떨구지 않고, 고득점만 강력추천 직전으로 제한)
const LOW_CONF_THRESHOLD = 4; // low 축이 이 개수 이상이면
const LOW_CONF_CAP = 84; // 강력추천(85) 직전 — 검증 불가 시 강력추천만 막고 추천은 허용

// 전문 도메인 게이트 — JD 핵심 전문 도메인(보안/금융/의료 등) 경험 수준별 상한.
// requirement_gate(명시 필수)와 별개로, "JD 전체가 그 도메인인데 후보의 그 도메인 경험이 부족" 케이스를 잡는다.
// none(전무) → 결격 수준. adjacent(인접 경험만, 직접 경험 없음) → 보류 상한
// (다른 축·HR 가이드 보너스가 좋아도 핵심 도메인 직접 경험 없이는 추천 못 감 — 면접에서 확인할 보류).
const DOMAIN_GAP_CAP = 50; // candidate_level === "none"
const DOMAIN_ADJACENT_CAP = 68; // candidate_level === "adjacent" (보류 상한, 추천 70 미만)

// 직급/연차 미스매치 상한 — 오버스펙(과한 연차) ≤95, 언더스펙(부족) ≤90.
// (과거 additive −5/−10 은 이미 낮은 점수를 더 떨궈 폭락에 일조했다. "최고점 제한"이라는 본래 의도만
//  남기도록 cap 으로 전환 — 코드 주석/프롬프트가 줄곧 "오버스펙이면 ≤95"라 적어온 의도와 일치.)
const LEVEL_OVER_CAP = 95;
const LEVEL_UNDER_CAP = 90;

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
 * 순서: 6축 가중평균(누락 축은 가중치 제외 후 정규화) → spread 확대 → strong_pass 가점 →
 *       상한(cap) 적용(confidence·focus·구체성·도메인·약한핵심축·필수요건·직급/연차) → clamp.
 * 미스매치 보정은 strong_pass 가점 하나만 빼고 모두 *cap* 이다 — cap 은 이미 낮은 점수엔 영향이 없어
 * "6축 30~50인데 종합 4점" 식 폭락을 막고, 고득점만 끌어내려 "6축은 낮은데 종합은 높은" 모순도 차단한다.
 * 직급/연차 cap 은 맨 마지막(오버 ≤95/언더 ≤90)에 둬 spread 포화·focus 가점에 가려지지 않게 한다.
 * breakdown 이 전혀 없으면 LLM score 로 폴백.
 *
 * @param hasFocusGuide 공고에 HR 평가 가이드(evaluationFocus)가 실제로 있는지.
 *   false 면 focus_match 를 점수·리포트 양쪽에서 무시한다(빈 가이드 공고의 LLM 환각 감점 차단).
 */
export function recomputeScore(
  result: ScreeningResult,
  hasFocusGuide: boolean
): {
  score: number;
  recommendation: ScreeningResult["recommendation"];
} {
  const b = result.breakdown as
    | Record<string, { score?: number; confidence?: Confidence } | undefined>
    | undefined;
  // 소프트축(성장·태도) 상한 기준 = 핵심 3축 최고점.
  // 폭(buzzword) 위주 성장 점수가 핵심 적합을 넘어 종합을 끌어올리지 못하게 한다.
  const coreMax = b
    ? Math.max(
        0,
        ...CORE_AXES.map((k) => b[k]?.score).filter(
          (s): s is number => typeof s === "number"
        ).map(clampScore)
      )
    : 100;
  const softCeil = coreMax > 0 ? coreMax : 100;
  let weighted = 0;
  let totalW = 0;
  if (b) {
    for (const [key, w] of Object.entries(AXIS_WEIGHTS)) {
      const axis = b[key];
      if (axis && typeof axis.score === "number") {
        let s = clampScore(axis.score);
        if (key === "growth_attitude") s = Math.min(s, softCeil);
        weighted += s * w;
        totalW += w;
      }
    }
  }
  const avg = totalW > 0 ? weighted / totalW : clampScore(result.score);
  // 변별력 보정: 6축 가중평균을 50 기준으로 확대(spread)해 분포를 넓힌다.
  // breakdown 이 없어 LLM score 폴백인 경우엔 확대하지 않는다(원점수 신뢰 불가).
  const raw = totalW > 0 ? clampScore(spreadScore(avg)) : avg;
  // 직급/연차 미스매치는 LLM 이 준 penalty 가 아니라 fit 으로 코드가 직접 *상한(cap)* 을 정한다 —
  // over→95 / under→90 / fit→100(무제한). (LLM 이 fit 과 penalty 를 불일치시키는 문제 차단)
  // 적용은 *맨 마지막*(아래) — spread 포화(100)·focus 가점(+12)에 가려지지 않게.
  const lm = result.level_match;
  const levelCap =
    lm?.fit === "over" ? LEVEL_OVER_CAP : lm?.fit === "under" ? LEVEL_UNDER_CAP : 100;
  let score = raw;

  // confidence 디스카운트 — 다수 축이 low(근거 빈약·추정)면 "검증 불가" → 강력추천 상한으로 cap.
  if (b) {
    let lowConf = 0;
    for (const key of Object.keys(AXIS_WEIGHTS)) {
      if (b[key]?.confidence === "low") lowConf++;
    }
    if (lowConf >= LOW_CONF_THRESHOLD) {
      score = Math.min(score, LOW_CONF_CAP);
    }
  }

  // HR 평가 가이드(evaluationFocus) 반영 — strong_pass 만 가점, 미스매치는 cap.
  // strong_pass → +가점 / fail → 보류 상한 cap / fatal_fail → 결격 하드캡 / neutral → 변동 없음.
  // ("보안 경력 필수인데 전무" 같은 필수·배제 위반이 fatal_fail.)
  // HR 평가 가이드(evaluationFocus)가 공고에 실제로 있을 때만 focus_match 반영.
  // 가이드가 비어 있으면 프롬프트에 가이드 블록이 없는데도 LLM 이 focus_match 를
  // applies=true/fail 로 환각해 부당 감점하는 사례가 있어(빈 가이드 공고), 코드에서 차단한다.
  // 점수뿐 아니라 저장 리포트의 focus_match 도 중립화해 "점수-리포트 불일치"를 막는다.
  const fm = result.focus_match;
  if (hasFocusGuide && fm?.applies) {
    if (fm.verdict === "fatal_fail") score = Math.min(score, FOCUS_FATAL_CAP);
    else if (fm.verdict === "fail") score = Math.min(score, FOCUS_FAIL_CAP);
    else if (fm.verdict === "strong_pass")
      score = clampScore(score + FOCUS_STRONG_BONUS);
  } else if (!hasFocusGuide && fm) {
    fm.applies = false;
    fm.verdict = "neutral";
    fm.reason = "공고에 HR 평가 가이드가 없어 미적용";
  }

  // 구체성 게이트 — 스킬·역량 형용사 나열 위주(generic) 이력서는 주장일 뿐 검증 불가 → 캡.
  if (result.evidence_quality === "generic") {
    score = Math.min(score, GENERIC_EVIDENCE_CAP);
  }

  // 전문 도메인 게이트 — JD 핵심 전문 도메인 경험 수준별 상한.
  // none(전무) → 결격 수준 캡 / adjacent(인접만, 직접 경험 없음) → 보류 상한 캡.
  // HR 가이드 strong_pass(+12) 같은 보너스가 도메인 갭을 덮지 못하게, 보너스 가산 뒤에 캡한다.
  const df = result.domain_fit;
  if (df?.has_specialized_domain) {
    if (df.candidate_level === "none") {
      score = Math.min(score, DOMAIN_GAP_CAP);
    } else if (df.candidate_level === "adjacent") {
      score = Math.min(score, DOMAIN_ADJACENT_CAP);
    }
  }

  // 약한 핵심축 캡 — 핵심 3축(기술·직무매칭·경험깊이) 중 하나라도 임계 이하면 종합 캡.
  // (해당 축이 breakdown 에 존재할 때만 적용. 누락 축은 판단 근거 없음으로 보고 캡 안 함)
  if (b) {
    for (const key of CORE_AXES) {
      const axis = b[key];
      if (axis && typeof axis.score === "number" && clampScore(axis.score) < WEAK_CORE_THRESHOLD) {
        score = Math.min(score, WEAK_CORE_CAP);
        break;
      }
    }
  }

  // JD 명시 필수 요건 미충족 → severity 별 캡. hard=결격(40) / soft=추천 상한(84). (unknown/pass 는 변동 없음)
  // severity 누락(구버전 응답 등)은 보수적으로 hard 취급.
  const rg = result.requirement_gate;
  if (rg?.applies && rg.verdict === "fail") {
    const cap =
      rg.severity === "soft" ? REQUIREMENT_GATE_SOFT_CAP : REQUIREMENT_GATE_CAP;
    score = Math.min(score, cap);
  }

  // 직급/연차 미스매치 상한은 *맨 마지막*에 적용 — spread 포화(100)·focus 가점(+12)에 가려지지 않게.
  // (오버스펙 ≤95 / 언더스펙 ≤90.) cap 이라 이미 낮은 점수는 그대로 — 폭락에 가담하지 않는다.
  const beforeLevel = score;
  score = clampScore(Math.min(score, levelCap));
  // 표시 배지(level_match.penalty)는 *실제로 적용된* 보정폭(≤0). cap 이 안 걸리면 0.
  if (lm) lm.penalty = score - beforeLevel;

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

  // 내용 기반 중복 자동 삭제 (2차 dedup).
  // 업로드 시 1차 dedup(공고+파일 바이트 해시)은 "바이트 동일"만 잡는다. 같은 이력서를
  // 재저장·재export·다른 ZIP 으로 올리면 바이트가 달라 통과됐다. 여기서 파싱된 *본문* 해시로
  // 같은 공고에 동일 내용 이력서가 *더 먼저*(작은 id) 있으면 이 후보자는 중복 → 평가 없이 삭제.
  // (작은 id = 먼저 업로드된 원본을 보존. 파일·행 삭제, cascade 로 첨부·큐 정리. 과금도 안 됨.)
  if (candidate.resumeContentHash) {
    const [earlier] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(
          eq(candidates.jobId, candidate.jobId),
          eq(candidates.resumeContentHash, candidate.resumeContentHash),
          lt(candidates.id, candidate.id)
        )
      )
      .orderBy(candidates.id)
      .limit(1);
    if (earlier) {
      await deleteFilesForCandidate(candidateId);
      await db.delete(candidates).where(eq(candidates.id, candidateId));
      logAudit(null, {
        actorRole: "system",
        action: "candidate.delete",
        resourceType: "candidate",
        resourceId: candidateId,
        orgId: candidate.orgId ?? null,
        metadata: {
          reason: "duplicate_content",
          keptCandidateId: earlier.id,
          name: candidate.name,
        },
      });
      log.info("screening_duplicate_auto_deleted", {
        candidateId,
        keptCandidateId: earlier.id,
        jobId: candidate.jobId,
      });
      return;
    }
  }

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (!job) {
    throw new ScreeningError(`job ${candidate.jobId} 없음`, false);
  }

  // AI 이력서 평가를 끈 공고 — 파싱·PII추출·마스킹(ensureParsed)과 중복제거까지만 수행하고
  // LLM 평가·점수·레포트는 생략한다. 후보자는 점수 없이 면접 단계로 바로 진행 가능.
  // 임시 공고(isDraft)도 동일 — 지원 링크로 먼저 들어온 이력서를 파싱·마스킹까지만 해두고(hold),
  // 공고가 정식 등록(isDraft=false)되면 그때 재평가 요청으로 LLM 평가가 진행된다.
  if (job.aiScreeningDisabled || job.isDraft) {
    log.info("screening_skipped_parse_only", {
      candidateId,
      jobId: job.id,
      reason: job.isDraft ? "draft" : "ai_disabled",
    });
    return;
  }

  let cultureFit: CultureFitProfile | null = null;
  if (job.orgId) {
    const [orgRow] = await db
      .select({ cultureFitProfile: organizations.cultureFitProfile })
      .from(organizations)
      .where(eq(organizations.id, job.orgId));
    if (orgRow?.cultureFitProfile) {
      try { cultureFit = JSON.parse(orgRow.cultureFitProfile) as CultureFitProfile; } catch { /* ignore */ }
    }
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

  const prompt = buildScreeningPrompt(
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
    { level: candidate.educationLevel, major: candidate.educationMajor },
    cultureFit
  );

  // 결과 캐시 키 = 공고ID + 평가 프롬프트 전체 해시. 입력(공고 평가기준 + 이력서 내용 + 첨부)이
  // 동일하면 LLM 재호출 없이 같은 결과를 재사용 → 재평가/중복 시 점수가 흔들리지 않고 토큰도 절약.
  // 공고 평가기준을 바꾸면 프롬프트가 달라져 cache miss → 자동으로 새로 평가.
  const promptHash = createHash("sha256")
    .update(`v${SCREENING_SCORING_VERSION}\n${job.id}\n${prompt}`)
    .digest("hex");

  let result: ScreeningResult;
  const [cached] = await db
    .select({ report: screeningCache.report })
    .from(screeningCache)
    .where(eq(screeningCache.promptHash, promptHash))
    .limit(1);

  if (cached?.report) {
    // 캐시된 report 는 recomputeScore 까지 반영된 *최종* 결과.
    result = cached.report as ScreeningResult;
    log.info("screening_cache_hit", { candidateId, jobId: job.id });
  } else {
    try {
      result = await generateJSON<ScreeningResult>(prompt, {
        task: "screening",
        responseSchema: SCREENING_SCHEMA,
        // 평가 일관성 — 같은 이력서가 매번 다른 점수를 받지 않도록 결정성 최대화.
        temperature: 0,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Gemini RPM/quota/timeout 류는 transient 으로 — 큐가 백오프 후 재시도
      const transient =
        /429|quota|rate|503|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg);
      throw new ScreeningError(msg, transient);
    }

    // 종합 점수·등급은 LLM 출력을 신뢰하지 않고 6축 + 페널티로 코드가 재계산.
    // (LLM 이 6축은 낮게 줘도 종합은 후하게 주는 인플레/모순을 차단)
    const recomputed = recomputeScore(
      result,
      hasEvaluationFocus(job.evaluationFocus)
    );
    result.score = recomputed.score;
    result.recommendation = recomputed.recommendation;

    // 캐시 저장 — best-effort. 동시 평가가 먼저 넣었으면 unique 충돌로 무시.
    try {
      await db
        .insert(screeningCache)
        .values({ promptHash, score: result.score, report: result })
        .onConflictDoNothing();
    } catch (cacheErr) {
      log.warn("screening_cache_write_failed", {
        candidateId,
        error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
      });
    }
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
    .select({
      orgId: candidates.orgId,
      name: candidates.name,
      aiScreeningDisabled: jobPostings.aiScreeningDisabled,
    })
    .from(candidates)
    .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .where(eq(candidates.id, candidateId));
  if (!candidate?.orgId) return;
  // AI 평가를 끈 공고는 LLM 평가를 하지 않았으므로 서류 평가 과금도 하지 않는다.
  if (candidate.aiScreeningDisabled) return;
  // 차감 주체 = 평가를 큐에 넣은 운영자 (업로드/재평가 요청자).
  const [sjob] = await db
    .select({ enqueuedByUserId: screeningJobs.enqueuedByUserId })
    .from(screeningJobs)
    .where(eq(screeningJobs.id, jobId));
  await chargeFeature({
    orgId: candidate.orgId,
    feature: "resume_upload",
    refType: "screening_job",
    refId: jobId,
    userId: sjob?.enqueuedByUserId ?? null,
    memo: candidate.name,
  });
}

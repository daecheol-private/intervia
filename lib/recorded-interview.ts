import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  candidates,
  interviewTranscriptSegments,
  jobPostings,
  recordedInterviews,
} from "./schema";
import type { RecordedInterviewReport } from "./schema";
import { generateJSON, generateJSONMultimodal } from "./gemini";
import {
  buildRecordedInterviewEvalPrompt,
  buildRoleAssignmentPrompt,
} from "./prompts";
import type { JobInfo, ScreeningContext } from "./prompts";
import { chargeFeature, chargeRepeatable } from "./tokens";
import { log } from "./logger";

/**
 * 대면(오프라인) 면접 녹음 → AI 평가 공유 코어 파이프라인.
 *
 * 업로드 모드·준실시간 모드가 **공유**한다 — 모드는 전사 입력 경로만 다르고,
 * (전사 텍스트 저장 → 역할 배정 → 평가 → 리포트)는 동일하다.
 * 화자 역할(지원자/면접관)은 음향 라벨이 아니라 **종료 시 내용 기반**으로 배정한다.
 * 상세 설계: docs/LIVE_INTERVIEW_PLAN.md
 */

export type SpeakerRole = "candidate" | "interviewer" | "unknown";

export type TranscribedSegment = {
  speakerLabel: string;
  startMs: number | null;
  endMs: number | null;
  text: string;
  lowConfidence: boolean;
};

/**
 * 오디오 → 전사 세그먼트 (Gemini 오디오 멀티모달). 업로드 배치 / 라이브 청크 공용.
 * 오디오는 호출자가 보관하지 않는다(전사 후 폐기) — 텍스트 세그먼트만 반환.
 * baseMs: 라이브 청크의 누적 시작 오프셋(ms) — 청크 내 상대 시각에 더해 절대 시각화.
 */
/**
 * 전사 정확도용 직무 맥락 힌트 — 해당 분야 전문 용어·약어·고유명사를 정확히 받아쓰게 한다.
 * (예: 보안 직무면 "HMAC/SAML/SOAR/OAuth" 등을 그 분야 전문가처럼 표기)
 */
export function buildTranscriptionDomainHint(job: {
  position: string;
  level?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
}): string {
  const parts = [
    `직무: ${job.position}${job.level ? ` (${job.level})` : ""}`,
    job.requirements ? `자격요건: ${job.requirements}` : "",
    job.responsibilities ? `주요업무: ${job.responsibilities}` : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, 1000);
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  opts?: { baseMs?: number; timeoutMs?: number; domainHint?: string }
): Promise<TranscribedSegment[]> {
  const baseMs = opts?.baseMs ?? 0;
  // 직무 맥락 주입 — 해당 분야 전문어를 정확히 받아쓰되, 안 들린 말은 지어내지 않게.
  const domainBlock = opts?.domainHint
    ? `
- **직무 맥락(전문 용어 정확도용)**: 이 면접은 아래 분야다. 이 분야의 전문 용어·기술명·약어·고유명사가 등장하면 그 분야 전문가가 알아듣듯 정확히 표기하라. 단, **들리지 않은 말을 지어내지 말 것 — 어디까지나 받아쓰기다.**
${opts.domainHint}`
    : "";
  const prompt = `이 오디오는 한국어 대면 면접 녹음이다. 발화를 화자별로 분리해 받아쓰기하라.
- 화자는 "화자1", "화자2" … 로 라벨링(등장 순서). 같은 사람은 같은 라벨을 유지하라.
- 각 발화 단위(turn)를 하나의 세그먼트로 나눈다.
- 잘 안 들리거나 불확실한 구간은 low_confidence=true 로 표시.
- start_ms/end_ms 는 이 오디오 시작 기준 밀리초. 알 수 없으면 null.
- 군더더기(음…, 어…)는 과도하면 정리하되 의미는 보존. **받아쓰기만 — 요약·창작 금지.**${domainBlock}

출력(JSON 만, 마크다운 금지):
{ "segments": [ { "speaker": "화자1", "start_ms": 0, "end_ms": 4200, "text": "발화 내용", "low_confidence": false } ] }`;

  const result = await generateJSONMultimodal<{
    segments?: Array<{
      speaker?: string;
      start_ms?: number | null;
      end_ms?: number | null;
      text?: string;
      low_confidence?: boolean;
    }>;
  }>(
    [{ text: prompt }, { inlineData: { mimeType, data: audioBase64 } }],
    { task: "interviewEval", timeoutMs: opts?.timeoutMs ?? 110_000 }
  );

  const segs = Array.isArray(result.segments) ? result.segments : [];
  return segs
    .map((s) => ({
      speakerLabel: (s.speaker ?? "화자1").toString().trim().slice(0, 20) || "화자1",
      startMs:
        typeof s.start_ms === "number" && Number.isFinite(s.start_ms)
          ? Math.max(0, Math.round(s.start_ms)) + baseMs
          : null,
      endMs:
        typeof s.end_ms === "number" && Number.isFinite(s.end_ms)
          ? Math.max(0, Math.round(s.end_ms)) + baseMs
          : null,
      text: (s.text ?? "").toString().trim(),
      lowConfidence: s.low_confidence === true,
    }))
    .filter((s) => s.text.length > 0);
}

/**
 * 화자 라벨 → 역할(지원자/면접관) 내용 기반 배정. 출력은 라벨→역할 맵(소수 항목).
 * 라벨이 1개뿐(음향 분리 실패)이면 LLM 없이 unknown.
 */
export async function assignSpeakerRoles(
  segments: Array<{ speakerLabel: string | null; text: string }>
): Promise<Record<string, SpeakerRole>> {
  const labels = Array.from(
    new Set(
      segments.map((s) => s.speakerLabel).filter((l): l is string => !!l)
    )
  );
  if (labels.length === 0) return {};
  if (labels.length === 1) return { [labels[0]]: "unknown" };

  const labeled = segments
    .filter((s) => s.speakerLabel)
    .map((s) => `${s.speakerLabel}: ${s.text}`)
    .join("\n")
    .slice(0, 60_000);

  const out = await generateJSON<{ roles?: Record<string, string> }>(
    buildRoleAssignmentPrompt(labeled, labels),
    { task: "interviewEval", temperature: 0 }
  );

  const roles: Record<string, SpeakerRole> = {};
  for (const label of labels) {
    const r = out.roles?.[label];
    roles[label] = r === "candidate" || r === "interviewer" ? r : "unknown";
  }
  return roles;
}

function roleKo(role: SpeakerRole | null): string {
  return role === "candidate"
    ? "지원자"
    : role === "interviewer"
      ? "면접관"
      : "미상";
}

function buildLabeledTranscript(
  segments: Array<{ seq: number; role: SpeakerRole | null; text: string }>
): string {
  return segments
    .map((s) => `[#${s.seq}] ${roleKo(s.role)}: ${s.text}`)
    .join("\n");
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.min(100, Math.max(0, v));
}

function recoFromScore(s: number): RecordedInterviewReport["recommendation"] {
  return s >= 85 ? "강력추천" : s >= 70 ? "추천" : s >= 55 ? "보류" : "비추천";
}

function validSeqs(arr: unknown, valid: Set<number>): number[] {
  if (!Array.isArray(arr)) return [];
  const out: number[] = [];
  for (const x of arr) {
    const n = typeof x === "number" ? x : Number(x);
    if (Number.isInteger(n) && valid.has(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

function toStringArray(a: unknown): string[] {
  return Array.isArray(a)
    ? a.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
}

/**
 * LLM 평가 출력 정규화 — 점수 클램프·배열 보정·근거 seq 유효성 검사.
 * (LLM 이 형식을 벗어나도 UI/저장이 깨지지 않도록 방어.)
 */
function normalizeReport(
  raw: RecordedInterviewReport | null | undefined,
  validSeqSet: Set<number>
): RecordedInterviewReport {
  const overall = clampScore(raw?.overall_score);
  const scores: RecordedInterviewReport["scores"] = {};
  for (const [k, v] of Object.entries(raw?.scores ?? {})) {
    scores[k] = {
      score: clampScore(v?.score),
      comment: typeof v?.comment === "string" ? v.comment : "",
      evidence_seq: validSeqs(v?.evidence_seq, validSeqSet),
    };
  }
  const mapEvidenceItems = (
    arr: unknown
  ): Array<{ text: string; evidence_seq?: number[] }> =>
    Array.isArray(arr)
      ? arr
          .filter(
            (x): x is { text: string; evidence_seq?: unknown } =>
              !!x && typeof (x as { text?: unknown }).text === "string"
          )
          .map((x) => ({
            text: x.text,
            evidence_seq: validSeqs(x.evidence_seq, validSeqSet),
          }))
      : [];

  const reco =
    raw?.recommendation === "강력추천" ||
    raw?.recommendation === "추천" ||
    raw?.recommendation === "보류" ||
    raw?.recommendation === "비추천"
      ? raw.recommendation
      : recoFromScore(overall);

  return {
    overall_score: overall,
    recommendation: reco,
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    scores,
    strengths: mapEvidenceItems(raw?.strengths),
    concerns: mapEvidenceItems(raw?.concerns),
    to_verify: toStringArray(raw?.to_verify),
    followup_questions: toStringArray(raw?.followup_questions),
    key_phrases: toStringArray(raw?.key_phrases),
  };
}

/**
 * 역할 배정된 전사로 평가 리포트 생성. 순수 함수(DB 접근 없음) — 테스트·재사용 용이.
 */
export async function evaluateRecordedInterview(args: {
  job: JobInfo;
  resumeMasked: string;
  segments: Array<{ seq: number; role: SpeakerRole | null; text: string }>;
  screening?: ScreeningContext | null;
}): Promise<RecordedInterviewReport> {
  const labeledTranscript = buildLabeledTranscript(args.segments);
  const raw = await generateJSON<RecordedInterviewReport>(
    buildRecordedInterviewEvalPrompt(
      args.job,
      args.resumeMasked || "(이력서 없음)",
      labeledTranscript,
      args.screening
    ),
    { task: "interviewEval", temperature: 0.2 }
  );
  return normalizeReport(raw, new Set(args.segments.map((s) => s.seq)));
}

/**
 * 저장된 recorded_interview(전사 세그먼트 완료 상태)를 받아 역할 배정 → 평가 →
 * 리포트 저장 → 후차감까지 수행. 업로드/준실시간 종료 시 공통 호출.
 * 실패 시 status='failed' + error 기록 후 throw (호출자가 응답·로깅).
 *
 * charge 모드:
 *  - "once" (백그라운드 워커의 자동 첫 평가): chargeFeature — (feature,refType,refId) 멱등.
 *    워커가 전사·평가 실패로 finalize 를 **자동 재시도**해도 이중 과금되지 않는다.
 *  - "repeatable" (사용자 수동 재평가·라이브 종료, 기본값): chargeRepeatable —
 *    성공할 때마다 회차별(_re{N})로 매번 과금. 첫 회차 refType 은 "once" 와 동일하므로
 *    (자동 첫 평가 → 수동 재평가) 흐름에서 키가 자연스럽게 이어진다.
 */
export async function finalizeRecordedInterview(
  recordedInterviewId: number,
  opts?: { charge?: "once" | "repeatable" }
): Promise<void> {
  const chargeMode = opts?.charge ?? "repeatable";
  const [ri] = await db
    .select()
    .from(recordedInterviews)
    .where(eq(recordedInterviews.id, recordedInterviewId));
  if (!ri) throw new Error(`recorded_interview ${recordedInterviewId} 없음`);

  await db
    .update(recordedInterviews)
    .set({ status: "processing", error: null, startedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(recordedInterviews.id, recordedInterviewId));

  try {
    const segs = await db
      .select()
      .from(interviewTranscriptSegments)
      .where(
        eq(interviewTranscriptSegments.recordedInterviewId, recordedInterviewId)
      )
      .orderBy(asc(interviewTranscriptSegments.seq));
    if (segs.length === 0) throw new Error("전사 세그먼트가 없습니다.");

    // 1) 역할 배정. 라이브(STT)는 진행 중 점진 정리에서 이미 발화별 역할이 박혀 있으므로
    //    그대로 사용. 업로드(음향 다이어리제이션)만 라벨→역할 배정 후 일괄 반영(N UPDATE 회피).
    const roleMap: Record<string, SpeakerRole> = {};
    if (ri.mode !== "live") {
      Object.assign(roleMap, await assignSpeakerRoles(segs));
      const byRole: Record<SpeakerRole, string[]> = {
        candidate: [],
        interviewer: [],
        unknown: [],
      };
      for (const [label, role] of Object.entries(roleMap)) byRole[role].push(label);
      await db.transaction(async (tx) => {
        for (const role of ["candidate", "interviewer", "unknown"] as const) {
          if (byRole[role].length === 0) continue;
          await tx
            .update(interviewTranscriptSegments)
            .set({ role })
            .where(
              and(
                eq(
                  interviewTranscriptSegments.recordedInterviewId,
                  recordedInterviewId
                ),
                inArray(interviewTranscriptSegments.speakerLabel, byRole[role])
              )
            );
        }
      });
    }

    // 2) 평가 (JD + 이력서 마스킹본 + 서류평가 + 역할 배정 전사).
    const [cand] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, ri.candidateId));
    const [job] = await db
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.id, ri.jobId));
    if (!cand || !job) throw new Error("후보자 또는 공고를 찾을 수 없습니다.");

    const jobInfo: JobInfo = {
      position: job.position,
      level: job.level,
      employmentType: job.employmentType,
      responsibilities: job.responsibilities,
      requirements: job.requirements,
      idealProfile: job.idealProfile,
      evaluationFocus: job.evaluationFocus,
    };
    const screening: ScreeningContext | null = cand.screeningReport
      ? {
          score: cand.screeningReport.score,
          recommendation: cand.screeningReport.recommendation,
          summary: cand.screeningReport.summary,
          strengths: cand.screeningReport.strengths,
          concerns: cand.screeningReport.concerns,
          matched_keywords: cand.screeningReport.matched_keywords,
        }
      : null;

    const segWithRole = segs.map((s) => ({
      seq: s.seq,
      role:
        ri.mode === "live"
          ? ((s.role ?? "unknown") as SpeakerRole)
          : s.speakerLabel
            ? roleMap[s.speakerLabel] ?? "unknown"
            : ("unknown" as SpeakerRole),
      text: s.text,
    }));

    const report = await evaluateRecordedInterview({
      job: jobInfo,
      resumeMasked: cand.resumeMaskedText ?? "",
      segments: segWithRole,
      screening,
    });

    await db
      .update(recordedInterviews)
      .set({ report, status: "ready", completedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(recordedInterviews.id, recordedInterviewId));

    // 3) 후차감. orgId 없으면(시스템) skip.
    //    once = 멱등(워커 자동 재시도 이중과금 방지) / repeatable = 성공마다(수동 재평가).
    if (ri.orgId) {
      if (chargeMode === "once") {
        await chargeFeature({
          orgId: ri.orgId,
          feature: "offline_interview",
          refType: "recorded_interview",
          refId: recordedInterviewId,
          userId: ri.createdByUserId,
          memo: `대면 면접 평가 (${ri.round})`,
        });
      } else {
        await chargeRepeatable({
          orgId: ri.orgId,
          feature: "offline_interview",
          baseRefType: "recorded_interview",
          refId: recordedInterviewId,
          userId: ri.createdByUserId,
          memo: `대면 면접 평가 (${ri.round})`,
        });
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("recorded_interview.finalize_failed", e, {
      recordedInterviewId,
      error: msg.slice(0, 300),
    });
    await db
      .update(recordedInterviews)
      .set({ status: "failed", error: msg.slice(0, 500) })
      .where(eq(recordedInterviews.id, recordedInterviewId));
    throw e;
  }
}

// ── 준실시간 모드 — 라이브 어시스턴트(원래 스크린샷의 답변요약/긍정/확인/추천) ──────────
// 면접 진행 중 누적 전사를 가볍게 요약해 면접관(서기) 화면에 추천 질문을 띄운다.
// 빠른 응답을 위해 task='interview'(thinkingBudget 낮음) + 최근 전사 윈도우만 사용.

export type LiveSuggestion = {
  answer_summary: string;
  positives: string[];
  to_confirm: string[];
  suggestions: string[];
};

function buildLiveSuggestionPrompt(
  job: JobInfo,
  transcript: string,
  existing: string[]
): string {
  // 누적형 — 이미 제안한 질문은 빼고, 정말 중요한 새 질문만 가끔(없으면 빈 배열). 최대 2개.
  return `진행 중인 대면 면접의 실시간 전사다. 면접관이 다음에 물으면 좋을 **정말 중요한 추가 질문**만 제안하라.
- 지금까지 답변에서 더 깊이 파볼 가치가 있는 핵심 질문만 (사소하거나 일반적인 건 내지 말 것).
- **이미 제안한 질문(아래)과 겹치거나 비슷하면 절대 내지 말 것.**
- 새로 낼 중요한 질문이 없으면 **빈 배열**을 반환하라. **한 번에 최대 2개.**

## 직무
- 직무: ${job.position} / 주요 업무: ${job.responsibilities}
- 자격 요건: ${job.requirements}

## 이미 제안한 질문 (중복·유사 금지)
${existing.length ? existing.map((q) => `- ${q}`).join("\n") : "(없음)"}

## 지금까지 전사 (최근 위주)
${transcript}

## 출력 (JSON 만, 마크다운 금지)
{ "suggestions": [] }`;
}

export async function suggestLiveQuestions(
  job: JobInfo,
  transcript: string,
  existing: string[] = []
): Promise<LiveSuggestion> {
  const raw = await generateJSON<Partial<LiveSuggestion>>(
    buildLiveSuggestionPrompt(job, transcript.slice(-12_000), existing),
    { task: "interview", temperature: 0.3 }
  );
  return {
    answer_summary:
      typeof raw.answer_summary === "string" ? raw.answer_summary : "",
    positives: toStringArray(raw.positives),
    to_confirm: toStringArray(raw.to_confirm),
    suggestions: toStringArray(raw.suggestions),
  };
}

// ── 라이브 STT 점진 정리 ─────────────────────────────────────────────────────
// 브라우저 STT 원문(화자 구분 없음)을 면접 진행 중 "마이크가 쉴 때" 조금씩 LLM 에 보내
// 화자별(면접관/지원자)로 나누고 받아쓰기를 가볍게 다듬는다. 즉시 보이는 원문 위에
// 정리된 화자 구분 전사가 주기적으로 따라붙는 구조 — 종료 시 이미 화자가 박혀 있어 바로 평가.

/**
 * STT 원문 한 덩어리를 직전 맥락을 참고해 화자별로 나눠 정리. **새 원문만** 정리해 반환.
 * 텍스트만 다루므로 빠르고 저렴. 오디오는 호출자(브라우저) 밖으로 나가지 않는다.
 */
export async function cleanLiveTranscriptChunk(args: {
  job: { position: string; requirements?: string | null };
  recentContext: string;
  rawText: string;
}): Promise<Array<{ role: SpeakerRole; text: string }>> {
  const raw = args.rawText.trim();
  if (!raw) return [];
  const prompt = `진행 중인 대면 면접의 음성인식 원문 일부다. 화자 구분이 없고 받아쓰기라 거칠다.
직전까지 정리된 맥락을 참고해 **새 원문만** 면접관/지원자 발화로 나누고, 명백한 받아쓰기
오류만 가볍게 다듬어라. (의미 보존 — 요약·창작 금지, 새 원문에 없는 말 추가 금지.)

- 질문하거나 면접을 이끄는 쪽 = interviewer / 자기 경험·생각을 답하는 쪽 = candidate.
- 한 덩어리에 두 화자가 섞였으면 화자가 바뀌는 지점에서 나눈다. 애매하면 직전 맥락의 흐름을 따른다.
- 직무: ${args.job.position}${args.job.requirements ? ` / 자격요건: ${args.job.requirements}` : ""}

## 직전까지 정리된 맥락 (참고만 — 다시 출력 금지)
${args.recentContext || "(없음)"}

## 새 원문 (이번에 정리할 부분)
${raw}

## 출력 (JSON 만, 마크다운 금지)
{ "segments": [ { "role": "interviewer" | "candidate", "text": "정리된 발화" } ] }`;

  // task="interview"(thinkingBudget 낮음) — 정리는 가벼운 텍스트 작업이라 thinking 높이면
  // 지연만 커진다(실측: dynamic 9초 → budget128 2.3초, 품질 동일). 정리본이 빨리 따라붙게.
  const out = await generateJSON<{
    segments?: Array<{ role?: string; text?: string }>;
  }>(prompt, { task: "interview", temperature: 0.1 });

  const segs = Array.isArray(out.segments) ? out.segments : [];
  return segs
    .map((s) => ({
      role: (s.role === "candidate" || s.role === "interviewer"
        ? s.role
        : "unknown") as SpeakerRole,
      text: (s.text ?? "").toString().trim(),
    }))
    .filter((s) => s.text.length > 0);
}

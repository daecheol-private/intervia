import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
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
import { maskText, type KnownPII } from "./mask";
import { log } from "./logger";
import {
  MIN_INTERVIEW_DURATION_SECONDS,
  TOO_SHORT_INTERVIEW_MESSAGE,
} from "./upload-validation";

/**
 * 대면(오프라인) 면접 녹음 → AI 평가 공유 코어 파이프라인.
 *
 * 업로드 모드·준실시간 모드가 **공유**한다 — 모드는 전사 입력 경로만 다르고,
 * (전사 텍스트 저장 → 역할 배정 → 평가 → 리포트)는 동일하다.
 * 화자 역할(지원자/면접관)은 음향 라벨이 아니라 **종료 시 내용 기반**으로 배정한다.
 * 상세 설계: docs/LIVE_INTERVIEW_PLAN.md
 */

export type SpeakerRole = "candidate" | "interviewer" | "unknown";

/**
 * 녹음 오디오 파트 — 긴 면접은 여러 파트로 나눠 각각 전사한다.
 *
 * 왜 나누나: 40분 이상을 한 번에 전사시키면 모델이 성실도를 잃는다(2026-07-30 운영 실측 —
 * 42분 녹음이 61턴으로 뭉치고 타임스탬프를 실제의 1.8배로 지어냄, 30분 녹음은 뒤 22% 누락).
 * 파트를 나누면 각 요청의 부담이 작아져 뭉침·누락·시각 환각이 함께 사라진다.
 *
 * `recorded_interviews.audio_blob_key`(text) 에 단일 키(기존·업로드 모드) 또는 파트 배열
 * JSON 을 담는다 — 마이그레이션 없이 확장하기 위한 인코딩. 워커는 한 실행에 한 파트만
 * 전사하고 남은 파트를 다시 써 넣어(status='queued') 다음 실행으로 넘긴다.
 */
export type AudioPart = { key: string; offsetMs: number; index: number };

export function parseAudioParts(value: string | null | undefined): AudioPart[] {
  if (!value) return [];
  if (!value.startsWith("[")) return [{ key: value, offsetMs: 0, index: 0 }];
  try {
    const arr = JSON.parse(value) as Array<{ k?: string; o?: number; i?: number }>;
    return arr
      .filter((p): p is { k: string; o?: number; i?: number } => typeof p?.k === "string")
      .map((p, n) => ({
        key: p.k,
        offsetMs: Math.max(0, Math.round(Number(p.o) || 0)),
        index: Number.isInteger(p.i) ? Number(p.i) : n,
      }));
  } catch {
    return [{ key: value, offsetMs: 0, index: 0 }];
  }
}

export function serializeAudioParts(parts: AudioPart[]): string | null {
  if (parts.length === 0) return null;
  // 단일 파트이고 오프셋도 0 이면 기존 포맷(평문 키) 유지 — 업로드 모드와 하위호환.
  if (parts.length === 1 && parts[0].offsetMs === 0 && parts[0].index === 0)
    return parts[0].key;
  return JSON.stringify(
    parts.map((p) => ({ k: p.key, o: p.offsetMs, i: p.index }))
  );
}

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
 * 전사 정확도용 맥락 힌트 — 해당 분야 전문 용어·약어·고유명사를 정확히 받아쓰게 한다.
 * (예: 보안 직무면 "HMAC/SAML/SOAR/OAuth" 등을 그 분야 전문가처럼 표기)
 *
 * 지원자·면접관 이름과 이력서 발췌까지 넣는 이유: 음성만으로는 사람 이름·회사명·학교명이
 * 거의 매번 틀린다(실측). **이 힌트는 전사 단계에만 쓴다** — 후속 역할배정·평가 프롬프트는
 * 기존대로 maskText 를 거치므로, 실명이 평가 LLM 에 흘러가지는 않는다. 전사가 정확해지면
 * 오히려 maskText 의 known-PII 매칭이 정확해져 마스킹 품질도 같이 오른다.
 */
export function buildTranscriptionDomainHint(
  job: {
    position: string;
    level?: string | null;
    responsibilities?: string | null;
    requirements?: string | null;
  },
  people?: {
    candidateName?: string | null;
    interviewerNames?: string[];
    resumeExcerpt?: string | null;
  }
): string {
  const parts = [
    people?.candidateName ? `지원자 이름: ${people.candidateName}` : "",
    people?.interviewerNames?.length
      ? `면접관 이름: ${people.interviewerNames.join(", ")}`
      : "",
    `직무: ${job.position}${job.level ? ` (${job.level})` : ""}`,
    job.requirements ? `자격요건: ${job.requirements}` : "",
    job.responsibilities ? `주요업무: ${job.responsibilities}` : "",
    people?.resumeExcerpt
      ? `지원자 이력서 발췌(회사·학교·기술 표기 참고):\n${people.resumeExcerpt.slice(0, 2500)}`
      : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, 4000);
}

/**
 * 모델이 낸 화자 라벨 정규화. 숫자만 뽑아 "화자N" 으로 통일한다 —
 * 실제 운영 전사에서 "화2", "3" 같은 파편 라벨이 섞여 같은 사람이 별개 화자로 갈라졌다(2026-07-30 실측).
 * prefix 는 파트 분할 전사에서 파트 간 라벨 충돌(파트마다 화자1 이 다른 사람)을 막는다.
 */
function normalizeSpeakerLabel(
  raw: string | undefined,
  prefix?: string
): string {
  const s = (raw ?? "").toString().trim();
  const n = s.match(/(\d+)/)?.[1];
  const base = n ? `화자${n}` : s.slice(0, 12) || "화자1";
  return prefix ? `${prefix}#${base}` : base;
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  opts?: {
    baseMs?: number;
    timeoutMs?: number;
    domainHint?: string;
    /** 여러 파트로 쪼갠 녹음일 때 이 파트의 위치 안내(경계에서 말이 잘릴 수 있음을 알림). */
    partHint?: string;
    /** 파트별 화자 라벨 고유화 접두어(예: "P2") — 파트마다 화자1 이 다른 사람일 수 있으므로. */
    labelPrefix?: string;
  }
): Promise<TranscribedSegment[]> {
  const baseMs = opts?.baseMs ?? 0;
  // 직무·인물 맥락 주입 — 전문어와 고유명사를 정확히 받아쓰되, 안 들린 말은 지어내지 않게.
  const domainBlock = opts?.domainHint
    ? `

## 맥락 (고유명사·전문용어 표기 참고)
아래는 이 면접의 배경이다. 등장하는 이름·회사명·학교명·기술명·약어는 그 분야 전문가가
알아듣듯 정확히 표기하라. 단 **들리지 않은 말을 지어내는 근거로 쓰지 말 것 — 받아쓰기다.**
${opts.domainHint}`
    : "";
  const partBlock = opts?.partHint
    ? `

## 이 오디오의 위치
${opts.partHint}
시작·끝이 문장 중간일 수 있다. 잘린 말은 들린 만큼만 적고, 앞뒤를 상상해 채우지 마라.`
    : "";
  const prompt = `이 오디오는 한국어 대면 면접 녹음이다. 발화를 화자별로 분리해 **처음부터 끝까지 빠짐없이** 받아쓰기하라.

## 화자 분리
- 화자는 "화자1", "화자2" … 로 라벨링(등장 순서). **같은 사람은 끝까지 같은 라벨**을 유지하라.
- 라벨은 반드시 "화자"+숫자 형식만 쓴다(예: 화자1). 다른 형식·축약 금지.
- **한 세그먼트에는 한 사람의 말만** 담는다. 말하는 사람이 바뀌면 반드시 세그먼트를 나눠라.
- 맞장구·되묻기·끼어들기도 별개 세그먼트로 나누고, 원래 화자가 이어 말하면 그 사람 라벨로 되돌린다.
- 목소리가 비슷해 헷갈려도 **여러 사람을 한 라벨로 뭉치지 마라** — 대화 흐름(질문하는 쪽 / 답하는 쪽)으로 갈라라.

## 분량
- 한 세그먼트 = 한 발화(turn). 한 사람이 길게 말하면 문장 경계에서 나눠 **30초·200자를 넘지 않게** 한다.
- 오디오 **끝까지** 받아쓴다. 중간을 건너뛰거나, 뒤로 갈수록 요약하거나, 도중에 멈추지 마라.

## 시각
- start_ms/end_ms 는 이 오디오 시작 기준 실제 밀리초. **추정값으로 채우지 말 것** — 확실하지 않으면 null.

## 표기
- 잘 안 들리거나 불확실한 구간은 low_confidence=true 로 표시.
- 군더더기(음…, 어…)는 과도하면 정리하되 의미는 보존. **받아쓰기만 — 요약·창작 금지.**${domainBlock}${partBlock}

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
      speakerLabel: normalizeSpeakerLabel(s.speaker, opts?.labelPrefix),
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
 * 라벨별로 고르게 뽑아 한도 안에 담는다 — 각 라벨이 판정 근거를 갖도록.
 * 원래 대화 순서는 유지한다(질문→답변 인접성이 역할 판정의 핵심 단서라서).
 */
function sampleLinesPerLabel(
  lines: string[],
  labels: string[],
  limit: number
): string {
  const perLabel = Math.max(3, Math.floor(limit / Math.max(1, labels.length) / 120));
  const count = new Map<string, number>();
  const picked: string[] = [];
  let size = 0;
  for (const [i, line] of lines.entries()) {
    const label = line.slice(0, line.indexOf(":"));
    const n = count.get(label) ?? 0;
    // 라벨별 앞부분 우선 + 중간중간(간격 샘플)도 집어 대화 전개를 보이게.
    if (n >= perLabel && i % 3 !== 0) continue;
    if (n >= perLabel * 2) continue;
    const trimmed = line.length > 400 ? `${line.slice(0, 400)}…` : line;
    if (size + trimmed.length > limit) break;
    picked.push(trimmed);
    size += trimmed.length + 1;
    count.set(label, n + 1);
  }
  return picked.join("\n");
}

/**
 * 화자 라벨 → 역할(지원자/면접관) 내용 기반 배정. 출력은 라벨→역할 맵(소수 항목).
 * 라벨이 1개뿐(음향 분리 실패)이면 LLM 없이 unknown.
 */
export async function assignSpeakerRoles(
  segments: Array<{ speakerLabel: string | null; text: string }>,
  maskKnown?: KnownPII
): Promise<Record<string, SpeakerRole>> {
  const labels = Array.from(
    new Set(
      segments.map((s) => s.speakerLabel).filter((l): l is string => !!l)
    )
  );
  if (labels.length === 0) return {};
  if (labels.length === 1) return { [labels[0]]: "unknown" };

  // 구술 전사도 채팅 면접과 동일하게 마스킹 후 LLM 전달 (§4의3 노출 방지 + 도쿄 폴백 전제).
  // 저장·화면 표시는 원문 유지 — 마스킹은 프롬프트 경계에서만.
  const lines = segments
    .filter((s) => s.speakerLabel)
    .map((s) => `${s.speakerLabel}: ${s.text}`);
  const LIMIT = 55_000;
  const full = lines.join("\n");
  // 그냥 자르면 뒤쪽 라벨이 근거 없이 남아 통째로 unknown 이 된다(파트 분할로 라벨이 늘면서
  // 현실적인 위험이 됐다). 한도를 넘으면 라벨별로 고르게 뽑아 모든 라벨의 근거를 남긴다.
  const labeled = maskText(
    full.length <= LIMIT ? full : sampleLinesPerLabel(lines, labels, LIMIT),
    { level: "standard", known: maskKnown }
  );

  const out = await generateJSON<{ roles?: Record<string, string> }>(
    buildRoleAssignmentPrompt(labeled, labels),
    // 하드 타임아웃 — 평가 단계가 함수 maxDuration 을 넘겨 강제종료(→"stuck")되지 않도록.
    { task: "interviewEval", temperature: 0, timeoutMs: 45_000 }
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
      not_assessed: v?.not_assessed === true,
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
  maskKnown?: KnownPII;
}): Promise<RecordedInterviewReport> {
  // 평가 프롬프트의 전사는 마스킹 (assignSpeakerRoles 와 동일 원칙 — 저장본은 원문 유지).
  const labeledTranscript = maskText(buildLabeledTranscript(args.segments), {
    level: "standard",
    known: args.maskKnown,
  });
  const raw = await generateJSON<RecordedInterviewReport>(
    buildRecordedInterviewEvalPrompt(
      args.job,
      args.resumeMasked || "(이력서 없음)",
      labeledTranscript,
      args.screening
    ),
    // 하드 타임아웃(200s) — 긴 녹취 평가가 함수 maxDuration(300s) 을 넘겨 워커가 강제종료되는
    // 대신, 상한 도달 시 abort 로 끊겨 호출부에서 정상 실패·재시도로 처리되게 한다.
    { task: "interviewEval", temperature: 0.2, timeoutMs: 200_000 }
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

    // 5분 미만 = 오녹음 — 전사까지 진행됐어도 평가·과금을 건너뛴다(최종 방어). 클라이언트/진입점
    // 사전 차단이 뚫렸거나(파일 메타 측정 실패), 재평가로 들어온 경우가 여기 걸린다.
    // durationSeconds=0(측정 완전 실패)은 오차단 방지를 위해 통과시킨다. status='failed' 로
    // 남겨 실패 카드로 노출하고(사유는 error), 후차감(chargeFeature)에 도달하기 전에 return 한다.
    if (
      ri.durationSeconds > 0 &&
      ri.durationSeconds < MIN_INTERVIEW_DURATION_SECONDS
    ) {
      await db
        .update(recordedInterviews)
        .set({
          status: "failed",
          error: TOO_SHORT_INTERVIEW_MESSAGE,
          completedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(recordedInterviews.id, recordedInterviewId));
      return; // 평가·과금 skip. throw 안 함 — 워커가 정상 완료로 보고 재큐하지 않는다.
    }

    // 후보자·공고는 서로 독립 조회 — 병렬로 (원격 DB 왕복 2회 직렬 회피).
    // 역할 배정 전에 로드 — 전사 마스킹의 known PII(이름·이메일·전화)로 사용.
    const [[cand], [job]] = await Promise.all([
      db.select().from(candidates).where(eq(candidates.id, ri.candidateId)),
      db.select().from(jobPostings).where(eq(jobPostings.id, ri.jobId)),
    ]);
    if (!cand || !job) throw new Error("후보자 또는 공고를 찾을 수 없습니다.");
    const maskKnown: KnownPII = {
      name: cand.name ?? null,
      emails: cand.email ? [cand.email] : [],
      phones: cand.phone ? [cand.phone] : [],
    };

    // 1) 역할 배정. 라이브 진행 중 점진 정리(Web Speech 초안)는 발화별 역할이 이미 박혀 있으므로
    //    그대로 사용. 업로드·라이브 오디오 재전사(A안)는 음향 라벨만 있고 역할이 비어 있어(role=null)
    //    라벨→역할 배정 후 일괄 반영(N UPDATE 회피). mode 가 아니라 '역할 미배정' 여부로 판단해야
    //    라이브 행을 오디오로 재전사한 경우(mode='live' 인데 역할 없음)도 배정이 돈다.
    const needsRoleAssignment = segs.every((s) => s.role == null);
    const roleMap: Record<string, SpeakerRole> = {};
    if (needsRoleAssignment) {
      Object.assign(roleMap, await assignSpeakerRoles(segs, maskKnown));
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
      role: needsRoleAssignment
        ? s.speakerLabel
          ? roleMap[s.speakerLabel] ?? "unknown"
          : ("unknown" as SpeakerRole)
        : ((s.role ?? "unknown") as SpeakerRole),
      text: s.text,
    }));

    const report = await evaluateRecordedInterview({
      job: jobInfo,
      resumeMasked: cand.resumeMaskedText ?? "",
      segments: segWithRole,
      screening,
      maskKnown,
    });

    // error=null: 이전 시도가 남긴 실패 메시지를 지운다 — 성공(ready)인데 error 가 남아
    // '실패'로 오표시되던 문제 차단(2026-07-07 사고: status=ready 인데 error="stuck…").
    await db
      .update(recordedInterviews)
      .set({
        report,
        status: "ready",
        error: null,
        completedAt: sql`CURRENT_TIMESTAMP`,
      })
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
    // status 가드: 동시 실행된 다른 finalize(워커 자동평가 + 사용자 재평가가 겹칠 때)가 이미
    // 성공(ready/confirmed)시켰다면 이번 실패로 덮어쓰지 않는다 — '성공인데 실패' 표시 방지.
    await db
      .update(recordedInterviews)
      .set({ status: "failed", error: msg.slice(0, 500) })
      .where(
        and(
          eq(recordedInterviews.id, recordedInterviewId),
          ne(recordedInterviews.status, "ready"),
          ne(recordedInterviews.status, "confirmed")
        )
      );
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

/**
 * 라이브 추천질문에 넣는 전사 분량. 12,000자 → 2,500자로 줄였다(2026-07-31): 45초 폴링마다
 * 새로 쌓이는 건 수백 자뿐인데 매번 12,000자를 되보내 입력 토큰의 대부분이 중복이었다.
 * 추천 질문은 직전 답변을 파고드는 용도이고, 중복 회피는 existing(have) 이 따로 담당한다.
 * 라우트도 최근 턴만 조회하므로(LIVE_SUGGEST_RECENT_TURNS) 여기선 상한 역할.
 */
export const LIVE_SUGGEST_CONTEXT_CHARS = 2_500;

export async function suggestLiveQuestions(
  job: JobInfo,
  transcript: string,
  existing: string[] = []
): Promise<LiveSuggestion> {
  const raw = await generateJSON<Partial<LiveSuggestion>>(
    buildLiveSuggestionPrompt(
      job,
      transcript.slice(-LIVE_SUGGEST_CONTEXT_CHARS),
      existing
    ),
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

/**
 * AI 채팅 면접 평가 — 대화록 구성 + 구조화 출력 스키마 + 결과 정규화.
 * complete(후보자 종료)·reevaluate(운영자 재평가) 라우트 공용.
 *
 * 보안(감사 H1, 2026-10-31): 대화록을 `후보자: …` 평문으로 이어 붙이면 지원자가 답변에
 * 가짜 `면접관:` 줄이나 `## 평가 지침` 을 넣어 평가자를 속일 수 있었다.
 *  - 발언마다 요청별 난수(nonce) 태그로 감싼다 → 지원자는 태그를 미리 알 수 없어 위조 불가.
 *  - 본문 안의 역할 접두·마크다운 제목·태그 유사 문자열을 무력화한다.
 *  - 점수는 스키마로 받고 코드에서 클램프, 종합 점수·추천 등급은 4차원 점수로 재계산한다.
 */
import { randomBytes } from "node:crypto";
import type { InterviewEvaluation, InterviewMessage } from "./schema";
import type { ChatTranscript, TranscriptStats } from "./prompts";
import { generateJSON } from "./gemini";
import { log } from "./logger";

const ROLE_WORDS =
  "면접관|후보자|지원자|평가자|채점자|채용\\s*담당자|인사\\s*담당자|시스템|관리자|interviewer|candidate|applicant|evaluator|assistant|system|user|model|human";
// 줄 머리(공백·인용·불릿 허용)의 "역할:" 표기
const ROLE_PREFIX_RE = new RegExp(
  `^([ \\t>*_\\-•·]*)(${ROLE_WORDS})[ \\t]*[:：]`,
  "gimu"
);
// 마크다운 제목 기호
const HEADING_RE = /^([ \t]*)#{1,6}(?=[ \t]|$)/gm;
// 대화록 구분 태그를 흉내 낸 문자열
const TAG_LIKE_RE = /<\s*\/?\s*(turn|transcript|대화록|발언)[^>]*>/gi;

/** 발언 본문 무력화 — 화자 위조·지시 블록 흉내를 데이터로 바꾼다. */
export function neutralizeTurnText(text: string): string {
  return text
    .replace(TAG_LIKE_RE, (m) => m.replace(/</g, "‹").replace(/>/g, "›"))
    .replace(ROLE_PREFIX_RE, "$1「$2」(입력 텍스트)")
    .replace(HEADING_RE, "$1")
    .replace(/"""/g, '"');
}

/** 평가 프롬프트용 대화록 — 발언마다 요청별 nonce 태그로 감싼다. */
export function buildChatTranscript(messages: InterviewMessage[]): ChatTranscript {
  const tag = `turn_${randomBytes(6).toString("hex")}`;
  const text = messages
    .map((m, i) => {
      const role = m.role === "user" ? "후보자" : "면접관";
      return `<${tag} n="${i + 1}" role="${role}">\n${neutralizeTurnText(
        m.content ?? ""
      )}\n</${tag}>`;
    })
    .join("\n");
  return { text, tag };
}

// 문자열 리터럴 타입 — Type enum 과 동일 값 (prompts.ts QUESTION_SHEET_SCHEMA 와 같은 방식).
const AXES = ["기술역량", "실무경험", "협업커뮤니케이션", "직무적합성"] as const;
// prompts.ts buildSummaryPrompt 4단계와 동일 가중치.
const AXIS_WEIGHTS: Record<(typeof AXES)[number], number> = {
  기술역량: 0.35,
  실무경험: 0.3,
  협업커뮤니케이션: 0.15,
  직무적합성: 0.2,
};

const AXIS_SCHEMA = {
  type: "OBJECT",
  properties: { score: { type: "INTEGER" }, comment: { type: "STRING" } },
  required: ["score", "comment"],
  propertyOrdering: ["score", "comment"],
};

export function buildInterviewEvalSchema(withCultureFit: boolean) {
  const properties: Record<string, unknown> = {
    overall_score: { type: "INTEGER" },
    recommendation: { type: "STRING", enum: ["강력추천", "추천", "보류", "비추천"] },
    summary: { type: "STRING" },
    scores: {
      type: "OBJECT",
      properties: Object.fromEntries(AXES.map((a) => [a, AXIS_SCHEMA])),
      required: [...AXES],
      propertyOrdering: [...AXES],
    },
    strengths: { type: "ARRAY", items: { type: "STRING" } },
    concerns: { type: "ARRAY", items: { type: "STRING" } },
    followup_questions: { type: "ARRAY", items: { type: "STRING" } },
    llm_assist_note: { type: "STRING" },
    ai_authorship: {
      type: "OBJECT",
      properties: {
        likelihood: { type: "STRING", enum: ["낮음", "보통", "높음"] },
        score: { type: "INTEGER" },
        signals: { type: "ARRAY", items: { type: "STRING" } },
        note: { type: "STRING" },
      },
      required: ["likelihood", "score", "signals", "note"],
      propertyOrdering: ["likelihood", "score", "signals", "note"],
    },
  };
  const order = [
    "overall_score",
    "recommendation",
    "summary",
    "scores",
    "strengths",
    "concerns",
    "followup_questions",
  ];
  if (withCultureFit) {
    properties.culture_fit = {
      type: "OBJECT",
      properties: {
        items: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              topic: { type: "STRING" },
              self_report: { type: "STRING" },
              verification: { type: "STRING", enum: ["일치", "불일치", "미검증"] },
              evidence: { type: "STRING" },
            },
            required: ["topic", "self_report", "verification", "evidence"],
            propertyOrdering: ["topic", "self_report", "verification", "evidence"],
          },
        },
        fit_note: { type: "STRING" },
      },
      required: ["items", "fit_note"],
      propertyOrdering: ["items", "fit_note"],
    };
    order.push("culture_fit");
  }
  order.push("llm_assist_note", "ai_authorship");
  return {
    type: "OBJECT",
    properties,
    required: [
      "overall_score",
      "recommendation",
      "summary",
      "scores",
      "strengths",
      "concerns",
      "followup_questions",
      ...(withCultureFit ? ["culture_fit"] : []),
    ],
    propertyOrdering: order,
  };
}

export function clampScore(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.min(100, Math.max(0, v));
}

function recoFromScore(s: number): InterviewEvaluation["recommendation"] {
  return s >= 85 ? "강력추천" : s >= 70 ? "추천" : s >= 55 ? "보류" : "비추천";
}

function toStringArray(a: unknown): string[] {
  return Array.isArray(a)
    ? a.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** 프롬프트 statsLine 의 분량별 종합 점수 상한을 코드로도 강제 (단답 인젝션으로 고득점 방지). */
function overallCapFromStats(stats?: TranscriptStats | null): number {
  if (!stats) return 100;
  if (stats.candidateTurns === 0 || stats.candidateChars < 50) return 30;
  if (stats.candidateChars < 200) return 60;
  if (stats.candidateChars < 500) return 78;
  return 100;
}

/**
 * LLM 출력 정규화 — 점수 클램프, 종합 점수 = 4차원 가중 평균(코드 재계산), 추천 등급 = 점수 매핑.
 * 저장 형태(InterviewEvaluation)는 기존과 동일.
 */
export function normalizeInterviewEvaluation(
  raw: unknown,
  opts: { stats?: TranscriptStats | null; withCultureFit: boolean }
): InterviewEvaluation {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawScores = (
    r.scores && typeof r.scores === "object" ? r.scores : {}
  ) as Record<string, { score?: unknown; comment?: unknown } | undefined>;

  const scores: InterviewEvaluation["scores"] = {};
  let weighted = 0;
  let totalW = 0;
  for (const axis of AXES) {
    const v = rawScores[axis];
    const has = !!v && typeof v.score === "number" && Number.isFinite(v.score);
    const s = clampScore(v?.score);
    scores[axis] = { score: s, comment: has ? str(v?.comment) : "평가 응답 누락" };
    if (has) {
      weighted += s * AXIS_WEIGHTS[axis];
      totalW += AXIS_WEIGHTS[axis];
    }
  }
  // 차원 점수가 전무하면 모델 종합값을 믿지 않고 평가 실패로 처리(재평가 경로, 과금 없음).
  if (totalW === 0) throw new Error("평가 응답에 차원 점수가 없습니다.");
  const overall = Math.min(
    Math.round(weighted / totalW),
    overallCapFromStats(opts.stats)
  );

  const out: InterviewEvaluation = {
    overall_score: overall,
    recommendation: recoFromScore(overall),
    summary: str(r.summary),
    scores,
    strengths: toStringArray(r.strengths),
    concerns: toStringArray(r.concerns),
    followup_questions: toStringArray(r.followup_questions),
  };
  if (typeof r.llm_assist_note === "string") out.llm_assist_note = r.llm_assist_note;

  const aa = r.ai_authorship as Record<string, unknown> | undefined;
  if (aa && typeof aa === "object") {
    const score = clampScore(aa.score);
    const likelihood =
      aa.likelihood === "낮음" || aa.likelihood === "보통" || aa.likelihood === "높음"
        ? aa.likelihood
        : score >= 67
          ? "높음"
          : score >= 34
            ? "보통"
            : "낮음";
    out.ai_authorship = {
      likelihood,
      score,
      signals: toStringArray(aa.signals),
      note: str(aa.note),
    };
  }

  const cf = r.culture_fit as Record<string, unknown> | undefined;
  if (opts.withCultureFit && cf && typeof cf === "object") {
    const items = Array.isArray(cf.items) ? cf.items : [];
    out.culture_fit = {
      items: items
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({
          topic: str(x.topic),
          self_report: str(x.self_report),
          verification:
            x.verification === "일치" || x.verification === "불일치"
              ? x.verification
              : "미검증",
          evidence: str(x.evidence),
        })),
      fit_note: str(cf.fit_note),
    };
  }
  return out;
}

const SCHEMA_REJECT_RE = /\b400\b|INVALID_ARGUMENT/i;

/** 평가 LLM 호출 + 정규화. 스키마가 거부(400)되면 스키마 없이 1회 재시도 — 정규화가 형태를 보장. */
export async function generateInterviewEvaluation(
  prompt: string,
  opts: {
    stats?: TranscriptStats | null;
    withCultureFit: boolean;
    allowFallback: boolean;
  }
): Promise<InterviewEvaluation> {
  let raw: unknown;
  try {
    raw = await generateJSON<unknown>(prompt, {
      task: "interviewEval",
      allowFallback: opts.allowFallback,
      responseSchema: buildInterviewEvalSchema(opts.withCultureFit),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!SCHEMA_REJECT_RE.test(msg) || msg.includes("JSON 파싱 실패")) throw e;
    log.warn("interview_eval_schema_rejected", { error: msg.slice(0, 300) });
    raw = await generateJSON<unknown>(prompt, {
      task: "interviewEval",
      allowFallback: opts.allowFallback,
    });
  }
  return normalizeInterviewEvaluation(raw, {
    stats: opts.stats,
    withCultureFit: opts.withCultureFit,
  });
}

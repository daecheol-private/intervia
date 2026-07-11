import { GoogleGenAI } from "@google/genai";
import { log } from "./logger";

/**
 * 사용처별 Gemini 모델 매핑.
 *
 * 2026-05-26 단일화: 모든 task 를 Vertex AI 서울 리전(asia-northeast3) + gemini-2.5-flash 로 통합.
 *   - asia-northeast3 데이터 레지던시는 flash 만 지원 (pro 미지원).
 *   - 국외이전(§28의8) 회피 → 후보자 동의 항목 단순화.
 *
 * SDK 는 통합 `@google/genai` 단일 패키지.
 */
export const MODELS = {
  screening: "gemini-2.5-flash",
  interview: "gemini-2.5-flash",
  interviewEval: "gemini-2.5-flash",
  // 1차 면접 질문지 생성 — 이력서·서류평가·AI면접 평가 종합. 동기 호출(버튼 클릭).
  questionGen: "gemini-2.5-flash",
  // 법인 중복 등록 탐지 — 가입 제출 시 입력 법인명 vs 기존 법인 교차표기(한글↔영문)·약칭 매칭.
  orgMatch: "gemini-2.5-flash",
} as const;

export type LlmTask = keyof typeof MODELS;

/**
 * Vertex AI 클라이언트 — 리전별 싱글톤.
 *
 * 운영(Vercel): GOOGLE_APPLICATION_CREDENTIALS_JSON (서비스계정 JSON 전체 문자열).
 * 로컬 dev: GOOGLE_APPLICATION_CREDENTIALS (파일 경로 — SDK 자동 인식).
 */
// GoogleAuth 의 액세스 토큰 캐시가 인스턴스 단위라 리전별 1개만 만들어 재사용
// (호출마다 새로 만들면 JWT 서명+토큰 교환으로 +100~300ms). env 는 프로세스 불변.
const clientCache = new Map<string, GoogleGenAI>();

const PRIMARY_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "asia-northeast3";
// 폴백 리전 — 도쿄. §28의8 고지에 이전 "국가"를 특정해야 해서 글로벌 엔드포인트는 부적합하고,
// 도쿄는 기존 처리방침 고지 국가(일본 — Turso)와 정합 + 국내 지연 최소 (2026-07-11 실측 정상).
const FALLBACK_LOCATION = process.env.GEMINI_FALLBACK_LOCATION ?? "asia-northeast1";

function vertexClient(location: string) {
  const cached = clientCache.get(location);
  if (cached) return cached;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT가 설정되지 않았습니다.");
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  let client: GoogleGenAI;
  if (credentialsJson) {
    const creds = JSON.parse(credentialsJson) as {
      client_email: string;
      private_key: string;
    };
    client = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: {
        credentials: {
          client_email: creds.client_email,
          private_key: creds.private_key,
        },
      },
    });
  } else {
    client = new GoogleGenAI({ vertexai: true, project, location });
  }
  clientCache.set(location, client);
  return client;
}

/**
 * Thinking budget — Gemini 2.5 는 기본 thinking on.
 * flash 는 thinkingBudget=0 으로 끌 수 있으나, 면접 응답 품질을 위해 최소치 유지.
 *
 * 측정 (2026-05-22, pro 기준 — flash 통합 후 재측정 권장):
 *   default(dynamic) → 13~15초
 *   thinkingBudget=128 → 3~4초
 *
 * 비동기 task (screening / interviewEval) 는 기본값 유지.
 */
const THINKING_BUDGET: Record<LlmTask, number | undefined> = {
  screening: undefined,
  interview: 128,
  interviewEval: undefined,
  questionGen: undefined,
  // 짧은 분류 작업 — thinking 불필요. 가입 동기 호출이라 지연 최소화.
  orgMatch: 0,
};

const TRANSIENT_PATTERNS =
  /\b(503|429)\b|high demand|temporarily unavailable|UNAVAILABLE|RESOURCE_EXHAUSTED|timeout|ECONNRESET|ETIMEDOUT/i;

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.test(msg);
}

/**
 * LLM 응답 텍스트를 JSON 으로 파싱. 실패 시 *실제 원인* 을 메시지에 담아 throw.
 *
 * 기존엔 빈 응답이면 `JSON.parse("")` 가 "Unexpected end of JSON input" 만 던져
 * 진짜 원인(안전성 차단 / thinking 토큰 소진으로 인한 MAX_TOKENS / 빈 후보)이 가려졌다.
 * finishReason·blockReason·원문 일부를 메시지에 실어 로그·UI 에서 바로 식별 가능하게 한다.
 */
function parseJsonResponse<T>(result: {
  text?: string;
  candidates?: Array<{ finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}): T {
  const finish = result.candidates?.[0]?.finishReason;
  const block = result.promptFeedback?.blockReason;
  const raw = (result.text ?? "").trim();

  if (!raw) {
    throw new Error(
      `LLM 빈 응답 (finishReason=${finish ?? "?"}${
        block ? `, blockReason=${block}` : ""
      }). ` +
        (finish === "MAX_TOKENS"
          ? "출력 토큰 한도 초과 — thinking 이 토큰을 소진했을 수 있음."
          : finish === "SAFETY" || finish === "RECITATION" || block
            ? "안전성/저작권 필터에 의해 차단됨."
            : "응답 본문 없음.")
    );
  }

  // 코드펜스(```json ... ```) 방어적 제거 — responseMimeType=json 이면 보통 없지만 안전망.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(
      `LLM JSON 파싱 실패 (finishReason=${finish ?? "?"}): ${cleaned.slice(0, 300)}`
    );
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  ctx: { op: string; task: LlmTask }
): Promise<T> {
  const MAX_RETRIES = 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransient(e) || attempt === MAX_RETRIES) throw e;
      const delayMs = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
      log.warn("gemini.transient_retry", {
        op: ctx.op,
        task: ctx.task,
        attempt: attempt + 1,
        delayMs,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// 서울 장애 서킷브레이커 — 서버리스 웜 인스턴스 단위 best-effort.
// transient 실패(재시도 소진)가 연속 2회면 60초간 폴백 허용 호출은 서울을 건너뛴다
// (동기 기능이 매번 서울 재시도·타임아웃을 기다리지 않게). 만료 후 자동으로 서울 복귀.
let primaryFailStreak = 0;
let primaryDownUntil = 0;

function notePrimary(ok: boolean) {
  if (ok) {
    primaryFailStreak = 0;
    primaryDownUntil = 0;
  } else if (++primaryFailStreak >= 2) {
    primaryDownUntil = Date.now() + 60_000;
  }
}

/**
 * 서울(기본 리전) 우선 실행 + allowFallback 호출만 도쿄 폴백.
 *
 * ⚠️ allowFallback 은 프롬프트에 개인정보가 전혀 없는 호출만 켤 것.
 * 동의서·처리방침이 "AI 단계 국외이전 없음"을 전제하므로, 개인정보(마스킹 포함) 호출의
 * 폴백은 동의·처리방침 개정 전까지 금지 — docs/COMPLIANCE_SOP.md §4.
 */
async function runWithFallback<T>(
  run: (client: GoogleGenAI) => Promise<T>,
  ctx: { op: string; task: LlmTask; allowFallback?: boolean }
): Promise<T> {
  const { op, task } = ctx;
  if (ctx.allowFallback && Date.now() < primaryDownUntil) {
    log.warn("gemini.fallback_used", {
      op,
      task,
      location: FALLBACK_LOCATION,
      reason: "circuit_open",
    });
    try {
      return await withRetry(() => run(vertexClient(FALLBACK_LOCATION)), {
        op: `${op}.fallback`,
        task,
      });
    } catch (e) {
      if (!isTransient(e)) throw e;
      // 도쿄도 장애 — 마지막으로 서울 1회
      return await run(vertexClient(PRIMARY_LOCATION));
    }
  }
  try {
    const result = await withRetry(() => run(vertexClient(PRIMARY_LOCATION)), {
      op,
      task,
    });
    notePrimary(true);
    return result;
  } catch (e) {
    if (isTransient(e)) notePrimary(false);
    if (!ctx.allowFallback || !isTransient(e)) throw e;
    log.warn("gemini.fallback_used", {
      op,
      task,
      location: FALLBACK_LOCATION,
      reason: e instanceof Error ? e.message.slice(0, 150) : String(e).slice(0, 150),
    });
    return withRetry(() => run(vertexClient(FALLBACK_LOCATION)), {
      op: `${op}.fallback`,
      task,
    });
  }
}

export async function generateJSON<T>(
  prompt: string,
  opts?: {
    task?: LlmTask;
    responseSchema?: unknown;
    temperature?: number;
    timeoutMs?: number;
    /** 프롬프트에 개인정보가 전혀 없는 호출만 true — runWithFallback 주석 참조. */
    allowFallback?: boolean;
  }
): Promise<T> {
  const task: LlmTask = opts?.task ?? "screening";
  const thinkingBudget = THINKING_BUDGET[task];
  return runWithFallback(
    async (client) => {
      const config: Record<string, unknown> = {
        responseMimeType: "application/json",
        // 평가 일관성을 위해 호출부가 temperature 를 낮출 수 있음(screening=0). 기본 0.2.
        temperature: opts?.temperature ?? 0.2,
      };
      // responseSchema 지정 시 Gemini 가 스키마에 맞는 유효 JSON 을 *보장* →
      // 긴 자유서술 필드에서 따옴표·제어문자 이스케이프가 깨져 파싱 실패하던 문제 차단.
      if (opts?.responseSchema) {
        config.responseSchema = opts.responseSchema;
      }
      if (thinkingBudget !== undefined) {
        config.thinkingConfig = { thinkingBudget };
      }
      // 하드 타임아웃 — 호출부가 timeoutMs 를 주면 httpOptions.timeout + AbortController 로
      // 응답 지연에 상한을 건다. 서버리스(maxDuration) 안에서 도는 무거운 호출(대면 면접 평가 등)이
      // 늦어질 때 함수가 통째로 강제종료(→ 큐가 "stuck: 재시도 상한 초과" 로 영구실패)되는 대신,
      // 여기서 abort 로 깔끔히 끊겨 호출부의 catch·재시도로 이어지게 한다. (멀티모달 전사와 동일 사상.)
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (opts?.timeoutMs) {
        config.httpOptions = { timeout: opts.timeoutMs };
        const ctrl = new AbortController();
        timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
        config.abortSignal = ctrl.signal;
      }
      try {
        const result = await client.models.generateContent({
          model: MODELS[task],
          contents: prompt,
          config: config as Parameters<
            GoogleGenAI["models"]["generateContent"]
          >[0]["config"],
        });
        return parseJsonResponse<T>(result);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    { op: "generateJSON", task, allowFallback: opts?.allowFallback }
  );
}

export async function generateJSONMultimodal<T>(
  parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  >,
  opts?: { task?: LlmTask; timeoutMs?: number; allowFallback?: boolean }
): Promise<T> {
  const task: LlmTask = opts?.task ?? "screening";
  // OCR(스캔 PDF) 등 멀티모달 호출은 SDK 기본 타임아웃(1분)이 worker maxDuration(120s)에
  // 근접해, 평가까지 겹치면 함수가 self-chain 전에 강제종료될 수 있다. 호출부가 timeoutMs 를
  // 주면 httpOptions.timeout(서버 인지 타임아웃) + AbortController(클라이언트 하드 실링)를
  // 함께 걸어, 응답이 늦으면 transient 오류로 즉시 끊고 큐가 백오프 재시도하게 한다.
  return runWithFallback(
    async (client) => {
      const config: Record<string, unknown> = {
        responseMimeType: "application/json",
        temperature: 0.2,
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (opts?.timeoutMs) {
        config.httpOptions = { timeout: opts.timeoutMs };
        const ctrl = new AbortController();
        timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
        config.abortSignal = ctrl.signal;
      }
      try {
        const result = await client.models.generateContent({
          model: MODELS[task],
          contents: [{ role: "user", parts: parts as never }],
          config: config as Parameters<
            GoogleGenAI["models"]["generateContent"]
          >[0]["config"],
        });
        return parseJsonResponse<T>(result);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    { op: "generateJSONMultimodal", task, allowFallback: opts?.allowFallback }
  );
}

/**
 * 면접 채팅 스트리밍 시작 — generateJSON 과 동일한 서울 우선 + 도쿄 폴백 정책(runWithFallback).
 * 스트림은 첫 토큰 이후 재시도가 불가(부분 토큰이 이미 클라이언트에 갔을 수 있음)하므로
 * 재시도·폴백은 "시작 단계"에만 적용된다.
 * allowFallback 은 호출부가 동의·시행일 게이트(lib/consent.ts piiFallbackActive 등)를 통과시킨 값.
 */
export async function startChatStream(opts: {
  task: LlmTask;
  systemInstruction: string;
  history: Array<{ role: string; parts: Array<{ text: string }> }>;
  message: string;
  allowFallback?: boolean;
}) {
  const thinkingBudget = THINKING_BUDGET[opts.task];
  const config: Record<string, unknown> = {
    systemInstruction: opts.systemInstruction,
  };
  if (thinkingBudget !== undefined) {
    config.thinkingConfig = { thinkingBudget };
  }
  return runWithFallback(
    (client) =>
      client.chats
        .create({
          model: MODELS[opts.task],
          history: opts.history as never,
          config: config as never,
        })
        .sendMessageStream({ message: opts.message }),
    { op: "chatStream", task: opts.task, allowFallback: opts.allowFallback }
  );
}

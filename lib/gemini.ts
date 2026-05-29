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
} as const;

export type LlmTask = keyof typeof MODELS;

/**
 * Vertex AI 클라이언트 — 모든 task 공통.
 *
 * 운영(Vercel): GOOGLE_APPLICATION_CREDENTIALS_JSON (서비스계정 JSON 전체 문자열).
 * 로컬 dev: GOOGLE_APPLICATION_CREDENTIALS (파일 경로 — SDK 자동 인식).
 */
function vertexClient() {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT가 설정되지 않았습니다.");
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "asia-northeast3";
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credentialsJson) {
    const creds = JSON.parse(credentialsJson) as {
      client_email: string;
      private_key: string;
    };
    return new GoogleGenAI({
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
  }
  return new GoogleGenAI({ vertexai: true, project, location });
}

function clientFor(_task: LlmTask) {
  return vertexClient();
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
};

const TRANSIENT_PATTERNS =
  /\b(503|429)\b|high demand|temporarily unavailable|UNAVAILABLE|RESOURCE_EXHAUSTED|timeout|ECONNRESET|ETIMEDOUT/i;

function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.test(msg);
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

export async function generateJSON<T>(
  prompt: string,
  opts?: { task?: LlmTask }
): Promise<T> {
  const task: LlmTask = opts?.task ?? "screening";
  const thinkingBudget = THINKING_BUDGET[task];
  return withRetry(
    async () => {
      const config: Record<string, unknown> = {
        responseMimeType: "application/json",
        temperature: 0.2,
      };
      if (thinkingBudget !== undefined) {
        config.thinkingConfig = { thinkingBudget };
      }
      const result = await clientFor(task).models.generateContent({
        model: MODELS[task],
        contents: prompt,
        config: config as Parameters<
          ReturnType<typeof clientFor>["models"]["generateContent"]
        >[0]["config"],
      });
      const text = result.text ?? "";
      return JSON.parse(text) as T;
    },
    { op: "generateJSON", task }
  );
}

export async function generateJSONMultimodal<T>(
  parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  >,
  opts?: { task?: LlmTask }
): Promise<T> {
  const task: LlmTask = opts?.task ?? "screening";
  return withRetry(
    async () => {
      const result = await clientFor(task).models.generateContent({
        model: MODELS[task],
        contents: [{ role: "user", parts: parts as never }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });
      const text = result.text ?? "";
      return JSON.parse(text) as T;
    },
    { op: "generateJSONMultimodal", task }
  );
}

export function createChat(opts: {
  task: LlmTask;
  systemInstruction: string;
  history: Array<{ role: string; parts: Array<{ text: string }> }>;
}) {
  const thinkingBudget = THINKING_BUDGET[opts.task];
  const config: Record<string, unknown> = {
    systemInstruction: opts.systemInstruction,
  };
  if (thinkingBudget !== undefined) {
    config.thinkingConfig = { thinkingBudget };
  }
  return clientFor(opts.task).chats.create({
    model: MODELS[opts.task],
    history: opts.history as never,
    config: config as never,
  });
}

export async function startChatStreamWithRetry<T>(
  fn: () => Promise<T>,
  task: LlmTask = "interview"
): Promise<T> {
  return withRetry(fn, { op: "chatStream", task });
}

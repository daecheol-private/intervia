/**
 * 면접 turn latency 측정 — flash + thinkingBudget 분기.
 *
 * 2026-05-26: 모든 task Vertex AI 서울 + flash 통합 이후 재측정용.
 * lib/gemini.ts 의 interview 기본값은 thinkingBudget=128 (3~4초 목표).
 */
import "./_load-env.mjs";
import { GoogleGenAI } from "@google/genai";

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "asia-northeast3";
if (!PROJECT) {
  console.error("❌ GOOGLE_CLOUD_PROJECT 미설정");
  process.exit(1);
}

function makeClient() {
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credentialsJson) {
    const creds = JSON.parse(credentialsJson);
    return new GoogleGenAI({
      vertexai: true,
      project: PROJECT,
      location: LOCATION,
      googleAuthOptions: {
        credentials: {
          client_email: creds.client_email,
          private_key: creds.private_key,
        },
      },
    });
  }
  return new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
}

const PROMPT = `한국어 존댓말 한 문장으로 자기소개를 부탁한다고 면접관처럼 말해줘.`;
const MODEL = "gemini-2.5-flash";

async function run(client, thinkingBudget) {
  const config = {};
  if (thinkingBudget !== undefined) {
    config.thinkingConfig = { thinkingBudget };
  }
  const t0 = Date.now();
  const r = await client.models.generateContent({
    model: MODEL,
    contents: PROMPT,
    config,
  });
  const ms = Date.now() - t0;
  const text = (r.text ?? "").trim();
  const u = r.usageMetadata;
  console.log(
    `thinking=${thinkingBudget ?? "default"} → ${ms}ms | total=${u?.totalTokenCount} | out=${u?.candidatesTokenCount}`
  );
  console.log(`   답변: ${text.slice(0, 80)}…\n`);
}

async function main() {
  console.log(`Vertex AI ${MODEL} latency 비교 (asia-northeast3):\n`);
  const client = makeClient();
  await run(client, undefined); // default thinking on
  await run(client, 0); // thinking off (flash 는 0 허용)
  await run(client, 128);
  await run(client, 512);
  await run(client, -1); // dynamic
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

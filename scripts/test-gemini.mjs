/**
 * Vertex AI 서울 (asia-northeast3) — task별 모델이 실제 호출 가능한지 sanity check.
 *
 * 2026-05-26 통합: 모든 task = gemini-2.5-flash on Vertex.
 *
 * 실행:
 *   node scripts/test-gemini.mjs              # 로컬 키 (.env.local, GOOGLE_APPLICATION_CREDENTIALS 파일)
 *   NODE_ENV=production node scripts/test-gemini.mjs  # 운영 키 (.env.production.local, _JSON 통문자열)
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

const TASKS = [
  { task: "screening (서류평가)", model: "gemini-2.5-flash" },
  { task: "interview (면접 채팅)", model: "gemini-2.5-flash" },
  { task: "interviewEval (면접 평가)", model: "gemini-2.5-flash" },
];

const PROMPT = `다음 문장을 한국어 존댓말로 한 문장 자연스럽게 다시 써주세요: "안녕 반가워"`;

async function testOne(client, { task, model }) {
  const t0 = Date.now();
  try {
    const r = await client.models.generateContent({ model, contents: PROMPT });
    const ms = Date.now() - t0;
    const text = (r.text ?? "").trim();
    const usage = r.usageMetadata;
    console.log(`✅ ${task}`);
    console.log(`   모델: ${model}`);
    console.log(`   응답: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`);
    console.log(
      `   토큰: in=${usage?.promptTokenCount ?? "?"} / out=${
        usage?.candidatesTokenCount ?? "?"
      } / total=${usage?.totalTokenCount ?? "?"}`
    );
    console.log(`   latency: ${ms}ms\n`);
    return { ok: true };
  } catch (e) {
    console.log(`❌ ${task}`);
    console.log(`   모델: ${model}`);
    console.log(`   에러: ${e instanceof Error ? e.message : String(e)}\n`);
    return { ok: false };
  }
}

async function main() {
  console.log(`Vertex AI: project=${PROJECT}, location=${LOCATION}\n`);
  const client = makeClient();
  const results = [];
  for (const t of TASKS) {
    results.push(await testOne(client, t));
  }
  const fail = results.filter((r) => !r.ok).length;
  if (fail > 0) {
    console.error(`\n❌ ${fail}건 실패. 서비스계정 권한·리전·모델 가용성 확인.`);
    process.exit(1);
  }
  console.log("✅ 모든 task Vertex AI 호출 성공.");
}

main().catch((e) => {
  console.error("❌ 스크립트 실패:", e);
  process.exit(1);
});

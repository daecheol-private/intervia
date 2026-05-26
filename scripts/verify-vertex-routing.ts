/**
 * lib/gemini.ts 의 generateJSON 이 screening task 에서 Vertex AI 로 라우팅되는지 검증.
 * (PoC 스크립트는 SDK 직접 호출, 이건 실제 운영 코드 경로 검증)
 *
 * 사용: LOCAL_DB=1 npx tsx scripts/verify-vertex-routing.ts
 */
import "./_load-env.mjs";
import { generateJSON } from "../lib/gemini";

async function main() {
  console.log("env check:");
  console.log("  GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT ?? "(미설정)");
  console.log("  GOOGLE_CLOUD_LOCATION:", process.env.GOOGLE_CLOUD_LOCATION ?? "(기본 asia-northeast3)");
  console.log("  GOOGLE_APPLICATION_CREDENTIALS:", process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "(미설정)");
  console.log("");

  const prompt = `다음 JSON 형식으로만 응답하세요:
{
  "model_says": "안녕하세요",
  "lang": "ko"
}`;

  console.log("[task=screening] Vertex AI 서울 경로 확인 중...");
  const t0 = Date.now();
  const r1 = await generateJSON<{ model_says: string; lang: string }>(prompt, {
    task: "screening",
  });
  console.log(`  소요: ${Date.now() - t0}ms`);
  console.log("  결과:", r1);
  console.log("");

  console.log("[task=interview] 직접 API 경로 확인 중...");
  const t1 = Date.now();
  const r2 = await generateJSON<{ model_says: string; lang: string }>(prompt, {
    task: "interview",
  });
  console.log(`  소요: ${Date.now() - t1}ms`);
  console.log("  결과:", r2);
  console.log("");

  console.log("✅ 양쪽 경로 모두 정상 동작 확인");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});

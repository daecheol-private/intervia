/**
 * Vertex AI Seoul Flash PoC.
 *
 * 목표: 같은 후보자 #11 에 대해 Vertex AI 서울 리전의 Gemini 2.5 Flash 로 서류평가를
 * 다시 실행하여, 현재 저장된 Gemini Pro 결과와 비교.
 *
 * 사용:
 *   LOCAL_DB=1 npx tsx scripts/poc-vertex-flash.ts            # 최근 후보자
 *   LOCAL_DB=1 npx tsx scripts/poc-vertex-flash.ts --id 11    # 특정 후보자
 *
 * 환경변수 필요:
 *   GOOGLE_APPLICATION_CREDENTIALS — 서비스 계정 JSON 키 경로
 *   GOOGLE_CLOUD_PROJECT           — GCP 프로젝트 ID
 *   GOOGLE_CLOUD_LOCATION          — 리전 (기본 asia-northeast3)
 */
import "./_load-env.mjs";
import { db } from "../lib/db";
import { candidates, jobPostings } from "../lib/schema";
import { buildScreeningPrompt } from "../lib/prompts";
import { eq, desc, isNotNull } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";

async function main() {
  const argv = process.argv.slice(2);
  let candidateId: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--id" && argv[i + 1]) {
      candidateId = Number(argv[i + 1]);
      i++;
    }
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? "asia-northeast3";
  if (!project) {
    console.error("환경변수 GOOGLE_CLOUD_PROJECT 미설정");
    process.exit(1);
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("환경변수 GOOGLE_APPLICATION_CREDENTIALS 미설정");
    process.exit(1);
  }

  let candidate;
  if (candidateId) {
    [candidate] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, candidateId));
  } else {
    [candidate] = await db
      .select()
      .from(candidates)
      .where(isNotNull(candidates.resumeMaskedText))
      .orderBy(desc(candidates.id))
      .limit(1);
  }
  if (!candidate) {
    console.error("후보자 없음");
    process.exit(1);
  }

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (!job) {
    console.error(`job ${candidate.jobId} 없음`);
    process.exit(1);
  }

  const masked = candidate.resumeMaskedText ?? "";
  if (masked.length < 30) {
    console.error("마스킹 텍스트 부족");
    process.exit(1);
  }

  const prompt = buildScreeningPrompt(
    {
      position: job.position,
      level: job.level,
      employmentType: job.employmentType,
      responsibilities: job.responsibilities,
      requirements: job.requirements,
      idealProfile: job.idealProfile ?? undefined,
      tone: job.tone ?? undefined,
    },
    masked
  );

  console.log(`Project: ${project}  /  Location: ${location}`);
  console.log(`후보자 #${candidate.id} (${candidate.name})  공고 #${job.id}`);
  console.log(`프롬프트 길이: ${prompt.length}자`);
  console.log("Vertex AI 호출 시작...\n");

  const vertex = new GoogleGenAI({ vertexai: true, project, location });

  const t0 = Date.now();
  const result = await vertex.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });
  const elapsed = Date.now() - t0;

  const text = result.text ?? "";
  console.log(`응답 시간: ${elapsed}ms`);
  console.log(`응답 길이: ${text.length}자\n`);

  console.log("=".repeat(70));
  console.log("[Vertex AI Seoul Flash 결과]");
  console.log("=".repeat(70));
  try {
    const parsed = JSON.parse(text);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log("(JSON 파싱 실패 — 원본 출력)");
    console.log(text);
  }

  console.log("\n" + "=".repeat(70));
  console.log("[현재 저장된 Gemini 결과 — 비교 기준]");
  console.log("=".repeat(70));
  const report = candidate.screeningReport as {
    score: number;
    recommendation: string;
    summary?: string;
    breakdown?: Record<string, { score: number; reason: string } | undefined>;
    strengths?: string[];
    concerns?: string[];
    matched_keywords?: string[];
  } | null;
  if (report) {
    console.log(`점수: ${report.score} / 추천: ${report.recommendation}`);
    const b = report.breakdown ?? {};
    console.log(
      `차원: tech=${b.tech_fit?.score} / exp=${b.experience_depth?.score} / role=${b.role_match?.score} / growth=${b.growth_attitude?.score}`
    );
    console.log(`강점 수: ${(report.strengths ?? []).length}개`);
    console.log(`우려 수: ${(report.concerns ?? []).length}개`);
    console.log(`매칭 키워드 수: ${(report.matched_keywords ?? []).length}개`);
  } else {
    console.log("(저장된 결과 없음)");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});

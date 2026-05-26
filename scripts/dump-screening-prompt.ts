/**
 * HyperCLOVA PoC 용 — 특정 후보자의 서류평가 프롬프트를 그대로 출력.
 *
 * CLOVA Studio Playground 에 붙여넣어 HCX-005 결과와 현재 저장된 Gemini 결과를 비교.
 *
 * 사용:
 *   LOCAL_DB=1 npx tsx scripts/dump-screening-prompt.ts            # 최근 업로드 후보자
 *   LOCAL_DB=1 npx tsx scripts/dump-screening-prompt.ts --id 42    # candidate id 지정
 */
import "./_load-env.mjs";
import { db } from "../lib/db";
import { candidates, jobPostings } from "../lib/schema";
import { buildScreeningPrompt } from "../lib/prompts";
import { eq, desc, isNotNull } from "drizzle-orm";

async function main() {
  const argv = process.argv.slice(2);
  let candidateId: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--id" && argv[i + 1]) {
      candidateId = Number(argv[i + 1]);
      i++;
    }
  }

  let candidate;
  if (candidateId) {
    [candidate] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, candidateId));
    if (!candidate) {
      console.error(`candidate ${candidateId} 없음`);
      process.exit(1);
    }
  } else {
    [candidate] = await db
      .select()
      .from(candidates)
      .where(isNotNull(candidates.resumeMaskedText))
      .orderBy(desc(candidates.id))
      .limit(1);
    if (!candidate) {
      console.error("마스킹된 후보자 없음 — 이력서 먼저 업로드 필요");
      process.exit(1);
    }
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
    console.error("마스킹 텍스트 짧음/없음");
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

  const report = candidate.screeningReport as
    | {
        score: number;
        recommendation: string;
        summary?: string;
        breakdown?: Record<
          string,
          { score: number; reason: string } | undefined
        >;
        strengths?: string[];
        concerns?: string[];
        interview_focus?: string[];
        matched_keywords?: string[];
      }
    | null;

  const line = "=".repeat(70);
  const out: string[] = [];
  out.push(line);
  out.push(`후보자 #${candidate.id}  /  공고 #${job.id} — ${job.position}`);
  out.push(
    `이름: ${candidate.name}  /  레벨: ${job.level}  /  고용: ${job.employmentType}`
  );
  out.push(`마스킹 텍스트 길이: ${masked.length}자`);
  out.push(line);
  out.push("");
  out.push("[현재 저장된 Gemini 결과 — 비교 기준]");
  out.push(line);
  if (report) {
    out.push(`점수: ${report.score} / 추천: ${report.recommendation}`);
    out.push(`한줄평: ${report.summary ?? ""}`);
    if (report.breakdown) {
      const b = report.breakdown;
      out.push(
        `차원: tech_fit=${b.tech_fit?.score} / experience=${b.experience_depth?.score} / role=${b.role_match?.score} / growth=${b.growth_attitude?.score}`
      );
    }
    out.push(`강점:`);
    (report.strengths ?? []).forEach((s) => out.push(`  - ${s}`));
    out.push(`우려:`);
    (report.concerns ?? []).forEach((s) => out.push(`  - ${s}`));
    out.push(`면접 중점:`);
    (report.interview_focus ?? []).forEach((s) => out.push(`  - ${s}`));
    out.push(`매칭 키워드: ${(report.matched_keywords ?? []).join(", ")}`);
  } else {
    out.push(
      "(아직 평가 결과 없음 — 후보자 페이지에서 'AI 검토 요청' 실행하면 생성됨)"
    );
  }
  out.push("");
  out.push(line);
  out.push("[HyperCLOVA Playground 에 붙여넣을 프롬프트]");
  out.push(line);
  out.push("↓↓↓ 아래부터 다음 구분선까지 통째로 복사 ↓↓↓");
  out.push("");
  out.push(prompt);
  out.push("");
  out.push("↑↑↑ 여기까지 ↑↑↑");
  out.push(line);
  out.push("");
  out.push("Playground 설정 권장값:");
  out.push("  - 모델: HCX-005");
  out.push("  - Temperature: 0.3");
  out.push("  - Top P: 0.8");
  out.push("  - Max Tokens: 4096");
  out.push("  - Response Format: JSON (또는 'JSON 모드' 토글)");
  out.push("  - System Prompt: (비워두기)");
  out.push(line);

  console.log(out.join("\n"));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

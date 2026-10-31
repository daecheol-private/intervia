/**
 * 백필 — 이미 평가된 후보자의 저장 리포트에 새 채점 로직(recomputeScore)을 재적용.
 *
 * 왜: recomputeScore 산식을 바꿔도 (1) candidates.screeningReport 는 평가 당시 점수로
 *     고정 저장돼 있고 (2) screening_cache 는 옛 결과를 그대로 돌려줘, 이미 평가된 후보는
 *     코드만 고쳐선 점수가 갱신되지 않는다. 이 스크립트가 *저장된 6축·gate 입력*으로 점수만
 *     다시 계산한다 — **LLM 재호출 없음 → 과금 0**. (캐시는 SCREENING_SCORING_VERSION 으로
 *     이미 무효화되므로 향후 재평가도 새 산식을 쓴다.)
 *
 * 안전: 기본 DRY-RUN(미리보기, 쓰기 없음). 실제 적용은 --apply.
 *       멱등 — 입력(breakdown/level_match/focus_match)은 안 건드리고 점수만 재도출하므로
 *       여러 번 돌려도 같은 결과. 되돌리려면 해당 후보를 재평가하면 LLM 이 새로 생성.
 *
 * ⚠️ 운영 대상이면 **DRY-RUN 과 --apply 를 같은 NODE_ENV 로** 돌려야 한다. dev 모드에서는
 *    TURSO_DATABASE_URL 이 있어도 lib/db.ts 가 file:./data.db 로 폴백하므로, 맨손으로 돌린
 *    미리보기는 로컬 후보자를 보여주고 --apply 는 운영에 쓰게 된다(스크립트가 멈춘다).
 *    상세: docs/RUNBOOK.md §10.
 *
 * 사용 (PowerShell):
 *   # 로컬
 *   $env:LOCAL_DB="1"; npx tsx scripts/backfill-screening-scores.ts            # 미리보기
 *   $env:LOCAL_DB="1"; npx tsx scripts/backfill-screening-scores.ts --apply    # 적용
 *
 *   # 운영 (끝나면 $env:NODE_ENV="" 로 되돌릴 것)
 *   $env:NODE_ENV="production"
 *   npx tsx scripts/backfill-screening-scores.ts                               # 미리보기(읽기전용)
 *   npx tsx scripts/backfill-screening-scores.ts --apply                       # 적용 ⚠️ 백업 후
 *
 *   ...  --org 12                                                              # 특정 법인만
 */
import "./_load-env.mjs";
import { db, currentDbTarget } from "../lib/db";
import { candidates, jobPostings } from "../lib/schema";
import { recomputeScore } from "../lib/screening";
import { hasEvaluationFocus } from "../lib/prompts";
import { and, eq, isNotNull } from "drizzle-orm";

type Report = Parameters<typeof recomputeScore>[0];

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const oi = argv.indexOf("--org");
  const orgId = oi >= 0 && argv[oi + 1] ? Number(argv[oi + 1]) : null;
  // env 가 아니라 "실제로 붙은 DB" 를 본다. dev 모드에서는 TURSO_DATABASE_URL 이 있어도
  // lib/db.ts 가 file:./data.db 로 폴백하므로, LOCAL_DB 만 보고 PRODUCTION 이라 찍으면
  // DRY-RUN 은 로컬을 읽고 --apply(NODE_ENV=production)는 운영에 쓰는 어긋남이 생긴다.
  const target = currentDbTarget();
  if (target.isLocalFile && process.env.LOCAL_DB !== "1") {
    console.error(
      `✋ 운영을 대상으로 돌리려던 것 같은데 실제로는 로컬 DB(${target.url})에 붙었습니다.\n` +
        "   dev 모드라 lib/db.ts 가 Turso 대신 로컬 파일로 폴백했습니다.\n" +
        '   · 운영 대상이면:  $env:NODE_ENV="production" 을 먼저 설정하세요\n' +
        "   · 일부러 로컬이면: LOCAL_DB=1 을 붙이세요\n" +
        "   이대로 두면 미리보기와 실제 적용 대상이 서로 다른 DB 가 됩니다."
    );
    process.exit(1);
  }

  console.log(
    `[backfill] DB=${target.isLocalFile ? `LOCAL (${target.url})` : `PRODUCTION ⚠️ (${target.url})`} / mode=${apply ? "APPLY ✍️" : "DRY-RUN 👀"}` +
      (orgId ? ` / org=${orgId}` : "")
  );
  if (apply && !target.isLocalFile) {
    console.log("⚠️  운영 DB 에 점수 쓰기 — 백업 확인! 5초 후 시작 (Ctrl+C 취소).");
    await new Promise((r) => setTimeout(r, 5000));
  }

  const rows = await db
    .select({
      id: candidates.id,
      jobId: candidates.jobId,
      screeningScore: candidates.screeningScore,
      screeningReport: candidates.screeningReport,
    })
    .from(candidates)
    .where(
      orgId
        ? and(isNotNull(candidates.screeningReport), eq(candidates.orgId, orgId))
        : isNotNull(candidates.screeningReport)
    );

  // 공고별 HR 평가 가이드 유무 캐시 (recomputeScore 의 hasFocusGuide 인자).
  const focusCache = new Map<number, boolean>();
  async function jobHasFocus(jobId: number): Promise<boolean> {
    const hit = focusCache.get(jobId);
    if (hit !== undefined) return hit;
    const [j] = await db
      .select({ ef: jobPostings.evaluationFocus })
      .from(jobPostings)
      .where(eq(jobPostings.id, jobId));
    const v = hasEvaluationFocus(j?.ef ?? undefined);
    focusCache.set(jobId, v);
    return v;
  }

  let changed = 0;
  let same = 0;
  let skipped = 0;
  const samples: string[] = [];
  for (const r of rows) {
    const report = r.screeningReport as unknown as Report | null;
    // breakdown 이 없으면 recomputeScore 가 LLM score 폴백이라 재계산 의미 없음 — 건너뜀.
    if (!report || !report.breakdown) {
      skipped++;
      continue;
    }
    const before = r.screeningScore ?? report.score;
    const guide = await jobHasFocus(r.jobId);
    // recomputeScore 는 report 를 in-place mutate (level_match.penalty, 빈가이드 focus 중립화 등).
    const { score, recommendation } = recomputeScore(report, guide);
    report.score = score;
    report.recommendation = recommendation;
    if (score === before) {
      same++;
      continue;
    }
    changed++;
    if (samples.length < 25)
      samples.push(`  #${r.id}: ${before} → ${score} (${recommendation})`);
    if (apply) {
      await db
        .update(candidates)
        .set({ screeningScore: score, screeningReport: report })
        .where(eq(candidates.id, r.id));
    }
  }

  console.log(
    `\n대상 ${rows.length}건 · 변경 ${changed} · 동일 ${same} · 건너뜀(breakdown 없음) ${skipped}`
  );
  if (samples.length) {
    console.log("\n변경 샘플 (최대 25):");
    samples.forEach((s) => console.log(s));
  }
  console.log(apply ? "\n✅ 적용 완료." : "\n👀 DRY-RUN — 실제 반영은 --apply 추가.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

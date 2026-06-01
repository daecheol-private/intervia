/**
 * 법인 단위 채용 퍼널 집계 — org_admin 대시보드용.
 *
 * 후보자의 `stage`(진행 단계)와 `outcome`(종결 결과)는 분리돼 있다.
 * 따라서 "진행 중 파이프라인"은 outcome IS NULL 기준 stage 분포로,
 * "결정 현황"은 outcome 분포로 따로 집계한다. (per-job funnel 라우트와 동일 원칙)
 */
import { db } from "@/lib/db";
import { candidates, jobPostings } from "@/lib/schema";
import { and, eq, gte, isNull, isNotNull, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });
  const orgId = me!.orgId;
  if (orgId == null)
    return new Response("법인 소속이 아닙니다.", { status: 400 });

  const url = new URL(req.url);
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") ?? 30), 365));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const orgCond = eq(candidates.orgId, orgId);

  // 진행 중(outcome IS NULL) stage 분포
  const pipelineRows = await db
    .select({ stage: candidates.stage, c: sql<number>`COUNT(*)` })
    .from(candidates)
    .where(and(orgCond, isNull(candidates.outcome)))
    .groupBy(candidates.stage);
  const pipeline: Record<string, number> = {};
  for (const r of pipelineRows) pipeline[r.stage] = Number(r.c);

  // 종결 결과(outcome) 분포
  const outcomeRows = await db
    .select({ outcome: candidates.outcome, c: sql<number>`COUNT(*)` })
    .from(candidates)
    .where(and(orgCond, isNotNull(candidates.outcome)))
    .groupBy(candidates.outcome);
  const outcomes: Record<string, number> = {};
  for (const r of outcomeRows) if (r.outcome) outcomes[r.outcome] = Number(r.c);

  // 총계 + 최근 N일 신규
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(candidates)
    .where(orgCond);
  const [{ recent }] = await db
    .select({ recent: sql<number>`COUNT(*)` })
    .from(candidates)
    .where(and(orgCond, gte(candidates.createdAt, since)));

  // 활성 공고 수
  const [{ activeJobs }] = await db
    .select({ activeJobs: sql<number>`COUNT(*)` })
    .from(jobPostings)
    .where(and(eq(jobPostings.orgId, orgId), eq(jobPostings.status, "active")));

  // 진행 중 후보자 평균 서류 점수
  const [{ avgScore }] = await db
    .select({ avgScore: sql<number | null>`AVG(${candidates.screeningScore})` })
    .from(candidates)
    .where(and(orgCond, isNull(candidates.outcome), isNotNull(candidates.screeningScore)));

  return Response.json({
    daysBack: days,
    total: Number(total),
    recentCount: Number(recent),
    activeJobs: Number(activeJobs),
    pipeline,
    outcomes,
    avgScreeningScore: avgScore == null ? null : Math.round(Number(avgScore)),
  });
}

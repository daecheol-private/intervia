/**
 * 첫 실행 가이드 진행 상태 — 플로팅 위젯(SetupGuideWidget)용.
 * 단계 판정 기준은 대시보드(app/page.tsx)의 setup1~4 와 동일.
 */
import { db } from "@/lib/db";
import { organizations, jobPostings, candidates } from "@/lib/schema";
import { eq, count, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "system_admin" || !me!.orgId)
    return Response.json({ show: false });

  const orgId = me!.orgId;
  const [org, jobAgg, candAgg] = await Promise.all([
    db
      .select({ cultureFitProfile: organizations.cultureFitProfile })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .then(([r]) => r ?? null),
    db
      .select({
        total: count(),
        latestId: sql<number | null>`MAX(${jobPostings.id})`,
      })
      .from(jobPostings)
      .where(eq(jobPostings.orgId, orgId))
      .then(([r]) => r),
    db
      .select({
        total: count(),
        interviewReached: sql<number>`SUM(CASE WHEN ${candidates.stage} IN ('ai_pending','ai_evaluated','round1_candidate','round1_scheduling','round1_waiting','round1_passed','round2_passed','hired') THEN 1 ELSE 0 END)`,
      })
      .from(candidates)
      .where(eq(candidates.orgId, orgId))
      .then(([r]) => r),
  ]);

  const step1 = org?.cultureFitProfile != null;
  const step2 = Number(jobAgg?.total ?? 0) > 0;
  const step3 = Number(candAgg?.total ?? 0) > 0;
  const step4 = Number(candAgg?.interviewReached ?? 0) > 0;
  return Response.json({
    show: !(step1 && step2 && step3 && step4),
    step1,
    step2,
    step3,
    step4,
    firstJobId: jobAgg?.latestId ?? null,
  });
}

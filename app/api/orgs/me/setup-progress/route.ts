/**
 * 첫 실행 가이드 진행 상태 — 플로팅 위젯(SetupGuideWidget)용.
 * 단계 판정 기준은 대시보드(app/page.tsx)의 setup1~4 와 동일.
 * 노출 여부는 완료와 무관 — 법인 구성원이 숨기기(POST) 전까지 계속 표시.
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
      .select({
        cultureFitProfile: organizations.cultureFitProfile,
        setupGuideDismissedAt: organizations.setupGuideDismissedAt,
      })
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
    show: org != null && org.setupGuideDismissedAt == null,
    step1,
    step2,
    step3,
    step4,
    firstJobId: jobAgg?.latestId ?? null,
  });
}

/** 가이드 숨기기 — 법인 단위 (모든 구성원 화면에서 사라짐). 멤버도 가능. */
export async function POST() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "system_admin" || !me!.orgId)
    return new Response("법인 소속만 가능", { status: 400 });

  await db
    .update(organizations)
    .set({ setupGuideDismissedAt: new Date().toISOString() })
    .where(eq(organizations.id, me!.orgId));
  return Response.json({ ok: true });
}

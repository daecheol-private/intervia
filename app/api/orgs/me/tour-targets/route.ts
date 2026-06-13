/**
 * 인터랙티브 가이드(둘러보기) 대상 조회 — 시작 가이드 단계(guide-steps) 런처용.
 * - firstJobId: 이력서 업로드 시나리오가 이동할 공고 (최신 1건)
 * - screenedCandidateId: AI 면접 시나리오 대상 — 서류평가 끝나 'AI면접 요청'
 *   버튼이 활성인 후보 (stage='screened', 미종결). 없으면 시나리오 비활성.
 */
import { db } from "@/lib/db";
import { jobPostings, candidates } from "@/lib/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "system_admin" || !me!.orgId)
    return Response.json({ firstJobId: null, screenedCandidateId: null });

  const orgId = me!.orgId;
  const [firstJobId, screenedCandidateId] = await Promise.all([
    db
      .select({ id: sql<number | null>`MAX(${jobPostings.id})` })
      .from(jobPostings)
      .where(eq(jobPostings.orgId, orgId))
      .then(([r]) => r?.id ?? null),
    db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(
          eq(candidates.orgId, orgId),
          eq(candidates.stage, "screened"),
          sql`${candidates.outcome} IS NULL`
        )
      )
      .orderBy(desc(candidates.id))
      .limit(1)
      .then(([r]) => r?.id ?? null),
  ]);

  return Response.json({ firstJobId, screenedCandidateId });
}

/**
 * 인터랙티브 가이드(둘러보기) 대상 조회 — 시작 가이드 단계(guide-steps) 런처용.
 * - firstJobId: 이력서 업로드 시나리오가 이동할 공고 (최신 1건)
 * - screenedCandidateId: AI 면접 시나리오 대상 — 서류평가 끝나 'AI면접 요청'
 *   버튼이 활성인 후보 (stage='screened', 미종결). 없으면 시나리오 비활성.
 */
import { db } from "@/lib/db";
import { jobPostings, candidates, jobInterviewers } from "@/lib/schema";
import { eq, and, or, sql, desc, isNull, inArray } from "drizzle-orm";
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

  // 가이드는 "이 사용자가 실제로 들어갈 수 있는" 공고/후보만 가리켜야 한다.
  // org 전체에서 고르면, 면접관 미배정 + PIN 잠긴 공고의 후보가 대상으로 잡혀
  // 따라하기 → /candidates/{id} 403 → /jobs/{id} 잠금 → 다시 따라하기 …
  // 무한 리다이렉트가 났다. 접근 가능 기준은 isJobUnlocked(lib/job-lock) 와 동일:
  // 관리자거나 / PIN 없는 공고 / 본인이 면접관으로 배정된 공고. (일시적 unlock
  // 쿠키는 가이드 대상 선정에서 제외 — 구조적 접근 권한만 본다.)
  const accessibleJob = me!.isAdmin
    ? undefined
    : or(
        isNull(jobPostings.passwordHash),
        inArray(
          jobPostings.id,
          db
            .select({ id: jobInterviewers.jobId })
            .from(jobInterviewers)
            .where(eq(jobInterviewers.userId, me!.id))
        )
      );

  const [firstJobId, screenedCandidateId] = await Promise.all([
    db
      .select({ id: sql<number | null>`MAX(${jobPostings.id})` })
      .from(jobPostings)
      .where(and(eq(jobPostings.orgId, orgId), accessibleJob))
      .then(([r]) => r?.id ?? null),
    db
      .select({ id: candidates.id })
      .from(candidates)
      .innerJoin(jobPostings, eq(candidates.jobId, jobPostings.id))
      .where(
        and(
          eq(candidates.orgId, orgId),
          eq(candidates.stage, "screened"),
          sql`${candidates.outcome} IS NULL`,
          accessibleJob
        )
      )
      .orderBy(desc(candidates.id))
      .limit(1)
      .then(([r]) => r?.id ?? null),
  ]);

  return Response.json({ firstJobId, screenedCandidateId });
}

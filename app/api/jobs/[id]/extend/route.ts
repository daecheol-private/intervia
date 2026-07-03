/**
 * 공고 1개월 연장 — (보관 중 이력서 수 × resume_upload 단가) 차감.
 *  (불합격·지원취소 이력서는 파일이 폐기되어 보관비용이 없으므로 과금 제외)
 */
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import {
  extendJob,
  countBillableCandidates,
  EXTENSION_DAYS,
  EXTEND_VISIBLE_WITHIN_DAYS,
} from "@/lib/job-lifecycle";
import { getPricing } from "@/lib/tokens";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const { id } = await params;
  const jobId = Number(id);

  const [job] = await db.select().from(jobPostings).where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId)) return new Response("Not found", { status: 404 });

  const { billable: candidateCount, total: totalCandidateCount } =
    await countBillableCandidates(jobId);
  const perResume = await getPricing("resume_upload");
  const dLeft =
    job.status === "active" && job.closesAt
      ? Math.ceil(
          (new Date(job.closesAt).getTime() - Date.now()) / 86_400_000
        )
      : null;
  const allowed =
    candidateCount > 0 &&
    (dLeft == null || dLeft <= EXTEND_VISIBLE_WITHIN_DAYS);
  const reason = !allowed
    ? candidateCount === 0
      ? "no_candidates"
      : "too_early"
    : null;
  return Response.json({
    candidateCount,
    totalCandidateCount,
    perResume,
    totalCost: candidateCount * perResume,
    extensionDays: EXTENSION_DAYS,
    currentClosesAt: job.closesAt,
    daysLeft: dLeft,
    allowed,
    reason,
    visibleWithinDays: EXTEND_VISIBLE_WITHIN_DAYS,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const { id } = await params;
  const jobId = Number(id);

  const [job] = await db.select().from(jobPostings).where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId)) return new Response("Not found", { status: 404 });
  if (job.orgId == null)
    return new Response("법인 없는 공고는 연장 불가", { status: 400 });

  const result = await extendJob({
    jobId,
    orgId: job.orgId,
    userId: me!.id,
  });

  if (!result.ok) {
    const status = result.code === "insufficient_tokens" ? 402 : 400;
    return Response.json(result, { status });
  }

  logAudit(req, {
    actor: me!,
    action: "job.extend" as const,
    resourceType: "job" as const,
    resourceId: jobId,
    orgId: job.orgId,
    jobId,
    metadata: {
      kind: "job_extend",
      candidateCount: result.candidateCount,
      totalCost: result.totalCost,
      newClosesAt: result.newClosesAt,
    },
  });

  return Response.json(result);
}

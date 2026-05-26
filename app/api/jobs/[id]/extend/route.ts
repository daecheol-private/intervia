/**
 * 공고 1개월 연장 — (현재 후보자 수 × resume_upload 단가) 차감.
 */
import { db } from "@/lib/db";
import { jobPostings, candidates } from "@/lib/schema";
import { count, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import {
  extendJob,
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

  const [{ n }] = await db
    .select({ n: count(candidates.id) })
    .from(candidates)
    .where(eq(candidates.jobId, jobId));
  const perResume = await getPricing("resume_upload");
  const candidateCount = Number(n ?? 0);
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
    action: "user.status_change" as const,
    resourceType: "org" as const,
    resourceId: jobId,
    orgId: job.orgId,
    metadata: {
      kind: "job_extend",
      candidateCount: result.candidateCount,
      totalCost: result.totalCost,
      newClosesAt: result.newClosesAt,
    },
  });

  return Response.json(result);
}

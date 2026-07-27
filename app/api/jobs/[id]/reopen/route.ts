/**
 * 공고 재개 — 종결된 공고를 다시 active 로. 토큰 재과금 없음.
 *
 * 실수로 종결했거나, 과거 자동 종결 로직(2026-07-27 제거)으로 닫힌 공고를 살리는 경로.
 * closesAt 이 아직 남아 있을 때만 허용 — 이미 지났으면 연장(extend)이 맞다.
 * 종결 시 일괄 불합격된 후보자는 되돌리지 않는다(공고 상태만).
 */
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { reopenJob } from "@/lib/job-lifecycle";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const { id } = await params;
  const jobId = Number(id);

  const [job] = await db
    .select({ orgId: jobPostings.orgId })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });

  const result = await reopenJob(jobId);
  if (!result.ok)
    return Response.json(
      { ok: false, code: result.code, message: result.message },
      { status: result.code === "not_found" ? 404 : 409 }
    );

  logAudit(req, {
    actor: me,
    action: "job.reopen",
    resourceType: "job_posting",
    resourceId: jobId,
    orgId: job.orgId,
    jobId,
    metadata: { closesAt: result.closesAt },
  });

  return Response.json({ ok: true, closesAt: result.closesAt });
}

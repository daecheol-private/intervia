/**
 * 공고별 "지원자 동의 attest" 마킹.
 * POST → 현재 사용자가 이 공고에 대해 지원자 동의 확보를 확인.
 * DELETE → 확인 취소 (필요 시).
 *
 * 한번 confirm 하면 timestamp + userId 가 DB 에 기록되어 감사 가능.
 */
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { sql } from "drizzle-orm";

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
    .select({ id: jobPostings.id, orgId: jobPostings.orgId })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });

  await db
    .update(jobPostings)
    .set({
      applicantConsentConfirmedAt: sql`CURRENT_TIMESTAMP`,
      applicantConsentConfirmedByUserId: me!.id,
    })
    .where(eq(jobPostings.id, jobId));

  logAudit(req, {
    actor: me!,
    action: "user.status_change",
    resourceType: "job",
    resourceId: jobId,
    orgId: job.orgId,
    metadata: { kind: "applicant_consent_attest", value: true },
  });
  return Response.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const { id } = await params;
  const jobId = Number(id);

  const [job] = await db
    .select({ id: jobPostings.id, orgId: jobPostings.orgId })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });

  await db
    .update(jobPostings)
    .set({
      applicantConsentConfirmedAt: null,
      applicantConsentConfirmedByUserId: null,
    })
    .where(eq(jobPostings.id, jobId));

  logAudit(req, {
    actor: me!,
    action: "user.status_change",
    resourceType: "job",
    resourceId: jobId,
    orgId: job.orgId,
    metadata: { kind: "applicant_consent_attest", value: false },
  });
  return Response.json({ ok: true });
}

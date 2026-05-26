import { db } from "@/lib/db";
import { candidates, candidateAttachments, jobPostings } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid)) return new Response("Bad request", { status: 400 });

  const [candidate] = await db
    .select({ orgId: candidates.orgId, jobId: candidates.jobId })
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  // 잠긴 공고 가드
  const [job] = await db
    .select({ id: jobPostings.id, passwordHash: jobPostings.passwordHash })
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (
    job &&
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(job.id))
  ) {
    return new Response("잠긴 공고입니다.", { status: 403 });
  }

  const rows = await db
    .select({
      id: candidateAttachments.id,
      kind: candidateAttachments.kind,
      originalName: candidateAttachments.originalName,
      mime: candidateAttachments.mime,
      sizeBytes: candidateAttachments.sizeBytes,
      createdAt: candidateAttachments.createdAt,
    })
    .from(candidateAttachments)
    .where(eq(candidateAttachments.candidateId, cid))
    .orderBy(asc(candidateAttachments.id));

  return Response.json(rows);
}

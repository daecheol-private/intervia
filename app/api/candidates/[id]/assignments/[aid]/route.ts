import { db } from "@/lib/db";
import { candidates, interviewerAssignments } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; aid: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id, aid } = await params;
  const cid = Number(id);
  const assignmentId = Number(aid);

  const [candidate] = await db
    .select({ orgId: candidates.orgId })
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  const r = await db
    .delete(interviewerAssignments)
    .where(
      and(
        eq(interviewerAssignments.id, assignmentId),
        eq(interviewerAssignments.candidateId, cid)
      )
    )
    .returning({ id: interviewerAssignments.id });
  if (r.length === 0) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 204 });
}

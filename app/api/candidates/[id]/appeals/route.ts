/**
 * 후보자별 이의제기 목록 (채용담당자용).
 */
import { db } from "@/lib/db";
import { candidates, appealLogs } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";

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
  const [candidate] = await db
    .select({ orgId: candidates.orgId })
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  const rows = await db
    .select()
    .from(appealLogs)
    .where(eq(appealLogs.candidateId, cid))
    .orderBy(desc(appealLogs.createdAt));
  return Response.json(rows);
}

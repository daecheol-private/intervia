/**
 * 후보자별 이의제기 목록 (채용담당자용).
 */
import { db } from "@/lib/db";
import { appealLogs } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";

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
  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;

  const rows = await db
    .select()
    .from(appealLogs)
    .where(eq(appealLogs.candidateId, cid))
    .orderBy(desc(appealLogs.createdAt));
  return Response.json(rows);
}

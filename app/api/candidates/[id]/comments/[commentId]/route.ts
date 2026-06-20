/**
 * 면접관 토론 코멘트 삭제 — 작성자 본인만. (채팅 의미론상 수정은 없음)
 */
import { db } from "@/lib/db";
import { candidateComments } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id, commentId } = await params;
  const cid = Number(id);
  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;

  const nid = Number(commentId);
  // 본인 + 해당 후보자 소속 코멘트만 삭제 (법인 가드는 guardCandidate 가 이미 통과).
  const [existing] = await db
    .select({ authorUserId: candidateComments.authorUserId })
    .from(candidateComments)
    .where(
      and(eq(candidateComments.id, nid), eq(candidateComments.candidateId, cid))
    );
  if (!existing) return new Response("Not found", { status: 404 });
  if (existing.authorUserId !== me!.id)
    return new Response("본인 코멘트만 삭제할 수 있습니다.", { status: 403 });

  await db.delete(candidateComments).where(eq(candidateComments.id, nid));
  return Response.json({ ok: true });
}

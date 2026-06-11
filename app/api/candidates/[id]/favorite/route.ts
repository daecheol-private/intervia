/**
 * 후보자 즐겨찾기 토글. 사용자별 별표.
 * POST: 추가 (멱등) / DELETE: 해제.
 */
import { db } from "@/lib/db";
import { userCandidateFavorites } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;
  const { id } = await params;
  const candidateId = Number(id);
  const g = await guardCandidate(me!, candidateId);
  if (!g.ok) return g.res;
  try {
    await db
      .insert(userCandidateFavorites)
      .values({ userId: me!.id, candidateId });
  } catch {
    // unique 위반 무시 (이미 즐겨찾기)
  }
  return Response.json({ favorited: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;
  const { id } = await params;
  const candidateId = Number(id);
  const g = await guardCandidate(me!, candidateId);
  if (!g.ok) return g.res;
  await db
    .delete(userCandidateFavorites)
    .where(
      and(
        eq(userCandidateFavorites.userId, me!.id),
        eq(userCandidateFavorites.candidateId, candidateId)
      )
    );
  return Response.json({ favorited: false });
}

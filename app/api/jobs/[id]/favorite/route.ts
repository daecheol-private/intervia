/**
 * 공고 즐겨찾기 토글. 사용자별 별표.
 * POST: 즐겨찾기 추가 (멱등 — 이미 있으면 no-op)
 * DELETE: 즐겨찾기 해제
 */
import { db } from "@/lib/db";
import { jobPostings, userJobFavorites } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

async function guard(jobId: number, me: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  const [job] = await db
    .select({ id: jobPostings.id, orgId: jobPostings.orgId })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me, job.orgId)) return new Response("Not found", { status: 404 });
  return null;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;
  const { id } = await params;
  const jobId = Number(id);
  const g = await guard(jobId, me!);
  if (g) return g;

  // 멱등 insert (이미 있으면 무시)
  try {
    await db.insert(userJobFavorites).values({ userId: me!.id, jobId });
  } catch {
    // unique 제약 위반은 무시 (이미 즐겨찾기)
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
  const jobId = Number(id);
  const g = await guard(jobId, me!);
  if (g) return g;

  await db
    .delete(userJobFavorites)
    .where(
      and(
        eq(userJobFavorites.userId, me!.id),
        eq(userJobFavorites.jobId, jobId)
      )
    );
  return Response.json({ favorited: false });
}

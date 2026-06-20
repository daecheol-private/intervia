/**
 * 이력서별 면접관 토론 코멘트 (채팅).
 *
 * 권한:
 *  - GET: 같은 법인 멤버 누구나 조회. `?afterId=N` 이면 그 id 이후 새 코멘트만 (폴링용).
 *  - POST: 같은 법인 멤버 누구나 작성. 본인 row 로 기록.
 */
import { db } from "@/lib/db";
import { candidateComments, users } from "@/lib/schema";
import { eq, and, gt, asc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;

  // 폴링: 마지막으로 받은 id 이후 새 코멘트만 가져온다. 최초 로드는 afterId 없이 전체.
  const afterIdRaw = new URL(req.url).searchParams.get("afterId");
  const afterId = afterIdRaw != null ? Number(afterIdRaw) : null;

  const where =
    afterId != null && Number.isFinite(afterId)
      ? and(
          eq(candidateComments.candidateId, cid),
          gt(candidateComments.id, afterId)
        )
      : eq(candidateComments.candidateId, cid);

  const rows = await db
    .select({
      id: candidateComments.id,
      authorUserId: candidateComments.authorUserId,
      authorName: users.name,
      body: candidateComments.body,
      createdAt: candidateComments.createdAt,
    })
    .from(candidateComments)
    .leftJoin(users, eq(users.id, candidateComments.authorUserId))
    .where(where)
    .orderBy(asc(candidateComments.id)); // 오래된 → 최신 (채팅 순서)
  return Response.json(rows);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;

  const data = (await req.json().catch(() => null)) as { body?: string } | null;
  const text = data?.body?.toString().trim().slice(0, 5000) ?? "";
  if (!text) return new Response("내용을 입력해 주세요.", { status: 400 });

  const [inserted] = await db
    .insert(candidateComments)
    .values({ candidateId: cid, authorUserId: me!.id, body: text })
    .returning();

  // 작성자 이름을 붙여 그대로 반환 — 클라이언트가 추가 조회 없이 바로 렌더.
  return Response.json({
    id: inserted.id,
    authorUserId: inserted.authorUserId,
    authorName: me!.name,
    body: inserted.body,
    createdAt: inserted.createdAt,
  });
}

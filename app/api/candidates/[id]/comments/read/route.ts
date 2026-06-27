/**
 * 면접관 토론 코멘트 "읽음" 상태 — 사용자 × 후보자 단위 워터마크.
 *
 *  - GET : 현재 사용자의 이 후보자에 대한 lastReadId 반환(없으면 0).
 *  - POST: 이 후보자의 최신 코멘트 id 까지 "모두 읽음" 처리(upsert). body 불필요 —
 *          서버가 MAX(id) 를 직접 계산해 클라이언트 지연/조작에 영향받지 않는다.
 *
 * 안읽음 수 = lastReadId 보다 큰 "남의"(author != me) 코멘트 개수.
 * 기존 localStorage(기기별) 방식을 대체해 기기 무관하게 정확하다.
 */
import { db } from "@/lib/db";
import { candidateComments, candidateCommentReads } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";

export const runtime = "nodejs";

// updated_at 수동 세팅용 — schema 의 nowTimestamp 와 동일 포맷('YYYY-MM-DD HH:MM:SS' UTC).
const nowTs = () => new Date().toISOString().replace("T", " ").slice(0, 19);

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

  const [row] = await db
    .select({ lastReadId: candidateCommentReads.lastReadCommentId })
    .from(candidateCommentReads)
    .where(
      and(
        eq(candidateCommentReads.userId, me!.id),
        eq(candidateCommentReads.candidateId, cid)
      )
    );
  return Response.json({ lastReadId: row?.lastReadId ?? 0 });
}

export async function POST(
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

  // 이 후보자의 최신 코멘트 id 까지 읽음 처리.
  const [{ maxId }] = await db
    .select({
      maxId: sql<number>`COALESCE(MAX(${candidateComments.id}), 0)`,
    })
    .from(candidateComments)
    .where(eq(candidateComments.candidateId, cid));

  await db
    .insert(candidateCommentReads)
    .values({ userId: me!.id, candidateId: cid, lastReadCommentId: maxId })
    .onConflictDoUpdate({
      target: [candidateCommentReads.userId, candidateCommentReads.candidateId],
      set: { lastReadCommentId: maxId, updatedAt: nowTs() },
    });

  return Response.json({ lastReadId: maxId });
}

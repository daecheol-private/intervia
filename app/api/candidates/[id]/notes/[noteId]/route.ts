/**
 * 개별 메모 수정/삭제. 본인 작성 row 만 허용.
 */
import { db } from "@/lib/db";
import { interviewerNotes } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";

export const runtime = "nodejs";

function validScore(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100)
    return null;
  return Math.round(n);
}

async function loadAndAuthorize(
  me: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  cid: number,
  nid: number
) {
  const g = await guardCandidate(me, cid);
  if (!g.ok) return { res: g.res };
  const [note] = await db
    .select()
    .from(interviewerNotes)
    .where(
      and(eq(interviewerNotes.id, nid), eq(interviewerNotes.candidateId, cid))
    );
  if (!note) return { res: new Response("Not found", { status: 404 }) };
  if (note.authorUserId !== me.id)
    return { res: new Response("Forbidden", { status: 403 }) };
  return { ok: true as const };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id, noteId } = await params;
  const cid = Number(id);
  const nid = Number(noteId);

  const r = await loadAndAuthorize(me!, cid, nid);
  if ("res" in r) return r.res;

  const body = (await req.json().catch(() => null)) as {
    scores?: Record<string, unknown>;
    note?: string;
  } | null;
  const update: {
    scores?: {
      skill?: number;
      experience?: number;
      collaboration?: number;
      fit?: number;
    } | null;
    note?: string;
    updatedAt?: string;
  } = {};
  if (body && body.scores !== undefined) {
    const s = body.scores ?? {};
    const cleaned: {
      skill?: number;
      experience?: number;
      collaboration?: number;
      fit?: number;
    } = {};
    const s1 = validScore(s.skill);
    if (s1 != null) cleaned.skill = s1;
    const s2 = validScore(s.experience);
    if (s2 != null) cleaned.experience = s2;
    const s3 = validScore(s.collaboration);
    if (s3 != null) cleaned.collaboration = s3;
    const s4 = validScore(s.fit);
    if (s4 != null) cleaned.fit = s4;
    update.scores = Object.keys(cleaned).length > 0 ? cleaned : null;
  }
  if (body && typeof body.note === "string")
    update.note = body.note.slice(0, 5000);
  if (Object.keys(update).length === 0)
    return new Response("변경할 내용이 없습니다.", { status: 400 });
  update.updatedAt = new Date().toISOString();

  await db
    .update(interviewerNotes)
    .set(update)
    .where(eq(interviewerNotes.id, nid));
  return new Response(null, { status: 204 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id, noteId } = await params;
  const cid = Number(id);
  const nid = Number(noteId);

  const r = await loadAndAuthorize(me!, cid, nid);
  if ("res" in r) return r.res;

  await db.delete(interviewerNotes).where(eq(interviewerNotes.id, nid));
  return new Response(null, { status: 204 });
}

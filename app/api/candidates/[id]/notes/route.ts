/**
 * 사람 면접관 스코어카드 + 메모.
 *
 * 권한:
 *  - GET: 같은 법인 멤버 누구나 조회
 *  - POST: 같은 법인 멤버 누구나 작성. 본인 row 만 생성됨.
 */
import { db } from "@/lib/db";
import { candidates, interviewerNotes, users } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

function validScore(n: unknown): number | null {
  if (typeof n !== "number") return null;
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return Math.round(n);
}

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
    .select({
      id: interviewerNotes.id,
      candidateId: interviewerNotes.candidateId,
      authorUserId: interviewerNotes.authorUserId,
      authorName: users.name,
      scores: interviewerNotes.scores,
      note: interviewerNotes.note,
      createdAt: interviewerNotes.createdAt,
      updatedAt: interviewerNotes.updatedAt,
    })
    .from(interviewerNotes)
    .leftJoin(users, eq(users.id, interviewerNotes.authorUserId))
    .where(eq(interviewerNotes.candidateId, cid))
    .orderBy(desc(interviewerNotes.id));
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
  const [candidate] = await db
    .select({ orgId: candidates.orgId })
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    scores?: Record<string, unknown>;
    note?: string;
    interviewSessionId?: number | null;
  } | null;

  const note = body?.note?.toString().slice(0, 5000) ?? "";
  const scoresIn = body?.scores ?? {};
  const scoresObj: {
    skill?: number;
    experience?: number;
    collaboration?: number;
    fit?: number;
  } = {};
  const s1 = validScore(scoresIn.skill);
  if (s1 != null) scoresObj.skill = s1;
  const s2 = validScore(scoresIn.experience);
  if (s2 != null) scoresObj.experience = s2;
  const s3 = validScore(scoresIn.collaboration);
  if (s3 != null) scoresObj.collaboration = s3;
  const s4 = validScore(scoresIn.fit);
  if (s4 != null) scoresObj.fit = s4;
  const anyScore = Object.keys(scoresObj).length > 0;
  if (!note && !anyScore)
    return new Response("점수 또는 메모를 입력해 주세요.", { status: 400 });

  const [inserted] = await db
    .insert(interviewerNotes)
    .values({
      candidateId: cid,
      authorUserId: me!.id,
      interviewSessionId: body?.interviewSessionId ?? null,
      scores: anyScore ? scoresObj : null,
      note,
    })
    .returning();
  return Response.json(inserted);
}

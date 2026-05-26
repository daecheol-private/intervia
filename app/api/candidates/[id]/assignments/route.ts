/**
 * 면접관 배정. 같은 법인 멤버를 후보자 면접관으로 지정.
 *
 * 권한: 같은 법인 누구나 배정/해제 가능 (관리 단순화).
 *      배정 자체는 알림 + UI 강조용 — 메모 작성 권한과 별개.
 */
import { db } from "@/lib/db";
import { candidates, interviewerAssignments, users } from "@/lib/schema";
import { and, eq, desc } from "drizzle-orm";
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
    .select({
      id: interviewerAssignments.id,
      userId: interviewerAssignments.userId,
      userName: users.name,
      userEmail: users.email,
      assignedByUserId: interviewerAssignments.assignedByUserId,
      createdAt: interviewerAssignments.createdAt,
    })
    .from(interviewerAssignments)
    .leftJoin(users, eq(users.id, interviewerAssignments.userId))
    .where(eq(interviewerAssignments.candidateId, cid))
    .orderBy(desc(interviewerAssignments.id));
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

  const body = (await req.json().catch(() => null)) as { userId?: number } | null;
  const userId = Number(body?.userId);
  if (!Number.isInteger(userId))
    return new Response("userId 가 올바르지 않습니다.", { status: 400 });

  // 대상 사용자가 같은 법인인지 확인
  const [target] = await db
    .select({ id: users.id, orgId: users.orgId })
    .from(users)
    .where(eq(users.id, userId));
  if (!target || target.orgId !== candidate.orgId)
    return new Response("같은 법인 멤버만 배정할 수 있습니다.", {
      status: 400,
    });

  // 중복 방지
  const [dup] = await db
    .select({ id: interviewerAssignments.id })
    .from(interviewerAssignments)
    .where(
      and(
        eq(interviewerAssignments.candidateId, cid),
        eq(interviewerAssignments.userId, userId)
      )
    );
  if (dup) return new Response("이미 배정된 면접관입니다.", { status: 409 });

  const [row] = await db
    .insert(interviewerAssignments)
    .values({
      candidateId: cid,
      userId,
      assignedByUserId: me!.id,
    })
    .returning();
  return Response.json(row);
}

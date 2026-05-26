/**
 * 이의제기 검토 상태/답변 업데이트 (채용담당자/시스템관리자).
 */
import { db } from "@/lib/db";
import { candidates, appealLogs } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

type Status = "pending" | "reviewed" | "resolved" | "rejected";
const ALLOWED: Status[] = ["pending", "reviewed", "resolved", "rejected"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; appealId: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id, appealId } = await params;
  const cid = Number(id);
  const aid = Number(appealId);

  const [candidate] = await db
    .select({ orgId: candidates.orgId })
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    status?: string;
    response?: string;
  } | null;
  if (!body) return new Response("잘못된 요청", { status: 400 });

  const next: { status?: Status; response?: string; reviewedAt?: string; reviewedByUserId?: number } = {};
  if (body.status) {
    if (!ALLOWED.includes(body.status as Status))
      return new Response("상태 값이 올바르지 않습니다.", { status: 400 });
    next.status = body.status as Status;
    if (next.status !== "pending") {
      next.reviewedAt = new Date().toISOString();
      next.reviewedByUserId = me!.id;
    }
  }
  if (typeof body.response === "string") {
    if (body.response.length > 5000)
      return new Response("답변은 5000자 이하로 작성해 주세요.", {
        status: 400,
      });
    next.response = body.response;
  }
  if (Object.keys(next).length === 0)
    return new Response("변경 사항이 없습니다.", { status: 400 });

  const r = await db
    .update(appealLogs)
    .set(next)
    .where(and(eq(appealLogs.id, aid), eq(appealLogs.candidateId, cid)))
    .returning({ id: appealLogs.id });
  if (r.length === 0) return new Response("Not found", { status: 404 });

  logAudit(req, {
    actor: me!,
    action: "appeal.status_change",
    resourceType: "appeal",
    resourceId: aid,
    orgId: candidate.orgId,
    metadata: { status: next.status, has_response: !!next.response },
  });

  return new Response(null, { status: 204 });
}

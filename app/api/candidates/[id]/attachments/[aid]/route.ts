import { db } from "@/lib/db";
import { candidateAttachments } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { deleteFile } from "@/lib/storage";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * 첨부 삭제 — 잘못 올린 첨부 회수용. 메인 이력서(kind=resume)는 삭제 불가.
 * 이미 평가에 반영된 첨부를 지워도 기존 리포트는 그대로 — 재평가해야 제외된다.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; aid: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const limited = await rateLimit(
    req,
    "attachment-modify",
    { limit: 20, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { id, aid } = await params;
  const cid = Number(id);
  const attId = Number(aid);
  if (!Number.isInteger(cid) || !Number.isInteger(attId))
    return new Response("Bad request", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;

  const [att] = await db
    .select()
    .from(candidateAttachments)
    .where(
      and(
        eq(candidateAttachments.id, attId),
        eq(candidateAttachments.candidateId, cid)
      )
    );
  if (!att) return new Response("Not found", { status: 404 });
  if (att.kind === "resume")
    return new Response("메인 이력서는 삭제할 수 없습니다.", { status: 400 });

  // 파일 삭제는 best-effort — 실패해도 행은 지운다 (purge cron 과 동일 정책)
  try {
    await deleteFile(att.filePath);
  } catch (e) {
    log.warn("attachment_file_delete_failed", {
      candidateId: cid,
      attachmentId: attId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  await db
    .delete(candidateAttachments)
    .where(eq(candidateAttachments.id, attId));

  logAudit(req, {
    actor: me!,
    action: "candidate.attachment_delete",
    resourceType: "candidate_attachment",
    resourceId: attId,
    orgId: g.candidate.orgId,
    metadata: { candidateId: cid, kind: att.kind, originalName: att.originalName },
  });

  return Response.json({ ok: true });
}

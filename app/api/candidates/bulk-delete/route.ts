import { db } from "@/lib/db";
import { candidates } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { deleteCandidateFiles } from "@/lib/candidate-files";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const body = (await req.json().catch(() => null)) as { ids?: number[] } | null;
  const ids = (body?.ids ?? []).map(Number).filter(Number.isInteger);
  if (ids.length === 0)
    return new Response("ids 가 비어 있습니다.", { status: 400 });

  const rows = await db
    .select({
      id: candidates.id,
      orgId: candidates.orgId,
      jobId: candidates.jobId,
    })
    .from(candidates)
    .where(inArray(candidates.id, ids));

  // 타 법인 행이 섞여 있으면 전체 거부 (no partial)
  const allowed: typeof rows = [];
  for (const r of rows) {
    if (!ownsOrg(me!, r.orgId)) {
      return new Response("권한 없는 후보자가 포함되어 있습니다.", {
        status: 403,
      });
    }
    allowed.push(r);
  }
  if (allowed.length === 0)
    return new Response("삭제할 후보자가 없습니다.", { status: 404 });

  const allowedIds = allowed.map((r) => r.id);
  // 파일 먼저 (메인 이력서 + 모든 첨부) → DB row 삭제
  const fileResult = await deleteCandidateFiles(allowedIds);
  await db.delete(candidates).where(inArray(candidates.id, allowedIds));

  // 실사용상 벌크는 공고 상세에서 단일 공고 대상 — 전원 같은 공고일 때만 jobId 기록.
  const jobIds = new Set(allowed.map((r) => r.jobId));
  logAudit(req, {
    actor: me!,
    action: "candidate.bulk_delete",
    resourceType: "candidate",
    jobId: jobIds.size === 1 ? allowed[0].jobId : null,
    metadata: {
      count: allowed.length,
      ids: allowedIds,
      deletedFiles: fileResult.deletedFiles,
      fileErrors: fileResult.errors,
    },
  });

  return Response.json({
    deleted: allowed.length,
    deletedFiles: fileResult.deletedFiles,
  });
}

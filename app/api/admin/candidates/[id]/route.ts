/**
 * PIPA 권리요청 등으로 후보자 데이터를 강제 삭제 — sysadmin 전용 cross-org.
 * 일반 candidate DELETE 와 별도 엔드포인트로 둠 — 더 강한 가드 + 별도 감사 액션.
 *
 * 필수:
 *   - reason: 5자 이상 (PIPA 조항·요청자 정보 등)
 *   - confirm: 후보자 이메일 또는 이름 (실수 방지)
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { candidates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { deleteFilesForCandidate } from "@/lib/candidate-files";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });

  const stepUpGuard = await requireStepUp();
  if (stepUpGuard) return stepUpGuard;

  const { id } = await params;
  const cid = Number(id);
  const body = (await req.json().catch(() => ({}))) as {
    reason?: string;
    confirm?: string;
  };
  const reason = (body.reason ?? "").trim();
  if (reason.length < 5)
    return new Response("삭제 사유는 5자 이상 입력하세요. (PIPA 조항·요청자 등)", {
      status: 400,
    });

  const [row] = await db
    .select({
      id: candidates.id,
      orgId: candidates.orgId,
      name: candidates.name,
      email: candidates.email,
    })
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!row) return new Response("후보자 없음", { status: 404 });

  const expectedConfirm = (row.email ?? row.name).trim();
  const got = (body.confirm ?? "").trim();
  if (got !== expectedConfirm)
    return new Response(
      `실수 방지: 후보자 식별자(${expectedConfirm}) 를 confirm 필드에 정확히 입력하세요.`,
      { status: 400 }
    );

  const fileResult = await deleteFilesForCandidate(cid);
  await db.delete(candidates).where(eq(candidates.id, cid));

  logAudit(req, {
    actor: me,
    action: "candidate.admin_delete",
    resourceType: "candidate",
    resourceId: cid,
    orgId: row.orgId,
    metadata: {
      reason,
      candidateName: row.name,
      candidateEmail: row.email,
      deletedFiles: fileResult.deletedFiles,
      fileErrors: fileResult.errors,
    },
  });

  return new Response(null, { status: 204 });
}

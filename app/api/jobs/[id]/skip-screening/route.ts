/**
 * 공고별 "AI 이력서 평가 없이 진행" 토글.
 * POST   → aiScreeningDisabled = true  (동의 고지 없이 업로드 허용 + 서류 AI평가 미실행)
 * DELETE → aiScreeningDisabled = false (다시 AI 서류평가 적용)
 *
 * 동의(§37의2 고지)를 못 받은 채용기업이 서류 AI평가를 제외하고 진행하기 위한 장치.
 * 이력서는 사람이 검토하고 AI는 면접 단계(자체 동의 화면)부터 적용된다.
 */
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

async function setMode(req: Request, jobId: number, disabled: boolean) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const [job] = await db
    .select({ id: jobPostings.id, orgId: jobPostings.orgId })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId)) return new Response("Not found", { status: 404 });

  await db
    .update(jobPostings)
    .set({ aiScreeningDisabled: disabled })
    .where(eq(jobPostings.id, jobId));

  logAudit(req, {
    actor: me!,
    action: "user.status_change",
    resourceType: "job",
    resourceId: jobId,
    orgId: job.orgId,
    metadata: { kind: "ai_screening_disabled", value: disabled },
  });
  return Response.json({ ok: true, aiScreeningDisabled: disabled });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return setMode(req, Number(id), true);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return setMode(req, Number(id), false);
}

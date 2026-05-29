/**
 * 공고 종결 (수동 종결만 허용 — 자동 종결 cron 은 제거됨).
 *
 * GET  : 종결 가능 여부 + 차단 사유(대기 스텝 + 유효 링크) 미리보기.
 * POST : 진행 중 후보 일괄 불합격 처리 + status='closed'.
 */
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { checkCloseable, closeJob, isJobExpired } from "@/lib/job-lifecycle";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const { id } = await params;
  const jobId = Number(id);

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });
  if (job.status === "closed")
    return new Response("이미 종결된 공고입니다.", { status: 400 });

  const check = await checkCloseable(jobId);
  return Response.json({
    ...check,
    expired: isJobExpired(job),
    closesAt: job.closesAt,
  });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const body = await _req.json().catch(() => ({}));
  const sendNotification = !!body?.sendNotification;
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const { id } = await params;
  const jobId = Number(id);

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });
  if (job.status === "closed")
    return new Response("이미 종결된 공고입니다.", { status: 400 });

  const check = await checkCloseable(jobId);
  if (!check.ok) {
    return Response.json(
      {
        ok: false,
        code: "blocked",
        message:
          "지원자가 응답 대기 중인 후보자가 있어 종결할 수 없습니다. 링크 만료 후 다시 시도해 주세요.",
        blockers: check.blockers,
      },
      { status: 409 }
    );
  }

  const result = await closeJob({ jobId, userId: me!.id, sendNotification });
  logAudit(_req, {
    actor: me,
    action: "job.close",
    resourceType: "job_posting",
    resourceId: jobId,
    orgId: job.orgId,
    metadata: {
      rejectedCount: result.rejectedCount,
      sendNotification,
      mailsSent: result.mailsSent,
      mailsFailed: result.mailsFailed,
    },
  });

  return Response.json({ ok: true, ...result });
}

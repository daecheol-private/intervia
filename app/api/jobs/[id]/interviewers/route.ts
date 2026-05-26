/**
 * 공고별 면접관 목록 + 본인 자가 지정.
 *
 * GET: 면접관 목록 + 내가 포함되어 있는지(`me.isInterviewer`) 응답.
 * POST: 본인 자가 지정. PIN 잠금 공고는 잠금 해제된 상태여야 함.
 */
import { db } from "@/lib/db";
import { jobPostings, jobInterviewers, users } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { logAudit } from "@/lib/audit";
import { cookies } from "next/headers";

export const runtime = "nodejs";

async function loadJobGuard(
  jobId: number,
  me: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
) {
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return { error: new Response("Not found", { status: 404 }), job: null };
  if (!ownsOrg(me, job.orgId))
    return { error: new Response("Not found", { status: 404 }), job: null };
  return { error: null, job };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;
  const { id } = await params;
  const jobId = Number(id);
  const g = await loadJobGuard(jobId, me!);
  if (g.error) return g.error;

  const rows = await db
    .select({
      userId: jobInterviewers.userId,
      name: users.name,
      email: users.email,
      assignedAt: jobInterviewers.assignedAt,
      assignedByUserId: jobInterviewers.assignedByUserId,
    })
    .from(jobInterviewers)
    .innerJoin(users, eq(users.id, jobInterviewers.userId))
    .where(eq(jobInterviewers.jobId, jobId))
    .orderBy(jobInterviewers.assignedAt);

  const isInterviewer = rows.some((r) => r.userId === me!.id);
  return Response.json({
    interviewers: rows,
    me: { isInterviewer },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;
  const { id } = await params;
  const jobId = Number(id);
  const g = await loadJobGuard(jobId, me!);
  if (g.error) return g.error;
  const job = g.job!;

  // PIN 잠금 공고는 잠금 해제 후에만 자가 지정 가능 (system_admin 우회)
  if (
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(jobId))
  ) {
    return new Response("잠긴 공고입니다. 먼저 비밀번호를 입력하세요.", {
      status: 403,
    });
  }

  // 멱등 insert
  await db
    .insert(jobInterviewers)
    .values({
      jobId,
      userId: me!.id,
      assignedByUserId: me!.id,
    })
    .onConflictDoNothing();

  logAudit(req, {
    actor: me!,
    action: "user.status_change" as const,
    resourceType: "job" as const,
    resourceId: jobId,
    orgId: job.orgId,
    metadata: { kind: "interviewer_self_assign" },
  });

  return Response.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;
  const { id } = await params;
  const jobId = Number(id);
  const url = new URL(req.url);
  const userIdParam = url.searchParams.get("userId");
  const targetUserId = userIdParam ? Number(userIdParam) : me!.id;
  const g = await loadJobGuard(jobId, me!);
  if (g.error) return g.error;
  const job = g.job!;

  // 본인 제거는 항상 가능. 타인 제거는 org_admin / system_admin 만.
  if (targetUserId !== me!.id && me!.role === "member") {
    return new Response("권한 없음", { status: 403 });
  }

  await db
    .delete(jobInterviewers)
    .where(
      and(
        eq(jobInterviewers.jobId, jobId),
        eq(jobInterviewers.userId, targetUserId)
      )
    );

  // 본인이 본인을 면접관에서 빼면 — 잠금 쿠키도 제거.
  // 면접관 등록으로 PIN 우회 중이던 경우, 다음 진입부터 다시 PIN 입력 필요.
  // PIN 잠금 공고가 아니면 쿠키도 없으므로 no-op.
  if (targetUserId === me!.id && job.passwordHash) {
    const jar = await cookies();
    jar.delete(`job_unlock_${jobId}`);
  }

  logAudit(req, {
    actor: me!,
    action: "user.status_change" as const,
    resourceType: "job" as const,
    resourceId: jobId,
    orgId: job.orgId,
    metadata: { kind: "interviewer_remove", targetUserId },
  });

  return Response.json({ ok: true });
}

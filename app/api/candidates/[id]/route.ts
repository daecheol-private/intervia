import { db } from "@/lib/db";
import { candidates, interviewSchedules, interviewSessions, jobPostings, screeningJobs, userCandidateFavorites } from "@/lib/schema";
import { eq, desc, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { deleteFilesForCandidate } from "@/lib/candidate-files";
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
  const cid = Number(id);

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));

  if (
    me!.role !== "system_admin" &&
    job?.passwordHash &&
    !(await isJobUnlocked(job.id))
  ) {
    return Response.json(
      { locked: true, jobId: job.id, jobTitle: job.title },
      { status: 403 }
    );
  }


  const sessions = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.candidateId, cid))
    .orderBy(desc(interviewSessions.createdAt));

  const schedules = await db
    .select()
    .from(interviewSchedules)
    .where(eq(interviewSchedules.candidateId, cid))
    .orderBy(desc(interviewSchedules.createdAt));

  // 시스템관리자가 타 법인 데이터 조회한 경우 특별히 감사 로깅 (A-8)
  if (me!.role === "system_admin" && me!.orgId !== candidate.orgId) {
    logAudit(_req, {
      actor: me!,
      action: "candidate.view",
      resourceType: "candidate",
      resourceId: cid,
      orgId: candidate.orgId,
      metadata: { cross_org: true, name: candidate.name },
    });
  }

  // 서류평가 진행 상태 derive — 기존 status 컬럼 대체.
  //   not_started: 아직 큐에 안 들어갔거나 큐가 끝났는데 리포트도 없음 (=신규/실패 후 재시도 대기)
  //   in_queue:    queued (워커 대기) 또는 processing (워커 점유) — UI polling
  //   done:        screeningReport 가 있음
  //   failed:      마지막 큐가 failed (리포트 없음)
  const [lastJob] = await db
    .select({ status: screeningJobs.status })
    .from(screeningJobs)
    .where(eq(screeningJobs.candidateId, cid))
    .orderBy(desc(screeningJobs.id))
    .limit(1);
  let screeningPhase: "not_started" | "in_queue" | "done" | "failed";
  if (candidate.screeningReport) screeningPhase = "done";
  else if (lastJob?.status === "queued" || lastJob?.status === "processing")
    screeningPhase = "in_queue";
  else if (lastJob?.status === "failed") screeningPhase = "failed";
  else screeningPhase = "not_started";

  // 현재 사용자의 즐겨찾기 여부
  const [fav] = await db
    .select({ userId: userCandidateFavorites.userId })
    .from(userCandidateFavorites)
    .where(
      and(
        eq(userCandidateFavorites.userId, me!.id),
        eq(userCandidateFavorites.candidateId, cid)
      )
    );
  const favorited = !!fav;

  return Response.json({
    candidate: { ...candidate, favorited },
    job,
    sessions,
    schedules,
    screeningPhase,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    email?: string | null;
    phone?: string | null;
  } | null;
  if (!body) return new Response("바디 필요", { status: 400 });

  const [row] = await db
    .select({ orgId: candidates.orgId, name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!row) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, row.orgId))
    return new Response("Not found", { status: 404 });

  const updates: Partial<{
    name: string;
    email: string | null;
    phone: string | null;
  }> = {};

  if (typeof body.name === "string") {
    const v = body.name.trim();
    if (v.length === 0 || v.length > 100)
      return new Response("이름은 1~100자.", { status: 400 });
    updates.name = v;
  }
  if (body.email !== undefined) {
    if (body.email === null || body.email === "") {
      updates.email = null;
    } else {
      const v = body.email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        return new Response("이메일 형식 오류.", { status: 400 });
      updates.email = v;
    }
  }
  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === "") {
      updates.phone = null;
    } else {
      const v = body.phone.trim().slice(0, 40);
      updates.phone = v;
    }
  }

  if (Object.keys(updates).length === 0)
    return new Response("변경 항목 없음", { status: 400 });

  await db.update(candidates).set(updates).where(eq(candidates.id, cid));

  logAudit(req, {
    actor: me!,
    action: "user.status_change" as const,
    resourceType: "candidate" as const,
    resourceId: cid,
    orgId: row.orgId,
    metadata: {
      kind: "candidate_edit",
      fields: Object.keys(updates),
      prevName: row.name,
    },
  });

  return Response.json({ ok: true, updated: updates });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const [row] = await db
    .select({
      orgId: candidates.orgId,
      name: candidates.name,
    })
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!row) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, row.orgId))
    return new Response("Not found", { status: 404 });

  // 파일 먼저 — DB row 삭제 후엔 path 정보 못 가져옴 (cascade 로 attachments 도 사라짐)
  const fileResult = await deleteFilesForCandidate(cid);
  await db.delete(candidates).where(eq(candidates.id, cid));

  logAudit(req, {
    actor: me!,
    action: "candidate.delete",
    resourceType: "candidate",
    resourceId: cid,
    orgId: row.orgId,
    metadata: {
      name: row.name,
      deletedFiles: fileResult.deletedFiles,
      fileErrors: fileResult.errors,
    },
  });

  return new Response(null, { status: 204 });
}

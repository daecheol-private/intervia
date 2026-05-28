import { db } from "@/lib/db";
import { jobPostings, candidates, userJobFavorites } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked, isValidPin } from "@/lib/job-lock";
import { deleteCandidateFiles } from "@/lib/candidate-files";
import { logAudit } from "@/lib/audit";
import { refundFeature } from "@/lib/tokens";

const REFUND_WINDOW_MS = 5 * 60 * 1000;

export const runtime = "nodejs";

async function loadJob(jobId: number) {
  const [row] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  return row;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);
  const row = await loadJob(jobId);
  if (!row) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, row.orgId))
    return new Response("Not found", { status: 404 });

  const hasPassword = row.passwordHash != null;
  if (hasPassword && me!.role !== "system_admin" && !(await isJobUnlocked(jobId))) {
    return Response.json(
      { id: row.id, title: row.title, locked: true, hasPassword: true },
      { status: 403 }
    );
  }

  const [fav] = await db
    .select({ jobId: userJobFavorites.jobId })
    .from(userJobFavorites)
    .where(
      and(
        eq(userJobFavorites.userId, me!.id),
        eq(userJobFavorites.jobId, jobId)
      )
    );

  const { passwordHash, ...rest } = row;
  void passwordHash;
  return Response.json({
    ...rest,
    hasPassword,
    locked: false,
    favorited: !!fav,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);
  const existing = await loadJob(jobId);
  if (!existing) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, existing.orgId))
    return new Response("Not found", { status: 404 });

  if (me!.role !== "system_admin" && existing.passwordHash && !(await isJobUnlocked(jobId))) {
    return new Response("잠긴 공고입니다. 먼저 잠금을 해제하세요.", {
      status: 403,
    });
  }

  const body = await req.json();
  const update: Record<string, unknown> = {
    title: body.title,
    position: body.position,
    level: body.level,
    employmentType: body.employmentType,
    responsibilities: body.responsibilities,
    requirements: body.requirements,
    idealProfile: typeof body.idealProfile === "string" ? body.idealProfile.slice(0, 3000) : "",
    tone: body.tone,
    interviewDurationMinutes: body.interviewDurationMinutes ?? 20,
  };

  if (body.password === "") {
    update.passwordHash = null;
  } else if (typeof body.password === "string" && body.password.length > 0) {
    if (!isValidPin(body.password))
      return new Response("비밀번호는 4자리 숫자여야 합니다.", { status: 400 });
    update.passwordHash = await hashPassword(body.password);
  }

  const [row] = await db
    .update(jobPostings)
    .set(update)
    .where(eq(jobPostings.id, jobId))
    .returning();
  if (!row) return new Response("Not found", { status: 404 });

  const { passwordHash, ...rest } = row;
  return Response.json({ ...rest, hasPassword: passwordHash != null });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);
  const existing = await loadJob(jobId);
  if (!existing) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, existing.orgId))
    return new Response("Not found", { status: 404 });

  if (me!.role !== "system_admin" && existing.passwordHash && !(await isJobUnlocked(jobId))) {
    return new Response("잠긴 공고입니다. 먼저 잠금을 해제하세요.", {
      status: 403,
    });
  }

  // 1. 이 공고의 모든 후보자 ID 수집
  const candidateRows = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(eq(candidates.jobId, jobId));
  const candidateIds = candidateRows.map((r) => r.id);

  // 2. 후보자별 모든 파일(메인 이력서 + 첨부) 삭제
  //    DB 삭제는 cascade 로 candidates / attachments / sessions / notes 등 모두 사라짐.
  const fileResult = await deleteCandidateFiles(candidateIds);

  // 3. 공고 DB row 삭제 (cascade 발동)
  await db.delete(jobPostings).where(eq(jobPostings.id, jobId));

  // 5분 내 삭제 시 자동 환불
  if (existing.orgId) {
    const ageMs = Date.now() - new Date(existing.createdAt).getTime();
    if (ageMs <= REFUND_WINDOW_MS) {
      await refundFeature({
        orgId: existing.orgId,
        feature: "job_post",
        refType: "job",
        refId: jobId,
        userId: me!.id,
        memo: "공고 등록 직후 삭제",
      });
    }
  }

  logAudit(req, {
    actor: me!,
    action: "job.delete",
    resourceType: "job",
    resourceId: jobId,
    orgId: existing.orgId,
    metadata: {
      title: existing.title,
      candidatesDeleted: candidateIds.length,
      filesDeleted: fileResult.deletedFiles,
      fileErrors: fileResult.errors,
    },
  });

  return new Response(null, { status: 204 });
}

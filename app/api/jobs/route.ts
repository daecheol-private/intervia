import { db } from "@/lib/db";
import {
  jobPostings,
  candidates,
  jobInterviewers,
} from "@/lib/schema";
import { desc, eq, count, sql, and } from "drizzle-orm";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { jobOrgFilter, requireUser } from "@/lib/tenant";
import { isValidPin } from "@/lib/job-lock";
import { chargeFeature } from "@/lib/tokens";
import { defaultClosesAt } from "@/lib/job-lifecycle";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  // 내가 면접관인 공고 ID — 정렬 1순위 (로그인 계정이 면접관인 공고를 위로)
  const interviewerRows = await db
    .select({ jobId: jobInterviewers.jobId })
    .from(jobInterviewers)
    .where(eq(jobInterviewers.userId, me!.id));
  const interviewerSet = new Set(interviewerRows.map((r) => r.jobId));

  const rows = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      position: jobPostings.position,
      level: jobPostings.level,
      employmentType: jobPostings.employmentType,
      createdAt: jobPostings.createdAt,
      passwordHash: jobPostings.passwordHash,
      status: jobPostings.status,
      publishedAt: jobPostings.publishedAt,
      closesAt: jobPostings.closesAt,
      closedAt: jobPostings.closedAt,
      extensionCount: jobPostings.extensionCount,
      candidateCount: count(candidates.id),
      screenedCount: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.screeningScore} IS NOT NULL THEN 1 ELSE 0 END), 0)`,
      interviewedCount: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.stage} IN ('round1_candidate','round1_scheduling','round1_waiting','round1_passed','round2_passed') THEN 1 ELSE 0 END), 0)`,
    })
    .from(jobPostings)
    .leftJoin(candidates, eq(candidates.jobId, jobPostings.id))
    .where(and(jobOrgFilter(me!)))
    .groupBy(jobPostings.id)
    .orderBy(desc(jobPostings.createdAt));

  // 정렬: 내가 면접관(1) → 최신 등록순(SQL desc 유지)
  const sorted = [...rows].sort((a, b) => {
    const ai = interviewerSet.has(a.id) ? 1 : 0;
    const bi = interviewerSet.has(b.id) ? 1 : 0;
    if (ai !== bi) return bi - ai;
    return 0;
  });

  return Response.json(
    sorted.map(({ passwordHash, ...r }) => ({
      ...r,
      hasPassword: passwordHash != null,
    }))
  );
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin" && me!.orgId == null)
    return new Response("법인이 지정되지 않은 계정입니다.", { status: 403 });

  const body = await req.json();
  const required = ["title", "position", "level", "employmentType", "responsibilities", "requirements"];
  for (const k of required) {
    if (!body[k]) return new Response(`${k} 필수`, { status: 400 });
  }

  let passwordHash: string | null = null;
  if (body.password) {
    if (!isValidPin(body.password))
      return new Response("비밀번호는 4자리 숫자여야 합니다.", { status: 400 });
    passwordHash = await hashPassword(body.password);
  }

  const orgId =
    me!.role === "system_admin"
      ? Number(body.orgId ?? me!.orgId ?? 0) || null
      : me!.orgId;

  const now = new Date();
  const [row] = await db
    .insert(jobPostings)
    .values({
      orgId,
      title: body.title,
      position: body.position,
      level: body.level,
      employmentType: body.employmentType,
      responsibilities: body.responsibilities,
      requirements: body.requirements,
      idealProfile: (body.idealProfile ?? "").toString().slice(0, 3000),
      evaluationFocus: (body.evaluationFocus ?? "").toString().slice(0, 3000),
      tone: body.tone ?? "중립적인",
      interviewDurationMinutes: body.interviewDurationMinutes ?? 20,
      passwordHash,
      publishedAt: now.toISOString(),
      closesAt: defaultClosesAt(now),
      createdByUserId: me!.id,
    })
    .returning();

  // 공고 생성자 자동 면접관 등록 (system_admin 도 포함)
  await db
    .insert(jobInterviewers)
    .values({
      jobId: row.id,
      userId: me!.id,
      assignedByUserId: me!.id,
    })
    .onConflictDoNothing();

  if (orgId) {
    await chargeFeature({
      orgId,
      feature: "job_post",
      refType: "job",
      refId: row.id,
      userId: me!.id,
      memo: row.title,
    });
  }

  return Response.json(row);
}

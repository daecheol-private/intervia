import { db } from "@/lib/db";
import { jobPostings, candidates } from "@/lib/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { enqueueScreening } from "@/lib/screening-queue";
import { triggerWorker } from "@/lib/worker-trigger";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * 임시 공고였을 때 지원 링크로 들어와 hold(파싱·마스킹만) 된 이력서들의 평가 처리.
 *
 * GET  : hold 된 건수 — 정식 전환 직후 "N건 평가하시겠습니까?" 확인창에 사용.
 * POST : hold 이력서를 일괄 평가 큐에 등록 (자동 아님 — 사용자 확인 후 호출).
 *
 * hold = source='apply_link' 이고 아직 점수 없음(screening_score IS NULL).
 */
async function loadOwned(jobId: number, me: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  const [job] = await db.select().from(jobPostings).where(eq(jobPostings.id, jobId));
  if (!job || !ownsOrg(me, job.orgId)) return null;
  return job;
}

// hold = 지원 링크로 들어왔고 아직 점수 없음 + **진행/대기/보류 중인 평가 작업이 없는** 후보.
// 정식 공고에 들어온 지원자는 자동으로 큐에 올라 평가되므로(queued/processing) hold 가 아니다.
// 임시 공고였다가 정식 전환된 뒤 평가가 한 번도 안 걸린 후보(파싱만 done)만 여기 잡힌다.
const heldFilter = (jobId: number) =>
  and(
    eq(candidates.jobId, jobId),
    eq(candidates.source, "apply_link"),
    isNull(candidates.screeningScore),
    sql`NOT EXISTS (SELECT 1 FROM screening_jobs sj WHERE sj.candidate_id = ${candidates.id} AND sj.status IN ('queued','processing','paused'))`
  );

// 토큰 부족으로 평가가 보류(paused)된 후보 — 충전 시 자동 재개되므로 "지금 평가"가 아니라 별도 안내.
const pausedFilter = (jobId: number) =>
  and(
    eq(candidates.jobId, jobId),
    eq(candidates.source, "apply_link"),
    isNull(candidates.screeningScore),
    sql`EXISTS (SELECT 1 FROM screening_jobs sj WHERE sj.candidate_id = ${candidates.id} AND sj.status = 'paused')`
  );

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const jobId = Number(id);
  const job = await loadOwned(jobId, me!);
  if (!job) return new Response("Not found", { status: 404 });

  const [held] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(candidates)
    .where(heldFilter(jobId));
  const [paused] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(candidates)
    .where(pausedFilter(jobId));
  return Response.json({
    heldCount: Number(held?.c ?? 0),
    pausedCount: Number(paused?.c ?? 0),
    isDraft: job.isDraft,
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
  const job = await loadOwned(jobId, me!);
  if (!job) return new Response("Not found", { status: 404 });

  if (job.isDraft)
    return Response.json(
      {
        code: "still_draft",
        message: "임시 공고입니다. 먼저 공고 내용을 채워 정식 등록한 뒤 평가할 수 있습니다.",
      },
      { status: 400 }
    );

  const held = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(heldFilter(jobId));

  let enqueued = 0;
  for (const c of held) {
    try {
      const r = await enqueueScreening(c.id, me!.id);
      if (r.status === "enqueued") enqueued++;
    } catch {
      /* 개별 실패는 건너뜀 — 후보자 상세에서 재시도 가능 */
    }
  }
  if (enqueued > 0) triggerWorker(req);

  logAudit(req, {
    actor: me!,
    action: "screen.bulk_trigger",
    resourceType: "job",
    resourceId: jobId,
    orgId: job.orgId,
    metadata: { source: "apply_link_held", enqueued, total: held.length },
  });

  return Response.json({ enqueued, total: held.length });
}

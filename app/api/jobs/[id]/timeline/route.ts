/**
 * 공고 활동 타임라인 — audit_logs 중 채용 진행 이벤트만 시간순으로 반환.
 *
 * 접근 권한은 공고 상세와 동일 (법인 소유 + PIN 잠금). admin 감사 페이지와 달리
 * member 도 조회 가능 — 보안 감사가 아니라 "이 공고에 무슨 일이 있었나" 협업 뷰.
 * 커서 페이지네이션: ?before=<audit id> (해당 id 미만), limit 기본 50.
 */
import { db } from "@/lib/db";
import { auditLogs, candidates, jobPostings, users } from "@/lib/schema";
import { and, desc, eq, inArray, lt, type SQL } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";

export const runtime = "nodejs";

// 타임라인 노출 액션 화이트리스트 — 로그인/조회 등 보안 감사성 행은 제외.
const TIMELINE_ACTIONS = [
  "job.create",
  "job.draft_create",
  "job.finalize_draft",
  "job.update",
  "job.close",
  "job.reopen",
  "job.extend",
  "job.interviewer_add",
  "job.interviewer_remove",
  "candidate.upload_with_consent",
  "consent.submit",
  "screen.trigger",
  "screen.retry_now",
  "screen.bulk_trigger",
  "candidate.stage_change",
  // legacy — stage 변경·후보자 수정·미팅링크가 이 이름으로 기록되던 시기 행 (metadata 로 구분)
  "user.status_change",
  "interview.create",
  "interview.send_email",
  "candidate.decision_notify_external",
  "candidate.decision_notify_external_undo",
  "interview.start",
  "interview.complete",
  "interview.reevaluate",
  "interview_questions.generate",
  "schedule.select",
  "schedule.counter",
  "schedule.withdraw",
  "schedule.hr_confirm",
  "schedule.manual_confirm",
  "appeal.submit",
  "candidate.delete",
  "candidate.bulk_delete",
];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);
  const [job] = await db
    .select({ id: jobPostings.id, orgId: jobPostings.orgId, passwordHash: jobPostings.passwordHash })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId)) return new Response("Not found", { status: 404 });
  if (
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(jobId, me))
  ) {
    return new Response("잠긴 공고입니다.", { status: 403 });
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const before = Number(url.searchParams.get("before") ?? 0);

  const conditions: SQL[] = [
    eq(auditLogs.jobId, jobId),
    inArray(auditLogs.action, TIMELINE_ACTIONS),
  ];
  if (before > 0) conditions.push(lt(auditLogs.id, before));

  // limit+1 로 다음 페이지 존재 여부 판정.
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      actorUserId: auditLogs.actorUserId,
      actorRole: auditLogs.actorRole,
      actorName: users.name,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // 관련 후보자 id 수집 — resourceType=candidate 는 resourceId, 그 외는 metadata.candidateId.
  const candidateIdOf = (r: (typeof page)[number]): number | null => {
    if (r.resourceType === "candidate" && r.resourceId) return r.resourceId;
    const metaCid = (r.metadata as Record<string, unknown> | null)?.candidateId;
    return typeof metaCid === "number" ? metaCid : null;
  };
  const cids = [...new Set(page.map(candidateIdOf).filter((v): v is number => v != null))];
  const nameById = new Map<number, string>();
  if (cids.length > 0) {
    const cRows = await db
      .select({ id: candidates.id, name: candidates.name })
      .from(candidates)
      .where(inArray(candidates.id, cids));
    for (const c of cRows) nameById.set(c.id, c.name);
  }

  const events = page.map((r) => {
    const cid = candidateIdOf(r);
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    // 후보자 행이 삭제됐으면 감사 metadata 의 이름으로 폴백 (redact 전이면 남아있음).
    const fallbackName =
      typeof meta.name === "string" && meta.name !== "[redacted]" ? meta.name : null;
    return {
      id: r.id,
      action: r.action,
      createdAt: r.createdAt,
      actorRole: r.actorRole,
      actorName: r.actorName,
      candidateId: cid,
      candidateName: cid != null ? nameById.get(cid) ?? fallbackName : null,
      candidateExists: cid != null && nameById.has(cid),
      metadata: meta,
    };
  });

  return Response.json({
    events,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

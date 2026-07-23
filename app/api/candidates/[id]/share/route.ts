import { db } from "@/lib/db";
import { sharedReports } from "@/lib/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { generateShareToken, shareState } from "@/lib/shared-report";
import { addDays, sqliteTimestamp } from "@/lib/utils";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

type SharedReportRow = typeof sharedReports.$inferSelect;

/** 발급 UI 로 내려보내는 링크 정보 — 절대 URL 은 클라이언트가 location.origin 으로 완성. */
function publicLink(r: SharedReportRow) {
  return {
    id: r.id,
    token: r.token,
    path: `/shared/${r.token}`,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    viewCount: r.viewCount,
    lastViewedAt: r.lastViewedAt,
  };
}

/** 현재 활성 공유 링크 조회 (없으면 null). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;

  const rows = await db
    .select()
    .from(sharedReports)
    .where(eq(sharedReports.candidateId, cid))
    .orderBy(desc(sharedReports.createdAt));
  const active = rows.find((r) => shareState(r) === "active") ?? null;
  return Response.json({ link: active ? publicLink(active) : null });
}

/**
 * 공유 링크 발급. 후보자당 활성 링크 1개 불변식 — 기존 활성 링크는 폐기하고 새로 발급.
 * body: { days?: number } (기본 14, 최대 90).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate } = g;

  const body = (await req.json().catch(() => null)) as { days?: number } | null;
  let days = Number(body?.days);
  if (!Number.isFinite(days) || days <= 0) days = DEFAULT_DAYS;
  days = Math.min(Math.floor(days), MAX_DAYS);

  const now = new Date();
  // 기존 활성 링크 폐기 (활성 1개 보장).
  await db
    .update(sharedReports)
    .set({ revokedAt: sqliteTimestamp(now) })
    .where(
      and(eq(sharedReports.candidateId, cid), isNull(sharedReports.revokedAt))
    );

  const token = generateShareToken();
  const [row] = await db
    .insert(sharedReports)
    .values({
      candidateId: cid,
      orgId: candidate.orgId,
      token,
      createdByUserId: me!.id,
      expiresAt: sqliteTimestamp(addDays(now, days)),
    })
    .returning();

  logAudit(req, {
    actor: me!,
    action: "shared_report.create",
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
    jobId: candidate.jobId,
    metadata: { shareId: row.id, days },
  });

  return Response.json({ link: publicLink(row) });
}

/** 활성 공유 링크 전체 폐기(즉시 무효화). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate } = g;

  await db
    .update(sharedReports)
    .set({ revokedAt: sqliteTimestamp(new Date()) })
    .where(
      and(eq(sharedReports.candidateId, cid), isNull(sharedReports.revokedAt))
    );

  logAudit(req, {
    actor: me!,
    action: "shared_report.revoke",
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
    jobId: candidate.jobId,
  });

  return Response.json({ ok: true });
}

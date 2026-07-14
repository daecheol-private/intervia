/**
 * 고객센터 문의 인박스 개요.
 *
 * 권한: **system_admin 전용** (운영자 지원 데스크). org_admin·member 차단.
 * 고객센터는 vendor 가 처리하는 채널 — 고객(org_admin)은 /support 로 제출만 한다.
 * 접수 통지 메일이 링크하는 `/admin/inquiries` 페이지의 데이터 소스.
 * 미처리(open) 건을 먼저 보여 누락을 방지.
 */
import { db } from "@/lib/db";
import { inquiries, candidates, organizations, jobPostings } from "@/lib/schema";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { INQUIRY_STATUSES, type InquiryStatus } from "@/lib/inquiry";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);

  const conditions: SQL[] = [];
  if (
    statusParam &&
    INQUIRY_STATUSES.includes(statusParam as InquiryStatus)
  ) {
    conditions.push(eq(inquiries.status, statusParam as InquiryStatus));
  }

  const rows = await db
    .select({
      id: inquiries.id,
      source: inquiries.source,
      category: inquiries.category,
      message: inquiries.message,
      contactEmail: inquiries.contactEmail,
      contactPhone: inquiries.contactPhone,
      status: inquiries.status,
      adminNote: inquiries.adminNote,
      orgId: inquiries.orgId,
      orgName: organizations.name,
      candidateId: inquiries.candidateId,
      candidateName: candidates.name,
      jobId: inquiries.jobId,
      jobTitle: jobPostings.title,
      createdAt: inquiries.createdAt,
      resolvedAt: inquiries.resolvedAt,
    })
    .from(inquiries)
    .leftJoin(candidates, eq(candidates.id, inquiries.candidateId))
    .leftJoin(organizations, eq(organizations.id, inquiries.orgId))
    .leftJoin(jobPostings, eq(jobPostings.id, inquiries.jobId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      // 미처리(open) 먼저, 그 안에서 최신순.
      sql`CASE WHEN ${inquiries.status} = 'open' THEN 0 ELSE 1 END`,
      desc(inquiries.createdAt)
    )
    .limit(limit);

  const openCount = rows.filter((r) => r.status === "open").length;
  return Response.json({ results: rows, openCount });
}

import { db } from "@/lib/db";
import { candidates } from "@/lib/schema";
import { and, eq, or } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { isSameApplicantName } from "@/lib/apply-identity";

export const runtime = "nodejs";

/**
 * 명의도용 신고 관계 — 후보 상세의 "명의도용 신고됨" / "관련 지원서 N건" / "동일인 의심" 표시용.
 *  - reported: 이 지원서가 신고되어 있으면 그 시각과 신고와 함께 접수된 새 지원서
 *  - related:  이 지원서가 신고로 접수된 새 지원서면, 신고된 기존 지원서 목록
 * 같은 공고·같은 법인 안에서만 찾는다.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const g = await guardCandidate(me!, Number(id));
  if (!g.ok) return g.res;
  const { candidate } = g;

  const scope = and(
    eq(candidates.jobId, candidate.jobId),
    candidate.orgId != null ? eq(candidates.orgId, candidate.orgId) : undefined
  );
  const linkConds = [eq(candidates.identityReportNewCandidateId, candidate.id)];
  if (candidate.identityReportOf != null)
    linkConds.push(eq(candidates.id, candidate.identityReportOf));
  if (candidate.identityReportNewCandidateId != null)
    linkConds.push(eq(candidates.id, candidate.identityReportNewCandidateId));

  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      identityReportedAt: candidates.identityReportedAt,
      identityReportNewCandidateId: candidates.identityReportNewCandidateId,
      createdAt: candidates.createdAt,
    })
    .from(candidates)
    .where(and(scope, or(...linkConds)));

  const relatedRows = rows.filter(
    (r) =>
      r.identityReportNewCandidateId === candidate.id ||
      (r.id === candidate.identityReportOf && r.id !== candidate.id)
  );
  const newRow = candidate.identityReportNewCandidateId
    ? rows.find((r) => r.id === candidate.identityReportNewCandidateId) ?? null
    : null;

  return Response.json({
    reportedAt: candidate.identityReportedAt,
    newApplication: newRow
      ? { id: newRow.id, name: newRow.name, createdAt: newRow.createdAt }
      : null,
    related: relatedRows.map((r) => ({
      id: r.id,
      name: r.name,
      reportedAt: r.identityReportedAt,
      createdAt: r.createdAt,
    })),
    sameName: [...relatedRows, ...(newRow ? [newRow] : [])].some((r) =>
      isSameApplicantName(r.name, candidate.name)
    ),
  });
}

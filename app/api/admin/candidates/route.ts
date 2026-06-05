/**
 * 후보자 전체 검색 (sysadmin 전용, cross-org).
 * PIPA 권리요청 대응용 — 데이터 주체가 본인 데이터 삭제 요청 시 빠른 lookup.
 *
 * `?q=` 으로 이름/이메일/전화번호 부분 일치 검색. 최대 30건.
 */
import { db } from "@/lib/db";
import { candidates, organizations, jobPostings } from "@/lib/schema";
import { and, desc, eq, like, or } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const stepUpGuard = await requireStepUp();
  if (stepUpGuard) return stepUpGuard;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2)
    return Response.json({ results: [] });

  const pattern = `%${q}%`;
  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      email: candidates.email,
      phone: candidates.phone,
      orgId: candidates.orgId,
      orgName: organizations.name,
      jobTitle: jobPostings.title,
      stage: candidates.stage,
      createdAt: candidates.createdAt,
    })
    .from(candidates)
    .leftJoin(organizations, eq(organizations.id, candidates.orgId))
    .leftJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .where(
      and(
        or(
          like(candidates.name, pattern),
          like(candidates.email, pattern),
          like(candidates.phone, pattern)
        )
      )
    )
    .orderBy(desc(candidates.createdAt))
    .limit(30);

  return Response.json({ results: rows });
}

/**
 * 후보 목록 "변경 시그니처" 프로브 — 클라이언트 폴링이 변화 여부만 싸게 확인하는 용도.
 *
 * 공고에 속한 candidates·면접세션·평가큐·일정 중 가장 최근 updated_at(=sig)을 한 쿼리로 구한다.
 * 클라이언트는 이 sig 가 바뀐 경우에만 무거운 /candidates 전체 조회를 한다.
 * updated_at 은 모든 ORM 쓰기에서 $onUpdate 로 자동 갱신된다(raw SQL 미사용 — 누락 없음).
 * 권한은 법인 소유 확인까지만 — sig 는 시각 문자열이라 그 자체로 민감 정보가 아니고,
 * 잠긴 공고(PIN)는 클라이언트가 /candidates 에서 이미 403 을 받아 폴링하지 않는다.
 */
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const jobId = Number(id);

  const [job] = await db
    .select({ orgId: jobPostings.orgId })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId)) return new Response("Not found", { status: 404 });

  // 공고 단위 "최대 변경 시각". 세션·평가큐는 candidate_id 만 있어 candidates 로 좁힌다
  // (인덱스: *_candidate_updated / candidates·일정은 *_job_updated).
  const rows = await db.all<{ sig: string | null }>(sql`
    SELECT MAX(mx) AS sig FROM (
      SELECT MAX(updated_at) AS mx FROM candidates WHERE job_id = ${jobId}
      UNION ALL
      SELECT MAX(s.updated_at) FROM interview_sessions s
        JOIN candidates c ON c.id = s.candidate_id WHERE c.job_id = ${jobId}
      UNION ALL
      SELECT MAX(sj.updated_at) FROM screening_jobs sj
        JOIN candidates c ON c.id = sj.candidate_id WHERE c.job_id = ${jobId}
      UNION ALL
      SELECT MAX(updated_at) FROM interview_schedules WHERE job_id = ${jobId}
    )
  `);
  return Response.json({ sig: rows[0]?.sig ?? "" });
}

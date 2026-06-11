/**
 * 후보자 하위 라우트 공용 가드 — 존재 / 법인 소유(ownsOrg) / 공고 PIN 잠금 검사를 한 번에.
 * PIN 잠금은 후보 상세(GET)뿐 아니라 stage·메모·메일 등 모든 하위 액션에 동일하게 걸려야
 * 부서 간 칸막이가 유지된다. 후보자 라우트에서 개별 구현하지 말고 반드시 이 헬퍼를 쓸 것.
 */
import { db } from "./db";
import { candidates, jobPostings } from "./schema";
import { eq } from "drizzle-orm";
import { ownsOrg } from "./tenant";
import { isJobUnlocked } from "./job-lock";
import type { CurrentUser } from "./auth";

type Candidate = typeof candidates.$inferSelect;
type Job = typeof jobPostings.$inferSelect;

export async function guardCandidate(
  me: CurrentUser,
  candidateId: number
): Promise<
  | { ok: false; res: Response }
  | { ok: true; candidate: Candidate; job: Job | null }
> {
  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!candidate)
    return { ok: false, res: new Response("Not found", { status: 404 }) };
  if (!ownsOrg(me, candidate.orgId))
    return { ok: false, res: new Response("Not found", { status: 404 }) };

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (
    me.role !== "system_admin" &&
    job?.passwordHash &&
    !(await isJobUnlocked(job.id))
  ) {
    return {
      ok: false,
      res: Response.json(
        { locked: true, jobId: job.id, jobTitle: job.title },
        { status: 403 }
      ),
    };
  }

  return { ok: true, candidate, job: job ?? null };
}

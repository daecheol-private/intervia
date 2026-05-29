/**
 * 1차 면접 확정 일정 목록 — "1차 면접 스케쥴 보기" 팝업용.
 *
 * stage=round1_waiting (일정 확정 후 면접 대기) + 확정된 schedule(status=selected, round1)을
 * 조인해 후보자별 선택 슬롯·온오프라인·주소를 반환. 시간 빠른 순 정렬.
 */
import { db } from "@/lib/db";
import { jobPostings, candidates, interviewSchedules } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId)) return new Response("Not found", { status: 404 });
  if (
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(jobId))
  ) {
    return new Response("잠긴 공고입니다.", { status: 403 });
  }

  const rows = await db
    .select({
      candidateId: candidates.id,
      name: candidates.name,
      selectedSlot: interviewSchedules.selectedSlot,
      modeOnline: interviewSchedules.modeOnline,
      address: interviewSchedules.address,
      addressDetail: interviewSchedules.addressDetail,
      onlineMeetingUrl: interviewSchedules.onlineMeetingUrl,
    })
    .from(interviewSchedules)
    .innerJoin(candidates, eq(candidates.id, interviewSchedules.candidateId))
    .where(
      and(
        eq(interviewSchedules.jobId, jobId),
        eq(interviewSchedules.round, "round1"),
        eq(interviewSchedules.status, "selected"),
        eq(candidates.stage, "round1_waiting")
      )
    );

  // 슬롯 있는 것만 + 후보자 중복 제거(같은 후보 selected 여러 건 방어) + 시간 빠른 순.
  const seen = new Set<number>();
  const list = rows
    .filter((r) => {
      if (!r.selectedSlot?.start || seen.has(r.candidateId)) return false;
      seen.add(r.candidateId);
      return true;
    })
    .sort((a, b) => a.selectedSlot!.start.localeCompare(b.selectedSlot!.start));

  return Response.json(list);
}

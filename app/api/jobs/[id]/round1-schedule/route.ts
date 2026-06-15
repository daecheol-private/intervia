/**
 * 면접 확정 일정 목록 — "면접 일정" 팝업용. (1차 + 2차 통합)
 *
 * 확정된 schedule(status=selected)을 후보자와 조인해 선택 슬롯·온오프라인·주소를
 * round 태그와 함께 반환. 시간 빠른 순 정렬.
 *   - 1차: stage=round1_waiting (일정 확정 후 면접 대기) + round=round1
 *   - 2차: stage=round1_passed (2차는 stage 변화 없이 스케줄 row 로만 진행) + round=round2
 * 종결(outcome != null) 후보는 제외 — 불합격자가 확정 일정에 남는 것 방지.
 */
import { db } from "@/lib/db";
import { jobPostings, candidates, interviewSchedules } from "@/lib/schema";
import { eq, and, or, isNull } from "drizzle-orm";
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
      round: interviewSchedules.round,
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
        eq(interviewSchedules.status, "selected"),
        isNull(candidates.outcome),
        or(
          and(
            eq(interviewSchedules.round, "round1"),
            eq(candidates.stage, "round1_waiting")
          ),
          and(
            eq(interviewSchedules.round, "round2"),
            eq(candidates.stage, "round1_passed")
          )
        )
      )
    );

  // 슬롯 있는 것만 + 후보자 중복 제거(같은 후보 selected 여러 건 방어) + 시간 빠른 순.
  // (round1_waiting↔round1, round1_passed↔round2 로 후보당 한 round 만 매칭됨)
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

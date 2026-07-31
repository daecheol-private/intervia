/**
 * 지원자가 메일 링크로 진입할 때 스케쥴 정보 조회 (비로그인).
 */
import { db } from "@/lib/db";
import {
  interviewSchedules,
  candidates,
  jobPostings,
  organizations,
} from "@/lib/schema";
import { eq } from "drizzle-orm";
import { isScheduleSuperseded } from "@/lib/stage-meta";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [sched] = await db
    .select()
    .from(interviewSchedules)
    .where(eq(interviewSchedules.accessToken, token));
  if (!sched)
    return Response.json(
      { code: "not_found", message: "유효하지 않은 링크입니다." },
      { status: 404 }
    );
  if (sched.status === "cancelled")
    return Response.json(
      { code: "cancelled", message: "이 일정 제안은 더 이상 유효하지 않습니다 (재제시 됨)." },
      { status: 410 }
    );
  if (sched.status === "withdrawn")
    return Response.json(
      { code: "withdrawn", message: "이미 지원 취소된 일정입니다." },
      { status: 410 }
    );
  if (new Date(sched.expiresAt) < new Date())
    return Response.json(
      { code: "expired", message: "만료된 링크입니다." },
      { status: 410 }
    );

  const [cand] = await db
    .select({
      name: candidates.name,
      stage: candidates.stage,
      outcome: candidates.outcome,
    })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));

  // 종결·전진한 후보의 링크 차단. 정상 흐름에선 종결 시 cleanupOnClose 가 스케쥴을
  // cancelled 로 닫지만, 그 이전에 만들어진 row 는 status 가 pending/counter_proposed 로
  // 남아 링크가 살아 있다 — 후보자 상태로 한 번 더 판정한다.
  if (
    cand &&
    isScheduleSuperseded({
      stage: cand.stage,
      outcome: cand.outcome,
      round: sched.round,
    })
  )
    return Response.json(
      { code: "closed", message: "이 일정 제안은 더 이상 유효하지 않습니다." },
      { status: 410 }
    );

  const [job] = await db
    .select({
      title: jobPostings.title,
      position: jobPostings.position,
      contactEmail: jobPostings.recruitingContactEmail,
    })
    .from(jobPostings)
    .where(eq(jobPostings.id, sched.jobId));
  const org = sched.orgId
    ? (
        await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, sched.orgId))
      )[0]
    : null;

  return Response.json({
    token: sched.accessToken,
    status: sched.status,
    round: sched.round,
    proposedSlots: sched.proposedSlots,
    modeOnline: sched.modeOnline,
    address: sched.address,
    addressDetail: sched.addressDetail,
    selectedSlot: sched.selectedSlot,
    counterSlots: sched.counterSlots,
    onlineMeetingUrl: sched.onlineMeetingUrl,
    onlineMeetingNote: sched.onlineMeetingNote,
    expiresAt: sched.expiresAt,
    candidateName: cand?.name ?? "지원자",
    jobTitle: job?.title ?? "",
    jobPosition: job?.position ?? "",
    // 채용 담당자 문의처 — 지원자 메일 하단 안내와 같은 값. 구버전 공고면 null.
    contactEmail: job?.contactEmail ?? null,
    orgName: org?.name ?? "법인",
  });
}

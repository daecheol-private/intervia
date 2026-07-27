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
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
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

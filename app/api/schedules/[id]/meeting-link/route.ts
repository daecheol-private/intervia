/**
 * 온라인 면접 미팅 링크 저장 + 후보자/면접관 메일 발송 + ICS 첨부.
 *
 * 사전 조건:
 *  - 같은 법인 멤버 (또는 system_admin)
 *  - schedules.status === 'selected'
 *  - schedules.modeOnline === true
 *  - 시간 정보가 있는 slot (selectedSlot) 존재
 *
 * 동작:
 *  - URL 최소 검증 (https://, 100자 이내, 공백 없음, URL 파싱 가능)
 *  - DB 업데이트: onlineMeetingUrl, onlineMeetingNote, meetingLinkSentAt, meetingLinkSentByUserId
 *  - 메일 발송: 후보자 + 제시 면접관 (각각 ICS 첨부)
 *  - in-app 알림: 공고 면접관 전원
 *  - 감사 로그
 */
import { db } from "@/lib/db";
import { interviewSchedules, candidates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isValidMeetingUrl, type Slot } from "@/lib/schedules";
import { sendScheduleConfirmationEmails } from "@/lib/schedule-notify";
import { notifyJobInterviewers } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const schedId = Number(id);
  const body = (await req.json().catch(() => null)) as {
    meetingUrl?: string;
    note?: string | null;
  } | null;
  if (!body?.meetingUrl)
    return new Response("meetingUrl 필수", { status: 400 });

  const url = body.meetingUrl.trim();
  if (!isValidMeetingUrl(url)) {
    return new Response(
      "유효한 미팅 링크가 아닙니다. https:// 로 시작하는 100자 이내 URL 이어야 합니다.",
      { status: 400 }
    );
  }
  const note = body.note?.toString().slice(0, 1000) ?? null;

  const [sched] = await db
    .select()
    .from(interviewSchedules)
    .where(eq(interviewSchedules.id, schedId));
  if (!sched) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, sched.orgId))
    return new Response("Not found", { status: 404 });
  if (sched.status !== "selected")
    return new Response("확정된 일정이 아닙니다.", { status: 409 });
  if (!sched.modeOnline)
    return new Response("오프라인 면접에는 미팅 링크를 등록할 수 없습니다.", {
      status: 409,
    });
  if (!sched.selectedSlot)
    return new Response("확정된 시간이 없습니다.", { status: 409 });

  const selected = sched.selectedSlot as Slot;

  const now = new Date().toISOString();
  await db
    .update(interviewSchedules)
    .set({
      onlineMeetingUrl: url,
      onlineMeetingNote: note,
      meetingLinkSentAt: now,
      meetingLinkSentByUserId: me!.id,
      updatedAt: now,
    })
    .where(eq(interviewSchedules.id, schedId));

  // 후보자 이름 — 인앱 알림 제목용(메일 정보는 헬퍼가 자체 로드).
  const [cand] = await db
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));

  // 확정 메일 — 후보자 + 면접관 전원에게 미팅 링크 + ICS + 자세히 보기(온라인 확정 케이스).
  try {
    await sendScheduleConfirmationEmails({
      sched,
      slot: selected,
      meetingUrl: url,
      meetingNote: note,
    });
  } catch (e) {
    console.error("[meeting-link] confirmation emails failed", e);
  }

  // in-app 알림 — 공고 면접관 전원. 이메일은 위 헬퍼가 담당하므로 skipEmail.
  try {
    await notifyJobInterviewers(
      sched.jobId,
      {
        type: "schedule_confirmed",
        title: `${cand?.name ?? "후보자"} 님 온라인 미팅 링크가 등록되었습니다`,
        href: `/candidates/${sched.candidateId}`,
        payload: { scheduleId: sched.id, slot: selected, hasMeetingUrl: true },
      },
      { skipEmail: true }
    );
  } catch (e) {
    console.error("meeting link notify interviewers failed", e);
  }

  logAudit(req, {
    actor: me!,
    action: "user.status_change",
    resourceType: "candidate",
    resourceId: sched.candidateId,
    orgId: sched.orgId,
    jobId: sched.jobId,
    metadata: {
      kind: "meeting_link_sent",
      scheduleId: sched.id,
      url,
      hasNote: !!note,
    },
  });

  return Response.json({
    ok: true,
    onlineMeetingUrl: url,
    onlineMeetingNote: note,
    meetingLinkSentAt: now,
  });
}

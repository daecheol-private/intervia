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
import {
  interviewSchedules,
  candidates,
  jobPostings,
  organizations,
  users,
} from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import {
  isValidMeetingUrl,
  buildMeetingLinkEmail,
  buildIcsInvite,
  roundLabel,
  type Slot,
} from "@/lib/schedules";
import {
  sendMail,
  isSmtpAvailable,
  getOrgEmailBranding,
  brandingAttachments,
} from "@/lib/mailer";
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

  // 후보자·면접관 정보 로드
  const [cand] = await db
    .select({ name: candidates.name, email: candidates.email })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  const [job] = await db
    .select({ title: jobPostings.title })
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

  // ICS 본문
  const rl = roundLabel(sched.round);
  const icsTitle = `[${org?.name ?? "Intervia"}] ${job?.title ?? "면접"} ${rl} 면접`;
  const ics = buildIcsInvite({
    uid: `intervia-sched-${sched.id}@intervia`,
    slot: selected,
    title: icsTitle,
    description: `${cand?.name ?? "후보자"} 님 ${rl} 면접\n미팅: ${url}${note ? "\n\n" + note : ""}`,
    location: url,
  });
  const icsAttachment = {
    filename: "interview.ics",
    content: ics,
    contentType: "text/calendar; charset=utf-8; method=REQUEST",
  };

  // 메일 발송 — 후보자 + 제시 면접관
  if (await isSmtpAvailable(sched.orgId)) {
    if (cand?.email) {
      try {
        const branding = await getOrgEmailBranding(sched.orgId);
        const mail = buildMeetingLinkEmail({
          candidateName: cand.name,
          jobTitle: job?.title ?? "공고",
          orgName: org?.name ?? "법인",
          slot: selected,
          meetingUrl: url,
          note,
          forInterviewer: false,
          round: sched.round,
          branding,
        });
        await sendMail({
          to: cand.email,
          ...mail,
          orgId: sched.orgId,
          audience: "candidate",
          attachments: [icsAttachment, ...brandingAttachments(branding)],
        });
      } catch (e) {
        console.error("meeting link mail to candidate failed", e);
      }
    }
    if (sched.proposedByUserId) {
      const [interviewer] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, sched.proposedByUserId));
      if (interviewer?.email) {
        try {
          const mail = buildMeetingLinkEmail({
            candidateName: cand?.name ?? "후보자",
            jobTitle: job?.title ?? "공고",
            orgName: org?.name ?? "법인",
            slot: selected,
            meetingUrl: url,
            note,
            forInterviewer: true,
            round: sched.round,
          });
          await sendMail({
            to: interviewer.email,
            ...mail,
            orgId: sched.orgId,
            audience: "org",
            attachments: [icsAttachment],
          });
        } catch (e) {
          console.error("meeting link mail to interviewer failed", e);
        }
      }
    }
  }

  // in-app 알림 — 공고 면접관 전원.
  // skipEmail: 제시 면접관은 위 buildMeetingLinkEmail(ICS 포함)을 이미 받았고, 나머지에겐
  // 링크가 후보자 페이지 + D-1 리마인더 본문으로 전달되므로 개별 메일은 소음.
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

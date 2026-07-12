/**
 * 온라인 면접 확정 시 줌 회의 자동 생성 + 안내 메일 발송.
 *
 * 후보자가 시간을 선택(/api/schedule/[token]/select)하거나 HR 이 확정
 * (/api/schedules/[id]/confirm)해서 일정이 'selected' 가 되는 순간 호출된다.
 *
 * 조건(아래 중 하나라도 불충족 시 handled=false → 호출부가 기존 "확정 통보" 메일로 폴백):
 *   - modeOnline === true
 *   - 아직 onlineMeetingUrl 이 없음 (중복 생성 방지)
 *   - 법인에 줌 연동(orgZoomConfigs)이 설정돼 있음
 *
 * 성공 시: 줌 회의 생성 → onlineMeetingUrl 저장 → 후보자/면접관에게 링크 메일(+ICS) 발송 → handled=true.
 */
import { db } from "./db";
import {
  interviewSchedules,
  candidates,
  jobPostings,
  organizations,
  users,
  type InterviewSchedule,
} from "./schema";
import { eq } from "drizzle-orm";
import {
  buildMeetingLinkEmail,
  buildIcsInvite,
  type Slot,
} from "./schedules";
import {
  sendMail,
  isSmtpAvailable,
  getOrgEmailBranding,
  brandingAttachments,
} from "./mailer";
import { getZoomCredentials, createMeeting, zoomErrorMessage } from "./zoom";

/**
 * 줌 자동 생성·발송 시도.
 * @returns handled=true 면 호출부는 "확정 통보" 메일을 보내지 말 것(중복 방지) —
 *          이 함수가 더 완전한 "미팅 링크" 메일을 이미 발송했다.
 */
export async function tryAutoCreateZoomMeeting(
  sched: InterviewSchedule
): Promise<{ handled: boolean; meetingUrl?: string }> {
  if (!sched.modeOnline) return { handled: false };
  if (sched.onlineMeetingUrl) return { handled: false };
  if (!sched.selectedSlot) return { handled: false };

  const creds = await getZoomCredentials(sched.orgId);
  if (!creds) return { handled: false };

  const slot = sched.selectedSlot as Slot;

  // 관련 정보 로드
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

  const orgName = org?.name ?? "Intervia";
  const jobTitle = job?.title ?? "면접";
  const candName = cand?.name ?? "후보자";

  // 줌 회의 생성
  let joinUrl: string;
  let password: string | null;
  try {
    const meeting = await createMeeting({
      creds,
      topic: `[${orgName}] ${jobTitle} 1차 면접 - ${candName}`,
      slot,
      timezone: "Asia/Seoul",
      agenda: `${candName} 님 ${jobTitle} 1차 면접`,
    });
    joinUrl = meeting.joinUrl;
    password = meeting.password;
  } catch (e) {
    // 실패 시 폴백 — 호출부가 기존 확정 메일을 보냄. HR 은 수동으로 링크 등록 가능.
    console.error(
      "[schedule-zoom] 줌 회의 생성 실패:",
      zoomErrorMessage(e)
    );
    return { handled: false };
  }

  const note = password ? `회의 비밀번호: ${password}` : null;
  const now = new Date().toISOString();

  await db
    .update(interviewSchedules)
    .set({
      onlineMeetingUrl: joinUrl,
      onlineMeetingNote: note,
      meetingLinkSentAt: now,
      updatedAt: now,
    })
    .where(eq(interviewSchedules.id, sched.id));

  // 메일 발송 (SMTP 미설정 시 생략 — URL 은 이미 저장됨)
  if (await isSmtpAvailable(sched.orgId)) {
    const icsTitle = `[${orgName}] ${jobTitle} 1차 면접`;
    const ics = buildIcsInvite({
      uid: `intervia-sched-${sched.id}@intervia`,
      slot,
      title: icsTitle,
      description: `${candName} 님 1차 면접\n미팅: ${joinUrl}${note ? "\n\n" + note : ""}`,
      location: joinUrl,
    });
    const icsAttachment = {
      filename: "interview.ics",
      content: ics,
      contentType: "text/calendar; charset=utf-8; method=REQUEST",
    };

    if (cand?.email) {
      try {
        const branding = await getOrgEmailBranding(sched.orgId);
        const mail = buildMeetingLinkEmail({
          candidateName: candName,
          jobTitle,
          orgName,
          slot,
          meetingUrl: joinUrl,
          note,
          forInterviewer: false,
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
        console.error("[schedule-zoom] 후보자 메일 실패", e);
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
            candidateName: candName,
            jobTitle,
            orgName,
            slot,
            meetingUrl: joinUrl,
            note,
            forInterviewer: true,
          });
          await sendMail({
            to: interviewer.email,
            ...mail,
            orgId: sched.orgId,
            audience: "org",
            attachments: [icsAttachment],
          });
        } catch (e) {
          console.error("[schedule-zoom] 면접관 메일 실패", e);
        }
      }
    }
  }

  return { handled: true, meetingUrl: joinUrl };
}

/**
 * 면접 일정 확정 시 후보자 + 면접관 전원에게 상황별 안내 메일을 발송하는 공통 헬퍼.
 *
 * 확정 경로(지원자 선택 select / HR 확정 confirm / 줌링크 등록 meeting-link)가 각자
 * 후보자·제시자에게 따로 메일을 보내던 것을 하나로 통일한다. 케이스는 modeOnline +
 * meetingUrl 유무로 자동 판정:
 *   - 오프라인            → 후보자 + 면접관 전원에게 "확정 + 주소" 메일
 *   - 온라인 + 링크 있음  → 후보자 + 면접관 전원에게 "미팅 링크 + ICS" 메일
 *   - 온라인 + 링크 없음  → 후보자에겐 "링크 추후 안내" 확정 메일, 제시자에겐 "링크 등록 요청"
 *                           메일만(나머지 면접관은 인앱 알림으로 충분 — 링크 등록 후 전원 발송)
 *
 * 공유 수신자(면접관 아닌 회의실·인사팀 담당자, 미가입 임원)에게도 같은 확정 사실을
 * 알린다 — 케이스 무관 전원(online_pending 포함, 시간·장소는 이미 정해졌으므로).
 *
 * 인앱 알림은 호출부가 notifyJobInterviewers(skipEmail:true) 로 별도 처리한다.
 * 개별 sendMail 실패는 격리 — 한 수신자 실패가 나머지 발송을 막지 않는다.
 * 조용시간(야간·주말) 무시 즉시 발송 — 일정 확정은 시간 민감 정보.
 */
import { db } from "./db";
import {
  jobInterviewers,
  candidates,
  jobPostings,
  organizations,
  users,
  type InterviewSchedule,
} from "./schema";
import { and, eq } from "drizzle-orm";
import {
  buildScheduleConfirmedEmail,
  buildMeetingLinkEmail,
  buildMeetingLinkRequestEmail,
  buildIcsInvite,
  roundLabel,
  type Slot,
} from "./schedules";
import {
  sendMail,
  isSmtpAvailable,
  getOrgEmailBranding,
  brandingAttachments,
} from "./mailer";
import { resolveMailBaseUrl } from "./notifications";
import { sendScheduleShareEmails } from "./schedule-share";

/** 헬퍼가 참조하는 스케쥴 필드만 추린 최소 타입 — 라우트가 확정 직후 값으로 넘긴다. */
type SchedForEmail = Pick<
  InterviewSchedule,
  | "id"
  | "candidateId"
  | "jobId"
  | "orgId"
  | "round"
  | "modeOnline"
  | "address"
  | "addressDetail"
  | "proposedByUserId"
  | "shareRecipients"
>;

export async function sendScheduleConfirmationEmails(opts: {
  sched: SchedForEmail;
  slot: Slot;
  /** 온라인 확정 + 미팅 링크가 있으면 전달 — 없으면 "링크 등록 요청" 흐름으로 판정. */
  meetingUrl?: string | null;
  meetingNote?: string | null;
  isReschedule?: boolean;
  /** false 면 면접관·제시자 메일을 보내지 않고 후보자에게만 — 수동 확정(전화 합의) 등. */
  notifyInterviewers?: boolean;
  /** false 면 후보자에게 보내지 않는다 — 수동 확정에서 "후보자 통보" 미체크 시. */
  notifyCandidate?: boolean;
}): Promise<{ candidateEmailSent: boolean }> {
  const { sched, slot, isReschedule } = opts;
  const notifyInterviewers = opts.notifyInterviewers !== false;
  const notifyCandidate = opts.notifyCandidate !== false;
  if (!(await isSmtpAvailable(sched.orgId))) return { candidateEmailSent: false };

  const modeOnline = sched.modeOnline;
  const meetingUrl = opts.meetingUrl?.trim() || null;
  const meetingNote = opts.meetingNote ?? null;
  const kind: "offline" | "online_zoom" | "online_pending" = !modeOnline
    ? "offline"
    : meetingUrl
      ? "online_zoom"
      : "online_pending";

  // 관련 정보 로드
  const [cand] = await db
    .select({ name: candidates.name, email: candidates.email })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  const [job] = await db
    .select({
      title: jobPostings.title,
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

  const jobTitle = job?.title ?? "공고";
  const orgName = org?.name ?? "법인";
  const candName = cand?.name ?? "후보자";
  const contactEmail = job?.contactEmail ?? null;
  const base = resolveMailBaseUrl();
  const detailUrl = `${base}/candidates/${sched.candidateId}`;
  const rl = roundLabel(sched.round);

  // ICS 첨부 (온라인 + 링크 있음)
  const icsAttachment =
    kind === "online_zoom" && meetingUrl
      ? {
          filename: "interview.ics",
          content: buildIcsInvite({
            uid: `intervia-sched-${sched.id}@intervia`,
            slot,
            title: `[${orgName}] ${jobTitle} ${rl} 면접`,
            description: `${candName} 님 ${rl} 면접\n미팅: ${meetingUrl}${meetingNote ? "\n\n" + meetingNote : ""}`,
            location: meetingUrl,
          }),
          contentType: "text/calendar; charset=utf-8; method=REQUEST",
        }
      : null;

  // 공유 수신자 — 확정 사실을 면접관 외 담당자(회의실·인사팀·미가입 임원)에게.
  // 케이스·후보자 통보 여부와 무관하게 발송한다. 후보자·면접관 주소와 겹치면 제외.
  const shareSent = new Set<string>();
  if (cand?.email) shareSent.add(cand.email.toLowerCase());
  const notifyShare = async (excludeEmails: Iterable<string>) => {
    try {
      await sendScheduleShareEmails({
        sched,
        slot,
        kind: isReschedule ? "rescheduled" : "confirmed",
        meetingUrl,
        pendingMeetingLink: kind === "online_pending",
        excludeEmails,
      });
    } catch (e) {
      console.error("[schedule-notify] 공유 수신자 메일 실패", e);
    }
  };

  // 1) 후보자
  let candidateEmailSent = false;
  if (notifyCandidate && cand?.email) {
    try {
      const branding = await getOrgEmailBranding(sched.orgId);
      const mail =
        kind === "online_zoom"
          ? buildMeetingLinkEmail({
              candidateName: candName,
              jobTitle,
              orgName,
              slot,
              meetingUrl: meetingUrl!,
              note: meetingNote,
              forInterviewer: false,
              round: sched.round,
              contactEmail,
              branding,
            })
          : buildScheduleConfirmedEmail({
              candidateName: candName,
              jobTitle,
              orgName,
              slot,
              modeOnline,
              address: sched.address,
              addressDetail: sched.addressDetail,
              forInterviewer: false,
              round: sched.round,
              isReschedule,
              pendingMeetingLink: kind === "online_pending",
              contactEmail,
              branding,
            });
      await sendMail({
        to: cand.email,
        ...mail,
        orgId: sched.orgId,
        audience: "candidate",
        attachments: [
          ...(icsAttachment ? [icsAttachment] : []),
          ...brandingAttachments(branding),
        ],
      });
      candidateEmailSent = true;
    } catch (e) {
      console.error("[schedule-notify] 후보자 메일 실패", e);
    }
  }

  if (!notifyInterviewers) {
    await notifyShare(shareSent);
    return { candidateEmailSent };
  }

  // 2) 면접관
  if (kind === "online_pending") {
    // 제시자에게만 "링크 등록 요청" — 나머지 면접관은 인앱 알림으로 충분(링크 등록 후 전원 발송).
    if (sched.proposedByUserId) {
      const [proposer] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, sched.proposedByUserId));
      if (proposer?.email) {
        try {
          const mail = buildMeetingLinkRequestEmail({
            candidateName: candName,
            jobTitle,
            slot,
            detailUrl,
            round: sched.round,
          });
          await sendMail({
            to: proposer.email,
            ...mail,
            orgId: sched.orgId,
            audience: "org",
          });
        } catch (e) {
          console.error("[schedule-notify] 링크 등록 요청 메일 실패", e);
        }
      }
    }
    // 미팅 링크는 아직이지만 시간·방식은 확정 — 공유 수신자에겐 지금 알려야 회의실·일정을 잡는다.
    await notifyShare(shareSent);
    return { candidateEmailSent };
  }

  // offline / online_zoom — 면접관 전원(제시자 포함)에게 상세 메일.
  const interviewers = await db
    .select({ email: users.email })
    .from(jobInterviewers)
    .innerJoin(users, eq(users.id, jobInterviewers.userId))
    .where(
      and(eq(jobInterviewers.jobId, sched.jobId), eq(users.status, "active"))
    );
  const seen = new Set<string>();
  for (const iv of interviewers) {
    if (!iv.email || seen.has(iv.email)) continue;
    seen.add(iv.email);
    try {
      const mail =
        kind === "online_zoom"
          ? buildMeetingLinkEmail({
              candidateName: candName,
              jobTitle,
              orgName,
              slot,
              meetingUrl: meetingUrl!,
              note: meetingNote,
              forInterviewer: true,
              round: sched.round,
            })
          : buildScheduleConfirmedEmail({
              candidateName: candName,
              jobTitle,
              orgName,
              slot,
              modeOnline,
              address: sched.address,
              addressDetail: sched.addressDetail,
              forInterviewer: true,
              round: sched.round,
              isReschedule,
              detailUrl,
            });
      await sendMail({
        to: iv.email,
        ...mail,
        orgId: sched.orgId,
        audience: "org",
        attachments: icsAttachment ? [icsAttachment] : undefined,
      });
    } catch (e) {
      console.error("[schedule-notify] 면접관 메일 실패", e);
    }
  }

  // 면접관에게 이미 나간 주소는 제외하고 공유 수신자 발송.
  for (const e of seen) shareSent.add(e.toLowerCase());
  await notifyShare(shareSent);

  return { candidateEmailSent };
}

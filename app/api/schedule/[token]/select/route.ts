/**
 * 지원자가 면접 시간 선택 → 확정.
 * body: { slotIndex: number } — proposedSlots 배열 중 선택한 인덱스
 */
import { db } from "@/lib/db";
import {
  interviewSchedules,
  candidates,
  jobPostings,
  organizations,
  users,
} from "@/lib/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  buildScheduleConfirmedEmail,
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
import { tryAutoCreateZoomMeeting } from "@/lib/schedule-zoom";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // 공개(토큰 인증) 엔드포인트 — 더블클릭·봇 방어. IP당 분당 10회.
  const limited = await rateLimit(req, "schedule-select", { limit: 10, windowSec: 60 });
  if (limited) return limited;

  const { token } = await params;
  const body = (await req.json().catch(() => null)) as {
    slotIndex?: number;
  } | null;
  if (!body || typeof body.slotIndex !== "number")
    return new Response("slotIndex 필요", { status: 400 });

  const [sched] = await db
    .select()
    .from(interviewSchedules)
    .where(eq(interviewSchedules.accessToken, token));
  if (!sched) return new Response("Not found", { status: 404 });
  if (sched.status !== "pending" && sched.status !== "counter_proposed")
    return new Response("이미 처리된 일정입니다.", { status: 409 });
  if (new Date(sched.expiresAt) < new Date())
    return new Response("만료된 링크입니다.", { status: 410 });

  const slots = sched.proposedSlots as Slot[];
  if (body.slotIndex < 0 || body.slotIndex >= slots.length)
    return new Response("잘못된 슬롯 선택", { status: 400 });

  // 같은 시간대 다수 면접 허용 — 동시간 다른 지원자 확정 여부는 검사하지 않음 (2026-06-12).
  const selected = slots[body.slotIndex];

  // 원자적 claim — pending/counter_proposed 일 때만 selected 로 전이. 위 체크(:41)와
  // 실제 UPDATE 사이의 레이스(후보자 더블클릭·후보자 select 와 HR confirm 교차)에서
  // 둘 다 통과해 Zoom 회의 2개 생성 + 확정 메일 2통이 나가는 것을 차단. 0행 = 이미 확정 → 409.
  const claimed = await db
    .update(interviewSchedules)
    .set({
      status: "selected",
      selectedSlot: selected,
      respondedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(interviewSchedules.id, sched.id),
        inArray(interviewSchedules.status, ["pending", "counter_proposed"])
      )
    )
    .returning({ id: interviewSchedules.id });
  if (claimed.length === 0)
    return new Response("이미 처리된 일정입니다.", { status: 409 });

  logAudit(req, {
    actorRole: "candidate",
    action: "schedule.select",
    resourceType: "interview_schedule",
    resourceId: sched.id,
    orgId: sched.orgId,
    jobId: sched.jobId,
    metadata: { candidateId: sched.candidateId, round: sched.round, slot: selected },
  });

  // 후보자 stage 전환 — round1 만 round1_waiting 으로. round2 는 stage 변경 없음(round1_passed 유지).
  if (sched.round === "round1") {
    await db
      .update(candidates)
      .set({ stage: "round1_waiting" })
      .where(eq(candidates.id, sched.candidateId));
  }

  // 확정 메일 발송 (후보자 + 면접관)
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

  // 온라인 면접 + 줌 연동 설정 시: 줌 회의 자동 생성 → 링크 메일(+ICS) 발송.
  // 성공하면 zoomHandled=true → 아래 "확정 통보" 메일은 생략(중복 방지).
  const zoom = await tryAutoCreateZoomMeeting({
    ...sched,
    status: "selected",
    selectedSlot: selected,
  });
  const zoomHandled = zoom.handled;

  if (await isSmtpAvailable(sched.orgId)) {
    // 후보자 본인 — 줌 링크 메일을 이미 보냈으면 생략
    if (!zoomHandled && cand?.email) {
      try {
        const branding = await getOrgEmailBranding(sched.orgId);
        const mail = buildScheduleConfirmedEmail({
          candidateName: cand.name,
          jobTitle: job?.title ?? "공고",
          orgName: org?.name ?? "법인",
          slot: selected,
          modeOnline: sched.modeOnline,
          address: sched.address,
          addressDetail: sched.addressDetail,
          forInterviewer: false,
          round: sched.round,
          branding,
        });
        await sendMail({
          to: cand.email,
          ...mail,
          orgId: sched.orgId,
          audience: "candidate",
          attachments: brandingAttachments(branding),
        });
      } catch (e) {
        console.error("confirm mail to candidate failed", e);
      }
    }
    // 면접관 (제시한 사람) — 알림 메일. 줌 링크 메일을 이미 보냈으면 생략
    if (!zoomHandled && sched.proposedByUserId) {
      const [interviewer] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, sched.proposedByUserId));
      if (interviewer?.email) {
        try {
          const mail = buildScheduleConfirmedEmail({
            candidateName: cand?.name ?? "후보자",
            jobTitle: job?.title ?? "공고",
            orgName: org?.name ?? "법인",
            slot: selected,
            modeOnline: sched.modeOnline,
            address: sched.address,
            addressDetail: sched.addressDetail,
            forInterviewer: true,
            round: sched.round,
          });
          await sendMail({
            to: interviewer.email,
            ...mail,
            orgId: sched.orgId,
            audience: "org",
          });
        } catch (e) {
          console.error("confirm mail to interviewer failed", e);
        }
      }
    }
  }

  // 인앱 알림 — 공고 면접관 전원 fanout (제시자도 면접관에 포함되므로 별도 발송 시 중복)
  const notifTitle = `${cand?.name ?? "후보자"} 님이 ${roundLabel(sched.round)} 면접 시간을 확정했습니다`;
  const notifHref = `/candidates/${sched.candidateId}`;
  try {
    // proposer 는 위에서 풍부한 일정 메일을 이미 받음 — 중복 차단.
    await notifyJobInterviewers(
      sched.jobId,
      {
        type: "schedule_confirmed",
        title: notifTitle,
        href: notifHref,
        payload: { scheduleId: sched.id, slot: selected },
      },
      sched.proposedByUserId
        ? { excludeEmailUserIds: [sched.proposedByUserId] }
        : undefined
    );
  } catch (e) {
    console.error("schedule confirm notify interviewers failed", e);
  }

  return Response.json({
    ok: true,
    selectedSlot: selected,
    modeOnline: sched.modeOnline,
    address: sched.address,
  });
}

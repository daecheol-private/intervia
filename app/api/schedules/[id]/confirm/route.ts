/**
 * HR 측에서 1차 면접 일정 확정.
 *
 * 시나리오:
 *   - 후보자가 counter_proposed (역제시) 한 상태에서 HR 이 그 시간 중 하나를 수락.
 *   - 또는 pending 상태에서 후보자 응답을 기다리지 않고 HR 이 직접 1슬롯 확정 (드물지만 가능).
 *
 * 입력 body:
 *   { slot: { start: ISOString, end: ISOString } }
 *   슬롯 자체를 받음 — 후보자 counterSlots 또는 proposedSlots 중 하나여야 안전.
 *   (임의 슬롯 허용 시 후보자 통보 없이 일방적 확정이 되어 부적절)
 *
 * 동작:
 *   - schedule.status: counter_proposed | pending → selected
 *   - selectedSlot 저장, respondedAt = now (HR 확정 시점)
 *   - candidate.stage → round1_waiting
 *   - 후보자 + 면접관에게 확정 메일 발송
 *   - 인앱 알림 fanout
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
  buildScheduleConfirmedEmail,
  roundLabel,
  type Slot,
} from "@/lib/schedules";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import { notifyJobInterviewers } from "@/lib/notifications";
import { tryAutoCreateZoomMeeting } from "@/lib/schedule-zoom";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

function slotEquals(a: Slot, b: Slot): boolean {
  return a.start === b.start && a.end === b.end;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const scheduleId = Number(id);
  if (!Number.isFinite(scheduleId))
    return new Response("잘못된 schedule id", { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    slot?: { start: string; end: string };
  } | null;
  if (!body?.slot?.start || !body?.slot?.end)
    return new Response("slot { start, end } 필요", { status: 400 });

  const [sched] = await db
    .select()
    .from(interviewSchedules)
    .where(eq(interviewSchedules.id, scheduleId));
  if (!sched) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, sched.orgId))
    return new Response("Not found", { status: 404 });

  if (sched.status !== "pending" && sched.status !== "counter_proposed")
    return new Response("이미 처리된 일정입니다.", { status: 409 });

  // 후보자가 제시한 counter slots, 또는 HR 가 처음에 제시한 proposed slots 중 하나여야 함.
  // 그 외 임의 슬롯은 허용 X — 후보자 통보 없는 일방 확정 방지.
  const counter = (sched.counterSlots as Slot[] | null) ?? [];
  const proposed = (sched.proposedSlots as Slot[]) ?? [];
  const allowed = [...counter, ...proposed];
  const matched = allowed.find((s) => slotEquals(s, body.slot!));
  if (!matched)
    return new Response(
      "제시된 슬롯 또는 후보자 역제시 슬롯 중에서만 확정 가능합니다.",
      { status: 400 }
    );

  // 같은 시간대 다수 면접 허용 — 동시간 다른 지원자 확정 여부는 검사하지 않음 (2026-06-12).
  const now = new Date().toISOString();
  await db
    .update(interviewSchedules)
    .set({
      status: "selected",
      selectedSlot: matched,
      respondedAt: now,
      updatedAt: now,
    })
    .where(eq(interviewSchedules.id, sched.id));

  // 후보자 stage 전환 — round1 만 round1_waiting 으로. round2 는 stage 변경 없음(round1_passed 유지).
  if (sched.round === "round1") {
    await db
      .update(candidates)
      .set({ stage: "round1_waiting" })
      .where(eq(candidates.id, sched.candidateId));
  }

  // 후보자 + 면접관 메일 발송
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
    selectedSlot: matched,
  });
  const zoomHandled = zoom.handled;

  if (await isSmtpAvailable(sched.orgId)) {
    if (!zoomHandled && cand?.email) {
      try {
        const mail = buildScheduleConfirmedEmail({
          candidateName: cand.name,
          jobTitle: job?.title ?? "공고",
          orgName: org?.name ?? "법인",
          slot: matched,
          modeOnline: sched.modeOnline,
          address: sched.address,
          forInterviewer: false,
          round: sched.round,
        });
        await sendMail({
          to: cand.email,
          ...mail,
          orgId: sched.orgId,
          audience: "candidate",
        });
      } catch (e) {
        console.error("[schedule/confirm] candidate mail failed", e);
      }
    }
    // 제시한 면접관 (있으면) — 풍부한 일정 메일. 줌 링크 메일을 이미 보냈으면 생략
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
            slot: matched,
            modeOnline: sched.modeOnline,
            address: sched.address,
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
          console.error("[schedule/confirm] interviewer mail failed", e);
        }
      }
    }
  }

  // 인앱 알림 — 공고 면접관 전원 fanout (제시자도 면접관에 포함되므로 별도 발송 시 중복)
  const notifTitle = `${cand?.name ?? "후보자"} 님의 ${roundLabel(sched.round)} 면접 시간이 확정되었습니다`;
  const notifHref = `/candidates/${sched.candidateId}`;
  try {
    await notifyJobInterviewers(
      sched.jobId,
      {
        type: "schedule_confirmed",
        title: notifTitle,
        href: notifHref,
        payload: { scheduleId: sched.id, slot: matched },
      },
      sched.proposedByUserId
        ? { excludeEmailUserIds: [sched.proposedByUserId, me!.id] }
        : { excludeEmailUserIds: [me!.id] }
    );
  } catch (e) {
    console.error("[schedule/confirm] notify interviewers failed", e);
  }

  logAudit(req, {
    actor: me!,
    action: "schedule.hr_confirm",
    resourceType: "interview_schedule",
    resourceId: sched.id,
    orgId: sched.orgId,
    metadata: {
      candidateId: sched.candidateId,
      slot: matched,
      fromStatus: sched.status,
    },
  });

  return Response.json({
    ok: true,
    selectedSlot: matched,
    modeOnline: sched.modeOnline,
    address: sched.address,
  });
}

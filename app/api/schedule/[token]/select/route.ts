/**
 * 지원자가 면접 시간 선택 → 확정.
 * body: { slotIndex: number } — proposedSlots 배열 중 선택한 인덱스
 */
import { db } from "@/lib/db";
import { interviewSchedules, candidates } from "@/lib/schema";
import { and, eq, inArray } from "drizzle-orm";
import { roundLabel, type Slot } from "@/lib/schedules";
import { sendScheduleConfirmationEmails } from "@/lib/schedule-notify";
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

  // 후보자 이름 — 인앱 알림 제목용(메일에 필요한 정보는 헬퍼가 자체 로드).
  const [cand] = await db
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));

  // 온라인 면접 + 줌 연동 설정 시: 줌 회의 자동 생성 → onlineMeetingUrl 저장.
  const zoom = await tryAutoCreateZoomMeeting({
    ...sched,
    status: "selected",
    selectedSlot: selected,
  });

  // 확정 메일 — 후보자 + 면접관 전원(케이스별). 온라인+줌 성공 시 meetingUrl 로 미팅 안내,
  // 온라인+줌 미연동이면 후보자엔 "링크 추후", 제시자에겐 "링크 등록 요청"만 발송.
  try {
    await sendScheduleConfirmationEmails({
      sched,
      slot: selected,
      meetingUrl: zoom.handled ? zoom.meetingUrl : null,
      meetingNote: zoom.handled ? zoom.meetingNote : null,
    });
  } catch (e) {
    console.error("[schedule/select] confirmation emails failed", e);
  }

  // 인앱 알림 — 공고 면접관 전원 fanout. 이메일은 위 헬퍼가 담당하므로 skipEmail.
  const notifTitle = `${cand?.name ?? "후보자"} 님이 ${roundLabel(sched.round)} 면접 시간을 확정했습니다`;
  const notifHref = `/candidates/${sched.candidateId}`;
  try {
    await notifyJobInterviewers(
      sched.jobId,
      {
        type: "schedule_confirmed",
        title: notifTitle,
        href: notifHref,
        payload: { scheduleId: sched.id, slot: selected },
      },
      { skipEmail: true }
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

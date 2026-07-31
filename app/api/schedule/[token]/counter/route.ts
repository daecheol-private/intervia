/**
 * 지원자가 면접 시간 역제시 — 가능한 시간 후보 N개 + 코멘트 전송.
 * 면접관은 대시보드 알림으로 확인 후 다시 제시.
 */
import { db } from "@/lib/db";
import { candidates, interviewSchedules } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { validateSlots } from "@/lib/schedules";
import { isScheduleSuperseded } from "@/lib/stage-meta";
import { notifyJobInterviewers } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // 공개(토큰 인증) 엔드포인트 — 매 호출이 면접관 전원에게 알림을 발송하므로 플러드 방어. IP당 분당 5회.
  const limited = await rateLimit(req, "schedule-counter", { limit: 5, windowSec: 60 });
  if (limited) return limited;

  const { token } = await params;
  const body = (await req.json().catch(() => null)) as {
    slots?: Array<{ start: string; end: string }>;
    note?: string;
  } | null;
  if (!body) return new Response("바디 필요", { status: 400 });

  const [sched] = await db
    .select()
    .from(interviewSchedules)
    .where(eq(interviewSchedules.accessToken, token));
  if (!sched) return new Response("Not found", { status: 404 });
  if (sched.status !== "pending" && sched.status !== "counter_proposed")
    return new Response("이미 처리된 일정입니다.", { status: 409 });
  if (new Date(sched.expiresAt) < new Date())
    return new Response("만료된 링크입니다.", { status: 410 });

  // 종결·전진한 후보의 역제시 차단 (select 라우트와 동일 판정 — 옛 링크 방어).
  const [candState] = await db
    .select({ stage: candidates.stage, outcome: candidates.outcome })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  if (
    candState &&
    isScheduleSuperseded({
      stage: candState.stage,
      outcome: candState.outcome,
      round: sched.round,
    })
  )
    return new Response("이 일정 제안은 더 이상 유효하지 않습니다.", {
      status: 410,
    });

  const check = validateSlots(body.slots);
  if (!check.ok) return new Response(check.error, { status: 400 });

  await db
    .update(interviewSchedules)
    .set({
      status: "counter_proposed",
      counterSlots: check.slots,
      candidateNote: body.note?.slice(0, 1000) ?? null,
      respondedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(interviewSchedules.id, sched.id));

  logAudit(req, {
    actorRole: "candidate",
    action: "schedule.counter",
    resourceType: "interview_schedule",
    resourceId: sched.id,
    orgId: sched.orgId,
    jobId: sched.jobId,
    metadata: {
      candidateId: sched.candidateId,
      round: sched.round,
      slots: check.slots,
    },
  });

  const [cand] = await db
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  const title = `${cand?.name ?? "후보자"} 님이 면접 시간을 역제시했습니다`;
  const href = `/candidates/${sched.candidateId}`;
  try {
    await notifyJobInterviewers(sched.jobId, {
      type: "schedule_counter_proposed",
      title,
      href,
      payload: { scheduleId: sched.id, slots: check.slots },
    });
  } catch (e) {
    console.error("schedule counter notify interviewers failed", e);
  }

  return Response.json({ ok: true });
}

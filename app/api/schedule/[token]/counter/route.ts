/**
 * 지원자가 면접 시간 역제시 — 가능한 시간 후보 N개 + 코멘트 전송.
 * 면접관은 대시보드 알림으로 확인 후 다시 제시.
 */
import { db } from "@/lib/db";
import { candidates, interviewSchedules } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { validateSlots } from "@/lib/schedules";
import { notifyJobInterviewers } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
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

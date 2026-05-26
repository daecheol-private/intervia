/**
 * 지원자가 메일 링크에서 "지원 취소" 클릭 → 즉시 outcome=withdrawn 처리.
 * stage 는 직전 진행 단계 그대로 보존 (어디서 취소됐는지). 본문 폐기 트리거.
 */
import { db } from "@/lib/db";
import { interviewSchedules, candidates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { purgeOnDecision } from "@/lib/candidate-stage";
import {
  createNotification,
  notifyJobInterviewers,
} from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = (await req.json().catch(() => null)) as {
    note?: string;
  } | null;

  const [sched] = await db
    .select()
    .from(interviewSchedules)
    .where(eq(interviewSchedules.accessToken, token));
  if (!sched) return new Response("Not found", { status: 404 });
  if (sched.status === "withdrawn")
    return Response.json({ ok: true, alreadyWithdrawn: true });
  if (new Date(sched.expiresAt) < new Date() && sched.status !== "selected")
    return new Response("만료된 링크입니다.", { status: 410 });

  const now = new Date().toISOString();
  await db
    .update(interviewSchedules)
    .set({
      status: "withdrawn",
      candidateNote: body?.note?.slice(0, 1000) ?? null,
      respondedAt: now,
      updatedAt: now,
    })
    .where(eq(interviewSchedules.id, sched.id));

  // stage 는 그대로 두고 outcome 만 설정 (어디서 취소됐는지 stage 자체가 정보).
  const [prev] = await db
    .select({ stage: candidates.stage, outcome: candidates.outcome })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));

  if (prev?.outcome) {
    // 이미 종결됨 — 멱등 처리
    return Response.json({ ok: true, alreadyTerminated: true });
  }

  await db
    .update(candidates)
    .set({
      outcome: "withdrawn",
      outcomeReason: "candidate_withdrew",
      decidedAt: now,
      decisionFromStage: prev?.stage ?? null,
    })
    .where(eq(candidates.id, sched.candidateId));

  // 본문 폐기 (PIPA)
  await purgeOnDecision(sched.candidateId).catch((e) =>
    console.error("purgeOnDecision after withdraw failed", e)
  );

  const [cand] = await db
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  const title = `${cand?.name ?? "후보자"} 님이 지원을 취소했습니다`;
  const href = `/candidates/${sched.candidateId}`;
  if (sched.proposedByUserId) {
    try {
      await createNotification({
        userId: sched.proposedByUserId,
        type: "schedule_withdrawn",
        title,
        href,
        payload: { scheduleId: sched.id },
      });
    } catch (e) {
      console.error("schedule withdraw notify proposer failed", e);
    }
  }
  try {
    await notifyJobInterviewers(sched.jobId, {
      type: "schedule_withdrawn",
      title,
      href,
      payload: { scheduleId: sched.id },
    });
  } catch (e) {
    console.error("schedule withdraw notify interviewers failed", e);
  }

  return Response.json({ ok: true });
}

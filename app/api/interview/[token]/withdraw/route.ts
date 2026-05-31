/**
 * AI 면접 지원취소 — 후보자가 면접 시작 전 "지원취소" 클릭 시.
 * outcome='withdrawn' (stage 는 직전 단계 보존) + 본문 폐기.
 */
import { db } from "@/lib/db";
import { interviewSessions, candidates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { purgeOnDecision } from "@/lib/candidate-stage";
import { maybeAutoCloseJob } from "@/lib/job-lifecycle";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("Not found", { status: 404 });
  if (session.status === "completed")
    return new Response("이미 완료된 면접입니다.", { status: 409 });

  const now = new Date().toISOString();
  await db
    .update(interviewSessions)
    .set({ status: "expired", completedAt: now })
    .where(eq(interviewSessions.id, session.id));

  const [prev] = await db
    .select({
      stage: candidates.stage,
      outcome: candidates.outcome,
      jobId: candidates.jobId,
    })
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));

  // 이미 종결된 후보자 — 멱등 처리 (중복 폐기 방지).
  if (prev?.outcome) {
    return Response.json({ ok: true, alreadyTerminated: true });
  }

  // stage 는 직전 진행 단계 보존 (어디서 취소됐는지), outcome 만 설정.
  await db
    .update(candidates)
    .set({
      outcome: "withdrawn",
      outcomeReason: "candidate_withdrew",
      decidedAt: now,
      decisionFromStage: prev?.stage ?? null,
    })
    .where(eq(candidates.id, session.candidateId));

  await purgeOnDecision(session.candidateId).catch((e) =>
    console.error("purgeOnDecision after AI-interview withdraw failed", e)
  );

  // 모든 지원자가 종결되면 공고 자동 종결.
  if (prev?.jobId) {
    await maybeAutoCloseJob(prev.jobId).catch((e) =>
      console.error("maybeAutoCloseJob after AI-interview withdraw failed", e)
    );
  }

  return Response.json({ ok: true });
}

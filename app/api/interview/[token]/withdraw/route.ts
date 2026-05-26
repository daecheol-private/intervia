/**
 * AI 면접 거부 (지원취소) — 후보자가 면접 시작 전 "지원 취소" 클릭 시.
 * candidates.stage = 'withdrawn' + 본문 폐기.
 */
import { db } from "@/lib/db";
import { interviewSessions, candidates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { purgeOnDecision } from "@/lib/candidate-stage";

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
    .select({ stage: candidates.stage })
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  await db
    .update(candidates)
    .set({
      stage: "withdrawn",
      decidedAt: now,
      decisionFromStage: prev?.stage ?? null,
    })
    .where(eq(candidates.id, session.candidateId));

  await purgeOnDecision(session.candidateId).catch((e) =>
    console.error("purgeOnDecision after AI-interview withdraw failed", e)
  );

  return Response.json({ ok: true });
}

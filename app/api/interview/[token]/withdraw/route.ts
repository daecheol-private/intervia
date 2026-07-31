/**
 * AI 면접 지원취소 — 후보자가 면접 시작 전 "지원취소" 클릭 시.
 * outcome='withdrawn' (stage 는 직전 단계 보존) + 본문 폐기.
 */
import { db } from "@/lib/db";
import { interviewSessions, candidates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { cleanupOnClose, purgeOnDecision } from "@/lib/candidate-stage";
import { notifyShareCancelOnCandidateClosed } from "@/lib/schedule-share";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // 지원취소 spam 방지 — IP 분당 5회
  const limited = await rateLimit(req, "interview-withdraw", {
    limit: 5,
    windowSec: 60,
  });
  if (limited) return limited;

  const { token } = await params;
  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("Not found", { status: 404 });
  if (session.status === "completed")
    return new Response("이미 완료된 면접입니다.", { status: 409 });

  // 본인 확인 — 지원취소는 이력서 본문·파일을 즉시 영구 폐기(복구 불가)하므로,
  // 토큰만 가진 제3자가 후보자 지원을 취소시키지 못하도록 본인 이메일 일치를 강제한다.
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const [me] = await db
    .select({ email: candidates.email })
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  // 등록된 이메일이 없으면 토큰만으로 본인을 확인할 수 없으므로 거부 (fail-safe).
  if (!me?.email) {
    return new Response(
      "본인 확인을 진행할 수 없습니다 (등록된 이메일이 없습니다). 채용 담당자에게 문의해 주세요.",
      { status: 403 }
    );
  }
  const provided = (body?.email ?? "").trim().toLowerCase();
  const expected = me.email.trim().toLowerCase();
  if (!provided || provided !== expected) {
    return new Response(
      "본인 확인 실패: 면접 안내 메일을 받으신 이메일을 입력해 주세요.",
      { status: 403 }
    );
  }

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
  // 남아있던 일정 제안·평가큐 정리 (이 세션은 위에서 이미 expired 전이).
  await cleanupOnClose(session.candidateId).catch((e) =>
    console.error("cleanupOnClose after AI-interview withdraw failed", e)
  );

  // 예정된 확정 면접이 있으면 일정 공유 수신자에게 취소 통지 (대부분 no-op).
  await notifyShareCancelOnCandidateClosed(session.candidateId, "withdrawn").catch(
    (e) => console.error("share cancel notify after AI-interview withdraw failed", e)
  );

  return Response.json({ ok: true });
}

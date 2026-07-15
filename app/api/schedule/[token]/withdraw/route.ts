/**
 * 지원자가 메일 링크에서 "지원 취소" 클릭 → 즉시 outcome=withdrawn 처리.
 * stage 는 직전 진행 단계 그대로 보존 (어디서 취소됐는지). 본문 폐기 트리거.
 */
import { db } from "@/lib/db";
import { interviewSchedules, candidates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { purgeOnDecision } from "@/lib/candidate-stage";
import { maybeAutoCloseJob } from "@/lib/job-lifecycle";
import { notifyJobInterviewers } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // 공개(토큰 인증) 엔드포인트 — 지원 취소는 본문 폐기(purgeOnDecision)를 부르는 파괴적 액션.
  // 본인 이메일 확인 가드가 있으나 무차별 시도 방어로 IP당 분당 5회 상한.
  const limited = await rateLimit(req, "schedule-withdraw", { limit: 5, windowSec: 60 });
  if (limited) return limited;

  const { token } = await params;
  const body = (await req.json().catch(() => null)) as {
    note?: string;
    email?: string;
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

  // 본인 확인 — 지원 취소는 outcome=withdrawn + purgeOnDecision(이력서 본문·파일 영구 폐기)을
  // 부르는 파괴적·비가역 액션이다. 토큰만 가진 제3자가 링크 유출·전달만으로 후보자 지원을
  // 날려버리지 못하도록, 면접 안내를 받은 등록 이메일과 일치해야 진행한다. 등록 이메일이
  // 없으면 토큰만으로 본인 확인 불가 → 거부(fail-safe). (interview/[token]/me DELETE 와 동일 가드)
  const [identity] = await db
    .select({ email: candidates.email })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  const inputEmail = body?.email?.trim() ?? null;
  if (!identity?.email) {
    return new Response(
      "본인 확인을 진행할 수 없습니다 (등록된 이메일이 없습니다). 채용 담당자에게 문의해 주세요.",
      { status: 403 }
    );
  }
  if (!inputEmail || inputEmail.toLowerCase() !== identity.email.toLowerCase()) {
    return new Response(
      "본인 확인 실패: 면접 안내 메일을 받으신 이메일을 입력해 주세요.",
      { status: 403 }
    );
  }

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

  logAudit(req, {
    actorRole: "candidate",
    action: "schedule.withdraw",
    resourceType: "interview_schedule",
    resourceId: sched.id,
    orgId: sched.orgId,
    jobId: sched.jobId,
    metadata: { candidateId: sched.candidateId, round: sched.round, fromStage: prev?.stage ?? null },
  });

  // 본문 폐기 (PIPA)
  await purgeOnDecision(sched.candidateId).catch((e) =>
    console.error("purgeOnDecision after withdraw failed", e)
  );

  // 모든 지원자가 종결되면 공고 자동 종결.
  await maybeAutoCloseJob(sched.jobId).catch((e) =>
    console.error("maybeAutoCloseJob after schedule withdraw failed", e)
  );

  const [cand] = await db
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  const title = `${cand?.name ?? "후보자"} 님이 지원을 취소했습니다`;
  const href = `/candidates/${sched.candidateId}`;
  try {
    // urgent: 확정 면접이 임박했을 수 있어 취소는 주말·야간에도 즉시 통지(캘린더 정리).
    await notifyJobInterviewers(
      sched.jobId,
      {
        type: "schedule_withdrawn",
        title,
        href,
        payload: { scheduleId: sched.id },
      },
      { urgent: true }
    );
  } catch (e) {
    console.error("schedule withdraw notify interviewers failed", e);
  }

  return Response.json({ ok: true });
}

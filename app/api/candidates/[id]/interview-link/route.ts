import { db } from "@/lib/db";
import { candidates, interviewSessions, jobPostings, screeningJobs } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { generateToken, addDays } from "@/lib/utils";
import { chargeFeature } from "@/lib/tokens";
import {
  requirePositiveBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const body = (await req.json().catch(() => ({}))) as { days?: number };
  const days = body.days ?? 7;

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  // 잔액 가드
  const balanceGuard = await requirePositiveBalance(candidate.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  // 종결 공고는 새 면접 불가
  const [job] = await db
    .select({ status: jobPostings.status })
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (job?.status === "closed")
    return Response.json(
      { code: "job_closed", message: "종결된 공고입니다. 연장 후 다시 시도해 주세요." },
      { status: 409 }
    );

  // AI 면접은 서류평가 결과(interview_focus / strengths / concerns)를 기반으로 진행되므로
  // 서류평가가 끝나지 않은 후보자는 면접 링크 생성 차단.
  if (!candidate.screeningReport) {
    const [lastJob] = await db
      .select({ status: screeningJobs.status })
      .from(screeningJobs)
      .where(eq(screeningJobs.candidateId, cid))
      .orderBy(desc(screeningJobs.id))
      .limit(1);
    const msg =
      lastJob?.status === "queued" || lastJob?.status === "processing"
        ? "AI 서류평가가 진행 중입니다. 평가가 끝난 뒤 면접 링크를 생성할 수 있습니다."
        : lastJob?.status === "failed"
        ? "AI 서류평가가 실패했습니다. 평가를 재시도한 뒤 면접 링크를 생성해 주세요."
        : "AI 서류평가가 완료되지 않았습니다. 평가를 먼저 진행해 주세요.";
    return Response.json(
      { error: msg, code: "screening_required" },
      { status: 409 }
    );
  }

  const token = generateToken();
  const expiresAt = addDays(new Date(), days).toISOString();

  const [session] = await db
    .insert(interviewSessions)
    .values({
      candidateId: cid,
      accessToken: token,
      expiresAt,
    })
    .returning();

  if (candidate.orgId) {
    await chargeFeature({
      orgId: candidate.orgId,
      feature: "interview",
      refType: "interview_session",
      refId: session.id,
      userId: me!.id,
      memo: candidate.name,
    });
  }

  // 면접 링크 발급 시점에 전형 단계 자동 전환 — 아직 결정 단계 전이면 AI면접·대기로.
  if (
    candidate.stage === "applied" ||
    candidate.stage === "screened"
  ) {
    await db
      .update(candidates)
      .set({ stage: "ai_pending" })
      .where(eq(candidates.id, cid));
  }

  return Response.json(session);
}

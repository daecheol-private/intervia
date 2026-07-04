/**
 * 이의제기 검토 상태/답변 업데이트 (채용담당자/시스템관리자).
 */
import { db } from "@/lib/db";
import { appealLogs, jobPostings, organizations, interviewSessions } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { logAudit } from "@/lib/audit";
import { sendMail, buildAppealResponseEmail } from "@/lib/mailer";

export const runtime = "nodejs";

type Status = "pending" | "reviewed" | "resolved" | "rejected";
const ALLOWED: Status[] = ["pending", "reviewed", "resolved", "rejected"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; appealId: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id, appealId } = await params;
  const cid = Number(id);
  const aid = Number(appealId);

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate } = g;

  const [prev] = await db
    .select({
      status: appealLogs.status,
      response: appealLogs.response,
      email: appealLogs.email,
      interviewSessionId: appealLogs.interviewSessionId,
    })
    .from(appealLogs)
    .where(and(eq(appealLogs.id, aid), eq(appealLogs.candidateId, cid)));
  if (!prev) return new Response("Not found", { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    status?: string;
    response?: string;
  } | null;
  if (!body) return new Response("잘못된 요청", { status: 400 });

  const next: { status?: Status; response?: string; reviewedAt?: string; reviewedByUserId?: number } = {};
  if (body.status) {
    if (!ALLOWED.includes(body.status as Status))
      return new Response("상태 값이 올바르지 않습니다.", { status: 400 });
    next.status = body.status as Status;
    if (next.status !== "pending") {
      next.reviewedAt = new Date().toISOString();
      next.reviewedByUserId = me!.id;
    }
  }
  if (typeof body.response === "string") {
    if (body.response.length > 5000)
      return new Response("답변은 5000자 이하로 작성해 주세요.", {
        status: 400,
      });
    next.response = body.response;
  }
  if (Object.keys(next).length === 0)
    return new Response("변경 사항이 없습니다.", { status: 400 });

  await db
    .update(appealLogs)
    .set(next)
    .where(and(eq(appealLogs.id, aid), eq(appealLogs.candidateId, cid)));

  logAudit(req, {
    actor: me!,
    action: "appeal.status_change",
    resourceType: "appeal",
    resourceId: aid,
    orgId: candidate.orgId,
    metadata: { status: next.status, has_response: !!next.response },
  });

  // §37의2 조치 결과 통지 — 최종 상태(resolved/rejected)로 "전환"되는 시점에만
  // 후보자에게 답변을 자동 발송 (동일 상태 재저장·메모 수정만으로는 재발송 안 함).
  let emailSent: boolean | null = null;
  const finalStatus =
    next.status === "resolved" || next.status === "rejected"
      ? next.status
      : null;
  if (finalStatus && prev.status !== finalStatus) {
    const [job] = await db
      .select({ title: jobPostings.title })
      .from(jobPostings)
      .where(eq(jobPostings.id, candidate.jobId));
    const [org] = candidate.orgId
      ? await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, candidate.orgId))
      : [];
    // 이의제기가 걸린 그 세션의 면접 언어로 통지 — 영어로 면접한 후보자는 영어 통지.
    const [sess] = await db
      .select({ language: interviewSessions.language })
      .from(interviewSessions)
      .where(eq(interviewSessions.id, prev.interviewSessionId));
    const mail = buildAppealResponseEmail({
      candidateName: candidate.name ?? "지원자",
      jobTitle: job?.title ?? null,
      status: finalStatus,
      response: next.response ?? prev.response,
      orgName: org?.name ?? null,
      lang: sess?.language === "en" ? "en" : "ko",
    });
    try {
      await sendMail({
        to: prev.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        orgId: candidate.orgId,
        audience: "candidate",
      });
      emailSent = true;
      logAudit(req, {
        actor: me!,
        action: "appeal.response_sent",
        resourceType: "appeal",
        resourceId: aid,
        orgId: candidate.orgId,
        metadata: { status: finalStatus },
      });
    } catch (e) {
      emailSent = false;
      logAudit(req, {
        actor: me!,
        action: "appeal.response_send_failed",
        resourceType: "appeal",
        resourceId: aid,
        orgId: candidate.orgId,
        metadata: {
          status: finalStatus,
          error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        },
      });
    }
  }

  return Response.json({ ok: true, emailSent });
}

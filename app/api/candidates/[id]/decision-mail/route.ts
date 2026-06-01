/**
 * 종결된 후보에게 결정 통보 메일 (재)발송.
 *
 * outcome 이 hired/rejected 인 후보만 대상. withdrawn 은 후보자가 직접 취소했으므로 통보 불필요.
 * stage 변경 API 의 sendNotification 으로 못 보낸/실패한 케이스를 사후에 보내기 위한 별도 엔드포인트.
 */
import { db } from "@/lib/db";
import { candidates, jobPostings, organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { buildDecisionEmail } from "@/lib/candidate-stage";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import { logAudit } from "@/lib/audit";
import {
  requirePositiveBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";
import { MAX_DECISION_EMAILS_PER_CANDIDATE } from "@/lib/job-lifecycle";

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
  const body = (await req.json().catch(() => ({}))) as {
    customMessage?: string;
  };

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  if (candidate.outcome !== "hired" && candidate.outcome !== "rejected") {
    return new Response("결정 통보 메일은 최종합격/불합격 후보에게만 발송됩니다.", {
      status: 400,
    });
  }
  if (!candidate.email) {
    return new Response("후보자에게 이메일이 없습니다.", { status: 400 });
  }

  const balanceGuard = await requirePositiveBalance(candidate.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  if (candidate.decisionEmailCount >= MAX_DECISION_EMAILS_PER_CANDIDATE) {
    return Response.json(
      {
        code: "email_limit_exceeded",
        message: `결정 통보 메일은 후보자당 최대 ${MAX_DECISION_EMAILS_PER_CANDIDATE}회까지만 발송 가능합니다.`,
      },
      { status: 429 }
    );
  }

  if (!(await isSmtpAvailable(candidate.orgId))) {
    return Response.json(
      {
        code: "smtp_not_configured",
        message: "메일 서버가 등록되지 않았습니다.",
      },
      { status: 503 }
    );
  }

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

  const mail = buildDecisionEmail({
    candidateName: candidate.name,
    jobTitle: job?.title ?? "공고",
    decision: candidate.outcome,
    customMessage: body.customMessage,
    companyName: org?.name ?? null,
  });

  try {
    await sendMail({ to: candidate.email, ...mail, orgId: candidate.orgId, audience: "candidate" });
    await db
      .update(candidates)
      .set({ decisionEmailCount: sql`${candidates.decisionEmailCount} + 1` })
      .where(eq(candidates.id, cid));
    logAudit(req, {
      actor: me!,
      action: "interview.send_email",
      resourceType: "candidate",
      resourceId: cid,
      orgId: candidate.orgId,
      metadata: {
        kind: "decision_notify_resend",
        to: candidate.email,
        decision: candidate.outcome,
      },
    });
    return Response.json({
      ok: true,
      sent: candidate.decisionEmailCount + 1,
      max: MAX_DECISION_EMAILS_PER_CANDIDATE,
    });
  } catch (e) {
    return Response.json(
      {
        code: "smtp_send_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

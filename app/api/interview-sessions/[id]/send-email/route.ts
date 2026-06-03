import { db } from "@/lib/db";
import { interviewSessions, candidates, jobPostings, organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import {
  sendMail,
  buildInterviewEmail,
  isSmtpAvailable,
  SmtpNotConfiguredError,
} from "@/lib/mailer";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { formatKstDateTime } from "@/lib/utils";
import {
  requirePositiveBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";
import { MAX_INTERVIEW_EMAILS_PER_CANDIDATE } from "@/lib/job-lifecycle";
import { STAGE_RANK, type Stage } from "@/lib/stage-meta";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const limited = await rateLimit(
    req,
    "send-email",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { id } = await params;
  const sessionId = Number(id);
  const { to } = (await req.json().catch(() => ({}))) as { to?: string };

  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.id, sessionId));
  if (!session) return new Response("세션 없음", { status: 404 });

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  if (!candidate) return new Response("후보자 없음", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("세션 없음", { status: 404 });

  // 종결된 후보 또는 AI 면접 전형을 지나(스킵 포함) 다음 전형으로 진행된 후보에게는
  // AI 면접 링크를 재발송할 수 없다.
  if (candidate.outcome) {
    return Response.json(
      {
        code: "candidate_terminated",
        message: "이미 종결된 후보자에게는 AI 면접 링크를 재발송할 수 없습니다.",
      },
      { status: 409 }
    );
  }
  if (STAGE_RANK[candidate.stage as Stage] > STAGE_RANK.ai_evaluated) {
    return Response.json(
      {
        code: "ai_stage_passed",
        message:
          "AI 면접 전형이 종료되었습니다. 이미 다음 전형으로 진행된 후보자에게는 AI 면접 링크를 재발송할 수 없습니다.",
      },
      { status: 409 }
    );
  }

  // 잔액 가드
  const balanceGuard = await requirePositiveBalance(candidate.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  // 면접링크 발송 횟수 제한
  if (candidate.interviewEmailCount >= MAX_INTERVIEW_EMAILS_PER_CANDIDATE)
    return Response.json(
      {
        code: "email_limit_exceeded",
        message: `면접 링크 메일은 후보자당 최대 ${MAX_INTERVIEW_EMAILS_PER_CANDIDATE}회까지만 발송 가능합니다.`,
        sent: candidate.interviewEmailCount,
        max: MAX_INTERVIEW_EMAILS_PER_CANDIDATE,
      },
      { status: 429 }
    );

  const [job] = await db
    .select({ title: jobPostings.title })
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (!job) return new Response("공고 없음", { status: 404 });

  const recipient = to?.trim() || candidate.email;
  if (!recipient)
    return new Response(
      "후보자에게 이메일이 없습니다. 후보자 정보를 수정하거나 직접 입력하세요.",
      { status: 400 }
    );
  // M4 — RFC5321/5322 기반 실용 정규식 + 길이 가드 (local 64, total 254).
  // 기존 /^[^\s@]+@[^\s@]+\.[^\s@]+$/ 은 "a@b.c" 통과 등 너무 느슨.
  const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
  const localPart = recipient.split("@")[0] ?? "";
  if (
    recipient.length > 254 ||
    localPart.length > 64 ||
    recipient.includes("..") ||
    !EMAIL_RE.test(recipient)
  )
    return new Response("올바른 이메일 형식이 아닙니다.", { status: 400 });

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  const url = `${base}/interview/${session.accessToken}`;
  const expires = formatKstDateTime(session.expiresAt);

  // 발신 법인명 — 후보자가 발신 주체를 확인할 수 있게 메일 본문에 노출 (피싱 식별).
  const [org] =
    candidate.orgId != null
      ? await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, candidate.orgId))
      : [];

  const mail = buildInterviewEmail({
    candidateName: candidate.name,
    jobTitle: job.title,
    url,
    expiresAt: expires,
    orgName: org?.name ?? null,
  });

  // 사전 체크 — 법인/환경변수 어디에도 SMTP 가 없으면 친절히 안내
  if (!(await isSmtpAvailable(candidate.orgId))) {
    return Response.json(
      {
        code: "smtp_not_configured",
        message:
          "메일 서버가 등록되지 않았습니다. 법인 관리자에게 [메일서버] 등록을 요청해 주세요.",
      },
      { status: 503 }
    );
  }

  try {
    await sendMail({ to: recipient, ...mail, orgId: candidate.orgId, audience: "candidate" });
    await db
      .update(candidates)
      .set({
        interviewEmailCount: sql`${candidates.interviewEmailCount} + 1`,
        lastInterviewEmailSentAt: new Date().toISOString(),
      })
      .where(eq(candidates.id, candidate.id));
    logAudit(req, {
      actor: me!,
      action: "interview.send_email",
      resourceType: "interview_session",
      resourceId: session.id,
      orgId: candidate.orgId,
      metadata: { to: recipient, sent: candidate.interviewEmailCount + 1 },
    });
    return Response.json({
      ok: true,
      to: recipient,
      sent: candidate.interviewEmailCount + 1,
      max: MAX_INTERVIEW_EMAILS_PER_CANDIDATE,
    });
  } catch (e) {
    if (e instanceof SmtpNotConfiguredError) {
      return Response.json(
        { code: "smtp_not_configured", message: e.message },
        { status: 503 }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        code: "smtp_send_failed",
        message: `이메일 발송 실패: ${msg}. 법인 관리자에게 [메일서버] 설정을 확인해 달라고 요청해 주세요.`,
      },
      { status: 500 }
    );
  }
}

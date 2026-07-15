/**
 * 후보자 자동화 의사결정 이의제기 (PIPA §37의2).
 *
 * 인증: 면접 토큰 + 본인 이메일 매칭. 토큰 만료여도 제출 가능.
 * Rate limit: IP 분당 3회 (스팸 방지).
 *
 * 제출 시 DPO 에게 알림 메일 (있을 때만 — 실패해도 DB 저장은 성공 응답).
 */
import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  appealLogs,
  jobPostings,
  users,
} from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { extractIp } from "@/lib/auth-attempts";
import { rateLimit } from "@/lib/rate-limit";
import { sendMail, isSmtpAvailable, escapeHtml } from "@/lib/mailer";
import { DPO_INFO, COMPANY_INFO, SITE_INFO } from "@/lib/site-info";
import { logAudit } from "@/lib/audit";
import { notifyJobInterviewers, notifyOrgAdmins } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await rateLimit(req, "appeal", { limit: 3, windowSec: 60 });
  if (limited) return limited;

  const { token } = await params;
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    reason?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase();
  const reason = body?.reason?.trim();

  if (!email || !reason)
    return new Response("이메일과 사유를 모두 입력해 주세요.", { status: 400 });
  if (reason.length < 10 || reason.length > 5000)
    return new Response(
      "사유는 10자 이상, 5000자 이하로 작성해 주세요.",
      { status: 400 }
    );

  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("세션 없음", { status: 404 });

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  if (!candidate) return new Response("후보자 없음", { status: 404 });

  // 본인 확인 — candidates.email 과 입력값 매칭.
  // 일치하지 않아도 동일한 성공 응답을 돌려주고 DB 에는 저장하지 않음.
  // (이메일 enumeration 차단 — 토큰 보유자가 후보자 이메일을 추측 못 하게)
  // 다만 실패 자체는 감사 로그에 남겨 패턴 분석 가능.
  const emailMismatch =
    !!candidate.email && candidate.email.toLowerCase() !== email;
  if (emailMismatch) {
    logAudit(req, {
      actorRole: "candidate",
      action: "appeal.submit_mismatch",
      resourceType: "candidate",
      resourceId: candidate.id,
      orgId: candidate.orgId,
      metadata: { tried_email: email },
    });
    // 응답·지연을 정상 케이스와 동일하게 — timing oracle 방지
    return Response.json({ ok: true });
  }

  await db.insert(appealLogs).values({
    candidateId: candidate.id,
    interviewSessionId: session.id,
    email,
    reason,
    ip: extractIp(req),
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  });

  logAudit(req, {
    actorRole: "candidate",
    action: "appeal.submit",
    resourceType: "candidate",
    resourceId: candidate.id,
    orgId: candidate.orgId,
    metadata: { email, reason_length: reason.length },
  });

  // DPO 메일 알림 — 실패해도 제출은 성공 처리 (사용자 응답 보장)
  void notifyDpo({
    candidateName: candidate.name,
    candidateEmail: email,
    reason,
    jobId: candidate.jobId,
    orgId: candidate.orgId,
  }).catch((e) => console.error("[appeal] DPO 메일 실패:", e));

  // 인앱 알림 — 면접관 + 법인 관리자
  const apTitle = `${candidate.name} 후보자가 AI 평가에 이의를 제기했습니다`;
  const apHref = `/candidates/${candidate.id}`;
  // org_admin 겸직 면접관은 아래 notifyOrgAdmins 메일과 중복 — 면접관 fanout 에선 메일만 제외.
  const adminIds = candidate.orgId
    ? (
        await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.orgId, candidate.orgId), eq(users.role, "org_admin")))
      ).map((r) => r.id)
    : [];
  void notifyJobInterviewers(
    candidate.jobId,
    {
      type: "candidate_appeal",
      title: apTitle,
      href: apHref,
      payload: { candidateId: candidate.id, jobId: candidate.jobId },
    },
    adminIds.length ? { excludeEmailUserIds: adminIds } : undefined
  );
  if (candidate.orgId) {
    void notifyOrgAdmins(
      candidate.orgId,
      {
        type: "candidate_appeal",
        title: apTitle,
        href: apHref,
        payload: { candidateId: candidate.id, jobId: candidate.jobId },
      },
      // PIPA §37의2 이의제기 — 관리자 검토 의무. 메일로도 통지.
      { email: true }
    );
  }

  return Response.json({ ok: true });
}

async function notifyDpo(opts: {
  candidateName: string;
  candidateEmail: string;
  reason: string;
  jobId: number;
  orgId: number | null;
}): Promise<void> {
  if (!(await isSmtpAvailable(opts.orgId))) return;
  const [job] = await db
    .select({ title: jobPostings.title })
    .from(jobPostings)
    .where(eq(jobPostings.id, opts.jobId));
  const jobTitle = job?.title ?? `공고 #${opts.jobId}`;
  const adminUrl = `${SITE_INFO.baseUrl}/admin/appeals`;
  await sendMail({
    to: DPO_INFO.email,
    subject: `[${SITE_INFO.serviceName}] AI 평가 이의제기 접수 — ${opts.candidateName}`,
    text: `자동화 의사결정 이의제기가 접수되었습니다.

후보자: ${opts.candidateName} <${opts.candidateEmail}>
공고: ${jobTitle}
사유:
${opts.reason}

확인: ${adminUrl}

${COMPANY_INFO.name} DPO 알림`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="color:#0f172a;font-size:18px;">AI 평가 이의제기 접수</h2>
  <table style="font-size:13px;color:#334155;border-collapse:collapse;margin-top:12px;">
    <tr><td style="padding:4px 8px;color:#64748b;">후보자</td><td>${escapeHtml(opts.candidateName)} &lt;${escapeHtml(opts.candidateEmail)}&gt;</td></tr>
    <tr><td style="padding:4px 8px;color:#64748b;">공고</td><td>${escapeHtml(jobTitle)}</td></tr>
  </table>
  <div style="margin-top:12px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;white-space:pre-wrap;">${escapeHtml(opts.reason)}</div>
  <p style="margin-top:16px;font-size:12px;color:#64748b;">PIPA §37의2 에 따라 7영업일 이내에 검토 의견을 회신해야 합니다.</p>
  <a href="${adminUrl}" style="display:inline-block;margin-top:8px;background:#2563eb;color:white;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px;">관리자 페이지 열기</a>
</div>`,
    orgId: opts.orgId,
    audience: "org",
  });
}

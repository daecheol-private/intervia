/**
 * AI 면접 링크 일괄 생성 + 메일 발송.
 *
 * 입력: { candidateIds: number[], days?: number }
 * 동작: 후보자별로
 *   - screeningReport 있는지 (없으면 skipped)
 *   - 이메일 있는지 (없으면 skipped)
 *   - 면접 메일 발송 한도 (없으면 skipped)
 *   - interviewSessions row + interview 토큰 차감 + 메일 발송
 *   - candidate.stage 가 applied/screened 면 ai_pending 으로 전환
 *
 * 단일 발송(/api/candidates/[id]/interview-link + /api/interview-sessions/[id]/send-email) 의
 * 두 단계를 묶어서 처리한다.
 */
import { db } from "@/lib/db";
import {
  candidates,
  interviewSessions,
  jobPostings,
  organizations,
} from "@/lib/schema";
import { eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { generateToken, addDays, formatKstDateTime } from "@/lib/utils";
import {
  requirePositiveBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";
import { sendMail, buildInterviewEmail, isSmtpAvailable } from "@/lib/mailer";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { MAX_INTERVIEW_EMAILS_PER_CANDIDATE, isJobExpired } from "@/lib/job-lifecycle";
import { STAGE_RANK, type Stage } from "@/lib/stage-meta";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const limited = await rateLimit(
    req,
    "send-email",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { id } = await params;
  const jobId = Number(id);
  const body = (await req.json().catch(() => null)) as {
    candidateIds?: number[];
    days?: number;
  } | null;

  if (!Array.isArray(body?.candidateIds) || body.candidateIds.length === 0)
    return new Response("후보자를 선택하세요.", { status: 400 });
  if (body.candidateIds.length > 50)
    return new Response("한 번에 최대 50명까지 가능합니다.", { status: 400 });

  const days = body.days ?? 7;

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });
  if (!job.orgId) return new Response("법인 없는 공고", { status: 400 });
  if (job.status === "closed")
    return Response.json(
      { code: "job_closed", message: "종결된 공고입니다." },
      { status: 409 }
    );
  if (isJobExpired(job))
    return Response.json(
      {
        code: "job_expired",
        message:
          "공고 종결 예정일이 지났습니다. 공고를 연장하거나 종결한 후 다시 시도해 주세요.",
      },
      { status: 409 }
    );

  const balanceGuard = await requirePositiveBalance(job.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  if (!(await isSmtpAvailable(job.orgId))) {
    return Response.json(
      {
        code: "smtp_not_configured",
        message:
          "메일 서버가 등록되지 않았습니다. 법인 관리자에게 [메일서버] 등록을 요청해 주세요.",
      },
      { status: 503 }
    );
  }

  // 발신 법인명 — 면접 메일 본문에 노출 (후보자 피싱 식별).
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, job.orgId));
  const orgName = org?.name ?? null;

  const targets = await db
    .select()
    .from(candidates)
    .where(inArray(candidates.id, body.candidateIds));

  const results: {
    candidateId: number;
    status: "sent" | "skipped" | "failed";
    reason?: string;
  }[] = [];

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;

  for (const c of targets) {
    if (c.jobId !== jobId || !ownsOrg(me!, c.orgId)) {
      results.push({ candidateId: c.id, status: "skipped", reason: "권한 없음" });
      continue;
    }
    if (!c.email) {
      results.push({ candidateId: c.id, status: "skipped", reason: "이메일 없음" });
      continue;
    }
    if (!c.screeningReport) {
      results.push({
        candidateId: c.id,
        status: "skipped",
        reason: "AI 서류평가 미완료",
      });
      continue;
    }
    if (c.outcome) {
      results.push({
        candidateId: c.id,
        status: "skipped",
        reason: "이미 종결된 후보",
      });
      continue;
    }
    if (STAGE_RANK[c.stage as Stage] > STAGE_RANK.ai_evaluated) {
      results.push({
        candidateId: c.id,
        status: "skipped",
        reason: "AI 면접 전형 종료 (다음 전형 진행 중)",
      });
      continue;
    }
    if (c.interviewEmailCount >= MAX_INTERVIEW_EMAILS_PER_CANDIDATE) {
      results.push({
        candidateId: c.id,
        status: "skipped",
        reason: "메일 발송 한도 초과",
      });
      continue;
    }

    const token = generateToken();
    const expiresAt = addDays(new Date(), days).toISOString();
    const [session] = await db
      .insert(interviewSessions)
      .values({
        candidateId: c.id,
        accessToken: token,
        expiresAt,
      })
      .returning();

    // 토큰 차감은 지원자가 면접을 실제 시작할 때 수행 (consent). 링크 발급은 무료.

    const url = `${base}/interview/${token}`;
    const mail = buildInterviewEmail({
      candidateName: c.name,
      jobTitle: job.title,
      url,
      expiresAt: formatKstDateTime(expiresAt),
      orgName,
    });

    try {
      await sendMail({ to: c.email, ...mail, orgId: job.orgId, audience: "candidate" });
      await db
        .update(candidates)
        .set({
          interviewEmailCount: sql`${candidates.interviewEmailCount} + 1`,
          lastInterviewEmailSentAt: new Date().toISOString(),
          stage:
            c.stage === "applied" || c.stage === "screened" ? "ai_pending" : c.stage,
        })
        .where(eq(candidates.id, c.id));
      results.push({ candidateId: c.id, status: "sent" });
    } catch (e) {
      results.push({
        candidateId: c.id,
        status: "failed",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  logAudit(req, {
    actor: me!,
    action: "interview.send_email",
    resourceType: "job" as const,
    resourceId: jobId,
    orgId: job.orgId,
    metadata: {
      kind: "interview_link_bulk",
      sent: results.filter((r) => r.status === "sent").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
    },
  });

  return Response.json({ ok: true, results });
}

/**
 * 공고 공유 — 이메일 다수 입력 → 각 이메일별 초대 토큰 생성 + 메일 발송.
 *
 * 정책:
 *  - 발신자는 해당 공고의 법인 멤버여야 함
 *  - 최대 20개 이메일/요청, 분당 1회 (rate limit)
 *  - 같은 이메일에 미사용·미만료 초대가 이미 있으면 그 토큰 재사용 (스팸 방지)
 *  - 이미 같은 법인 멤버인 이메일은 발송 스킵 (응답에 reportedExisting)
 */
import { db } from "@/lib/db";
import {
  jobPostings,
  orgInvites,
  organizations,
  users,
} from "@/lib/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import {
  generateInviteToken,
  inviteExpiresAt,
  parseEmailList,
  buildInviteEmail,
  INVITE_MAX_PER_REQUEST,
} from "@/lib/invites";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

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
    "job-invite",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { id } = await params;
  const jobId = Number(id);
  const body = (await req.json().catch(() => null)) as {
    emails?: string;
  } | null;
  if (!body?.emails || typeof body.emails !== "string")
    return new Response("emails 필요", { status: 400 });

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });
  if (!job.orgId)
    return new Response("법인 없는 공고는 공유 불가", { status: 400 });

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, job.orgId));
  const orgName = org?.name ?? "법인";

  const parsed = parseEmailList(body.emails);
  if (parsed.valid.length === 0)
    return new Response("유효한 이메일이 없습니다.", { status: 400 });
  if (parsed.valid.length > INVITE_MAX_PER_REQUEST)
    return new Response(
      `한 번에 최대 ${INVITE_MAX_PER_REQUEST}개 이메일까지 가능합니다.`,
      { status: 400 }
    );

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

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  const results: {
    email: string;
    status: "sent" | "already_member" | "failed";
    error?: string;
  }[] = [];

  for (const email of parsed.valid) {
    // 이미 같은 법인 active 멤버 → 스킵
    const [existingMember] = await db
      .select({ id: users.id, orgId: users.orgId })
      .from(users)
      .where(eq(users.email, email));
    if (existingMember && existingMember.orgId === job.orgId) {
      results.push({ email, status: "already_member" });
      continue;
    }

    // 미사용·미만료 토큰 재사용
    const [existingInvite] = await db
      .select()
      .from(orgInvites)
      .where(
        and(
          eq(orgInvites.orgId, job.orgId),
          eq(orgInvites.email, email),
          isNull(orgInvites.usedAt),
          gt(orgInvites.expiresAt, new Date().toISOString())
        )
      );

    let token: string;
    let expiresAt: string;
    if (existingInvite) {
      token = existingInvite.token;
      expiresAt = existingInvite.expiresAt;
    } else {
      token = generateInviteToken();
      expiresAt = inviteExpiresAt();
      await db.insert(orgInvites).values({
        token,
        orgId: job.orgId,
        email,
        jobId,
        invitedByUserId: me!.id,
        expiresAt,
      });
    }

    const url = `${base}/invite/${token}`;
    const mail = buildInviteEmail({
      inviterName: me!.name,
      orgName,
      jobTitle: job.title,
      url,
      expiresAt,
    });

    try {
      await sendMail({ to: email, ...mail, orgId: job.orgId, audience: "org" });
      results.push({ email, status: "sent" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ email, status: "failed", error: msg });
    }
  }

  logAudit(req, {
    actor: me!,
    action: "interview.send_email",
    resourceType: "org" as const,
    resourceId: job.orgId,
    orgId: job.orgId,
    metadata: {
      kind: "job_invite",
      jobId,
      sent: results.filter((r) => r.status === "sent").length,
      alreadyMember: results.filter((r) => r.status === "already_member").length,
      failed: results.filter((r) => r.status === "failed").length,
      invalidInputs: parsed.invalid.length,
    },
  });

  return Response.json({
    ok: true,
    results,
    invalidInputs: parsed.invalid,
  });
}

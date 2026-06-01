/**
 * 공고 공유 — 이메일 다수 입력 → 각 이메일별 초대 토큰 생성 + 메일 발송.
 *
 * 정책:
 *  - 발신자는 해당 공고의 법인 멤버여야 함
 *  - 최대 20개 이메일/요청, 분당 1회 (rate limit)
 *  - 같은 이메일에 미사용·미만료 초대가 이미 있으면 그 토큰 재사용 (스팸 방지)
 *  - 이미 같은 법인 멤버인 이메일은 발송 스킵 (status='already_member')
 *  - 이미 다른 법인 소속 이메일은 발송 스킵 (status='other_org') — 수락 시점에 어차피 거절되므로 미리 차단
 */
import { db } from "@/lib/db";
import {
  jobPostings,
  jobInterviewers,
  orgInvites,
  organizations,
  users,
} from "@/lib/schema";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import {
  generateInviteToken,
  inviteExpiresAt,
  parseEmailList,
  buildInviteEmail,
  buildInterviewerAssignedEmail,
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
    memberIds?: number[];
  } | null;
  const emailsInput = typeof body?.emails === "string" ? body.emails : "";
  const memberIds = Array.isArray(body?.memberIds)
    ? body!.memberIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (!emailsInput && memberIds.length === 0)
    return new Response("emails 또는 memberIds 필요", { status: 400 });

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

  const parsed = parseEmailList(emailsInput);
  if (parsed.valid.length === 0 && memberIds.length === 0)
    return new Response(
      "유효한 이메일이 없거나 멤버를 선택하지 않았습니다.",
      { status: 400 }
    );
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
    status: "sent" | "already_member" | "other_org" | "failed";
    error?: string;
  }[] = [];

  // 멤버 선택: 같은 법인 멤버를 면접관으로 자동 등록 + 알림 메일.
  // 외부 이메일 초대와 응답 형식 통일 위해 results 배열에 같이 누적.
  const memberResults: {
    userId: number;
    email: string;
    name: string;
    status: "assigned" | "already_assigned" | "skipped_other_org" | "failed";
    error?: string;
  }[] = [];
  if (memberIds.length > 0) {
    const memberRows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        orgId: users.orgId,
      })
      .from(users)
      .where(inArray(users.id, memberIds));
    const jobUrl = `${base}/jobs/${jobId}`;
    for (const m of memberRows) {
      if (m.orgId !== job.orgId) {
        memberResults.push({
          userId: m.id,
          email: m.email,
          name: m.name,
          status: "skipped_other_org",
        });
        continue;
      }
      // 면접관 등록 — 멱등 (onConflictDoNothing)
      const inserted = await db
        .insert(jobInterviewers)
        .values({
          jobId,
          userId: m.id,
          assignedByUserId: me!.id,
        })
        .onConflictDoNothing()
        .returning({ userId: jobInterviewers.userId });
      const wasAlready = inserted.length === 0;
      const mail = buildInterviewerAssignedEmail({
        inviterName: me!.name,
        orgName,
        jobTitle: job.title,
        url: jobUrl,
      });
      try {
        await sendMail({
          to: m.email,
          ...mail,
          orgId: job.orgId,
          audience: "org",
        });
        memberResults.push({
          userId: m.id,
          email: m.email,
          name: m.name,
          status: wasAlready ? "already_assigned" : "assigned",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        memberResults.push({
          userId: m.id,
          email: m.email,
          name: m.name,
          status: "failed",
          error: msg,
        });
      }
    }
  }

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
    // 이미 다른 법인 소속 → 수락 시점에 거절되므로 발송 자체를 스킵 (혼란 방지)
    if (existingMember && existingMember.orgId != null) {
      results.push({ email, status: "other_org" });
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
      otherOrg: results.filter((r) => r.status === "other_org").length,
      failed: results.filter((r) => r.status === "failed").length,
      invalidInputs: parsed.invalid.length,
      memberAssigned: memberResults.filter((r) => r.status === "assigned").length,
      memberAlreadyAssigned: memberResults.filter((r) => r.status === "already_assigned").length,
      memberFailed: memberResults.filter((r) => r.status === "failed").length,
    },
  });

  return Response.json({
    ok: true,
    results,
    memberResults,
    invalidInputs: parsed.invalid,
  });
}

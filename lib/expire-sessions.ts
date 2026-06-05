import { db } from "./db";
import {
  interviewSessions,
  interviewSchedules,
  candidates,
  jobInterviewers,
  jobPostings,
  users,
} from "./schema";
import { and, eq, lt, sql, isNull, inArray } from "drizzle-orm";
import { purgeOnDecision } from "./candidate-stage";
import { sendMail, isSmtpAvailable, wrapEmailCard, escapeHtml } from "./mailer";

/**
 * 만료 시점이 지난 면접 세션 정리.
 * - status='pending' (미시작) 만 환불 대상. in_progress/completed는 그대로 expired 처리만.
 * - 환불은 candidate.org_id 기준 (interview_session에는 org_id 없음).
 */
export async function expireInterviewSessions(): Promise<{
  expiredCount: number;
  refundedCount: number;
  aiAutoRejected: number;
  scheduleAutoRejected: number;
}> {
  // 만료 세션 정리. 면접은 후차감 모델이라 만료 환불은 없다(미시작/미평가는 과금된 적 없음).
  // pending(AI 미시작) 만료는 자동 불합격 처리 대상이라 in_progress 와 분리해 전이시킨다.
  const expiredPending = await db
    .update(interviewSessions)
    .set({ status: "expired" })
    .where(
      and(
        eq(interviewSessions.status, "pending"),
        lt(interviewSessions.expiresAt, sql`CURRENT_TIMESTAMP`)
      )
    )
    .returning({ id: interviewSessions.id });

  // in_progress 만료는 expired 처리만 (환불 X — 면접을 시작했으므로).
  const expiredInProgress = await db
    .update(interviewSessions)
    .set({ status: "expired" })
    .where(
      and(
        eq(interviewSessions.status, "in_progress"),
        lt(interviewSessions.expiresAt, sql`CURRENT_TIMESTAMP`)
      )
    )
    .returning({ id: interviewSessions.id });

  // AI면접 미시작 만료 → 후보자 자동 불합격 처리 (outcome=rejected, reason=ai_link_expired).
  // 이미 outcome 이 설정된 후보는 제외 (멱등). (변수명은 세션 id 목록 — 이후 inArray 로 조인)
  const expiredSessionCandidateIds = expiredPending.map((r) => r.id);

  // 면접은 후차감 모델 — 미시작/미평가 세션은 과금된 적이 없어 환불 대상이 없다.
  const refundedCount = 0;
  let aiAutoRejected = 0;
  if (expiredSessionCandidateIds.length > 0) {
    const cands = await db
      .select({
        id: candidates.id,
        outcome: candidates.outcome,
        sessionCandidateId: interviewSessions.candidateId,
      })
      .from(interviewSessions)
      .innerJoin(candidates, eq(candidates.id, interviewSessions.candidateId))
      .where(
        and(
          inArray(interviewSessions.id, expiredSessionCandidateIds),
          isNull(candidates.outcome)
        )
      );
    for (const c of cands) {
      await db
        .update(candidates)
        .set({
          outcome: "rejected",
          outcomeReason: "ai_link_expired",
          decidedAt: new Date().toISOString(),
          decisionFromStage: sql`stage`,
        })
        .where(and(eq(candidates.id, c.id), isNull(candidates.outcome)));
      await purgeOnDecision(c.id).catch((e) =>
        console.error("purgeOnDecision after ai expire failed", e)
      );
      aiAutoRejected++;
    }
  }

  // 1차 면접 일정 링크 만료 → 후보자 자동 불합격 처리.
  // status='pending'|'counter_proposed' 인 schedule 이 만료되면 적용.
  const expiredScheds = await db
    .select({
      id: interviewSchedules.id,
      candidateId: interviewSchedules.candidateId,
    })
    .from(interviewSchedules)
    .where(
      and(
        lt(interviewSchedules.expiresAt, sql`CURRENT_TIMESTAMP`),
        sql`${interviewSchedules.status} IN ('pending', 'counter_proposed')`
      )
    );
  let scheduleAutoRejected = 0;
  if (expiredScheds.length > 0) {
    await db
      .update(interviewSchedules)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(
        inArray(
          interviewSchedules.id,
          expiredScheds.map((s) => s.id)
        )
      );
    const candidateIds = Array.from(new Set(expiredScheds.map((s) => s.candidateId)));
    const candsToReject = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(inArray(candidates.id, candidateIds), isNull(candidates.outcome))
      );
    for (const c of candsToReject) {
      await db
        .update(candidates)
        .set({
          outcome: "rejected",
          outcomeReason: "schedule_link_expired",
          decidedAt: new Date().toISOString(),
          decisionFromStage: sql`stage`,
        })
        .where(and(eq(candidates.id, c.id), isNull(candidates.outcome)));
      await purgeOnDecision(c.id).catch((e) =>
        console.error("purgeOnDecision after schedule expire failed", e)
      );
      scheduleAutoRejected++;
    }
  }

  // 자동 불합격된 후보들 → 공고별로 묶어서 면접관에게 알림 메일 1통씩.
  // (만료 직후라 stage 는 보존되어 있고, outcome=rejected, decisionFromStage 기록됨)
  const autoRejectedCandidateIds: number[] = [];
  if (expiredSessionCandidateIds.length > 0) {
    const rows = await db
      .select({ id: candidates.id })
      .from(interviewSessions)
      .innerJoin(candidates, eq(candidates.id, interviewSessions.candidateId))
      .where(
        and(
          inArray(interviewSessions.id, expiredSessionCandidateIds),
          eq(candidates.outcome, "rejected"),
          eq(candidates.outcomeReason, "ai_link_expired")
        )
      );
    for (const r of rows) autoRejectedCandidateIds.push(r.id);
  }
  if (expiredScheds.length > 0) {
    for (const s of expiredScheds) autoRejectedCandidateIds.push(s.candidateId);
  }
  if (autoRejectedCandidateIds.length > 0) {
    await notifyInterviewersOnAutoReject(autoRejectedCandidateIds).catch((e) =>
      console.error("notifyInterviewersOnAutoReject failed", e)
    );
  }

  return {
    expiredCount: expiredPending.length + expiredInProgress.length,
    refundedCount,
    aiAutoRejected,
    scheduleAutoRejected,
  };
}

/**
 * 자동 불합격된 후보들의 공고 면접관 전원에게 알림.
 * 공고별로 묶어 1통씩 (메일 수 최소화). 메일 실패는 silent — cron 흐름 막지 않음.
 */
async function notifyInterviewersOnAutoReject(
  candidateIds: number[]
): Promise<void> {
  if (candidateIds.length === 0) return;
  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      jobId: candidates.jobId,
      orgId: candidates.orgId,
      reason: candidates.outcomeReason,
    })
    .from(candidates)
    .where(inArray(candidates.id, candidateIds));

  // 공고별 그룹
  const byJob = new Map<
    number,
    { orgId: number | null; items: { name: string; reason: string | null }[] }
  >();
  for (const r of rows) {
    const g = byJob.get(r.jobId) ?? { orgId: r.orgId, items: [] };
    g.items.push({ name: r.name, reason: r.reason });
    byJob.set(r.jobId, g);
  }

  const reasonLabel: Record<string, string> = {
    ai_link_expired: "AI면접 링크 만료",
    schedule_link_expired: "1차 면접 일정 링크 만료",
  };

  for (const [jobId, group] of byJob) {
    if (!group.orgId) continue;
    if (!(await isSmtpAvailable(group.orgId))) continue;

    const [job] = await db
      .select({ title: jobPostings.title })
      .from(jobPostings)
      .where(eq(jobPostings.id, jobId));
    if (!job) continue;

    const recipients = await db
      .select({ email: users.email, name: users.name })
      .from(jobInterviewers)
      .innerJoin(users, eq(users.id, jobInterviewers.userId))
      .where(eq(jobInterviewers.jobId, jobId));
    if (recipients.length === 0) continue;

    const listText = group.items
      .map((c) => `- ${c.name} (${reasonLabel[c.reason ?? ""] ?? c.reason ?? "사유 미상"})`)
      .join("\n");
    const subject = `[Intervia] ${job.title} 자동 불합격 처리 알림 (${group.items.length}명)`;
    const text = `다음 후보자들의 면접/일정 링크가 만료되어 자동으로 불합격 처리되었습니다.\n\n${listText}\n\nIntervia`;
    const html = wrapEmailCard({
      innerHtml: `
        <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">자동 불합격 처리 알림</h1>
        <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 16px;">
          <strong style="color:#0f172a;">${escapeHtml(job.title)}</strong> 공고에서 다음 후보자들의 링크가 만료되어 자동으로 불합격 처리되었습니다.
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
          <ul style="font-size:13px;color:#0f172a;line-height:1.8;margin:0;padding-left:18px;">
${group.items.map((c) => `            <li>${escapeHtml(c.name)} <span style="color:#64748b;">— ${reasonLabel[c.reason ?? ""] ?? c.reason ?? "사유 미상"}</span></li>`).join("\n")}
          </ul>
        </div>
      `,
      footer: "본 메일은 Intervia 채용 플랫폼에서 자동 발송되었습니다.",
    });

    for (const r of recipients) {
      try {
        await sendMail({
          to: r.email,
          subject,
          text,
          html,
          orgId: group.orgId,
          audience: "org",
        });
      } catch (e) {
        console.error("auto-reject notify mail failed", { to: r.email, e });
      }
    }
  }
}

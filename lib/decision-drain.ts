/**
 * 불합격 통보 저녁 드레인 — Resend 무료 티어 일 100통 캡 대응.
 *
 * closeJob(대량 종결)이 낮 소프트캡을 넘겨 즉시 못 보낸 불합격 통보를 decisionNotifyQueued=true
 * 로 표시해 둔다. 이 함수(매일 18:00 KST cron)가 그 대기분을 **일일 발송 예산 범위**에서
 * 오래된 순으로 발송한다. 예산을 넘는 나머지는 큐에 남아 다음 날 다시 처리된다(며칠 자동 분산).
 *
 * 예산 = MAIL_DAILY_BUDGET(100) − 오늘 이미 나간 전체 발송(sentToday) − MAIL_DAILY_BUFFER(20).
 * 버퍼는 드레인 후 저녁~심야에 나갈 수 있는 우선메일(초대·일정 등) 몫을 남긴다.
 *
 * 발송 성공: decisionEmailCount++ + 큐 해제. 실패: 큐 유지 → 다음 날 재시도(유실 방지).
 * 단건·수동 결정 통보(decision-mail 라우트)는 이 큐를 쓰지 않고 항상 즉시 발송한다.
 */
import { db } from "./db";
import { candidates, jobPostings, organizations } from "./schema";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { sendMail, getOrgEmailBranding, brandingAttachments } from "./mailer";
import { buildDecisionEmail, resolveCandidateEmailLang } from "./candidate-stage";
import { sentToday } from "./mail-usage";
import { MAX_DECISION_EMAILS_PER_CANDIDATE } from "./job-lifecycle";

export async function drainQueuedDecisions(now = new Date()): Promise<{
  budget: number;
  sent: number;
  failed: number;
  remainingQueued: number;
}> {
  const dailyBudget = Number(process.env.MAIL_DAILY_BUDGET ?? 100);
  const buffer = Number(process.env.MAIL_DAILY_BUFFER ?? 20);
  const budget = Math.max(0, dailyBudget - (await sentToday(now)) - buffer);

  // 대기 중인 불합격 통보(발송 가능 대상) 조건 — 재사용.
  const queuedCond = and(
    eq(candidates.decisionNotifyQueued, true),
    eq(candidates.outcome, "rejected"),
    isNotNull(candidates.email),
    sql`${candidates.decisionEmailCount} < ${MAX_DECISION_EMAILS_PER_CANDIDATE}`
  );

  const [remRow] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(candidates)
    .where(queuedCond);
  const totalQueued = Number(remRow?.c ?? 0);

  if (budget <= 0 || totalQueued === 0) {
    return { budget, sent: 0, failed: 0, remainingQueued: totalQueued };
  }

  const targets = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      email: candidates.email,
      orgId: candidates.orgId,
      jobTitle: jobPostings.title,
      orgName: organizations.name,
    })
    .from(candidates)
    .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .leftJoin(organizations, eq(organizations.id, candidates.orgId))
    .where(queuedCond)
    // 오래된 결정부터 — 먼저 종결된 후보가 먼저 통보받도록.
    .orderBy(asc(candidates.decidedAt), asc(candidates.id))
    .limit(budget);

  let sent = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      const branding = await getOrgEmailBranding(t.orgId);
      const { subject, html, text } = buildDecisionEmail({
        candidateName: t.name,
        jobTitle: t.jobTitle,
        decision: "rejected",
        companyName: t.orgName ?? null,
        lang: await resolveCandidateEmailLang(t.id),
        branding,
      });
      await sendMail({
        to: t.email!,
        subject,
        html,
        text,
        orgId: t.orgId,
        audience: "candidate",
        kind: "decision_reject",
        attachments: brandingAttachments(branding),
      });
      await db
        .update(candidates)
        .set({
          decisionEmailCount: sql`${candidates.decisionEmailCount} + 1`,
          decisionNotifyQueued: false,
        })
        .where(eq(candidates.id, t.id));
      sent++;
    } catch (e) {
      // 큐 유지 → 다음 날 재시도(유실 방지).
      console.error(`decision-drain: send failed (cid=${t.id})`, e);
      failed++;
    }
  }

  return {
    budget,
    sent,
    failed,
    remainingQueued: Math.max(0, totalQueued - sent),
  };
}

/**
 * 확정 면접 24시간 전 면접관 리마인더 메일.
 *
 * cron(`/api/cron/interview-reminders`, 매시간)이 호출.
 * 대상: status='selected' + selectedSlot 존재 + 아직 리마인더 미발송 + 면접 시작이
 *       지금~24시간 이내(미래)인 일정. 공고 면접관 전원에게 1회 발송 후
 *       `interviewerReminderSentAt` 을 기록해 중복 발송을 막는다.
 *
 * SMTP 미설정이면 발송을 건너뛰고 기록도 남기지 않음(설정 후 재시도). 면접이 이미
 * 지난 일정은 시작 시각 가드로 자동 제외된다.
 */
import { db } from "./db";
import { interviewSchedules, candidates, jobPostings } from "./schema";
import { and, eq, isNull } from "drizzle-orm";
import { sendMail, isSmtpAvailable, wrapEmailCard, escapeHtml } from "./mailer";
import { getJobInterviewerEmails } from "./notifications";

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** KST "2026. 06. 03. (수) 13:30 ~ 14:30" 포맷. */
function fmtSlotKst(slot: { start: string; end: string }): string {
  const s = new Date(slot.start);
  const e = new Date(slot.end);
  const datePart = s.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const endTime = e.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ~ ${endTime}`;
}

export async function sendInterviewerReminders(): Promise<{
  scanned: number;
  remindersSent: number;
  schedulesProcessed: number;
}> {
  const now = Date.now();
  const windowEnd = now + REMINDER_WINDOW_MS;

  const rows = await db
    .select({
      scheduleId: interviewSchedules.id,
      jobId: interviewSchedules.jobId,
      orgId: interviewSchedules.orgId,
      selectedSlot: interviewSchedules.selectedSlot,
      modeOnline: interviewSchedules.modeOnline,
      address: interviewSchedules.address,
      addressDetail: interviewSchedules.addressDetail,
      onlineMeetingUrl: interviewSchedules.onlineMeetingUrl,
      candidateName: candidates.name,
      jobTitle: jobPostings.title,
    })
    .from(interviewSchedules)
    .innerJoin(candidates, eq(candidates.id, interviewSchedules.candidateId))
    .innerJoin(jobPostings, eq(jobPostings.id, interviewSchedules.jobId))
    .where(
      and(
        eq(interviewSchedules.status, "selected"),
        isNull(interviewSchedules.interviewerReminderSentAt)
      )
    );

  // 시간 윈도우(지금~24시간 이내, 미래) 필터 — selectedSlot 은 JSON 이라 JS 에서 거른다.
  const due = rows.filter((r) => {
    const start = r.selectedSlot?.start ? new Date(r.selectedSlot.start).getTime() : NaN;
    return Number.isFinite(start) && start > now && start <= windowEnd;
  });

  let remindersSent = 0;
  let schedulesProcessed = 0;

  for (const r of due) {
    if (!(await isSmtpAvailable(r.orgId))) continue; // 설정 후 다음 주기에 재시도

    const interviewers = await getJobInterviewerEmails(r.jobId);
    if (interviewers.length > 0) {
      const slotLabel = fmtSlotKst(r.selectedSlot!);
      const locationRow = r.modeOnline
        ? `<strong>방식</strong> 온라인${
            r.onlineMeetingUrl
              ? ` · <a href="${escapeHtml(r.onlineMeetingUrl)}" style="color:#0d4f3c;word-break:break-all;">미팅 링크</a>`
              : ""
          }`
        : `<strong>방식</strong> 오프라인${
            r.address
              ? ` · ${escapeHtml(r.address)}${r.addressDetail ? ` ${escapeHtml(r.addressDetail)}` : ""}`
              : ""
          }`;

      for (const iv of interviewers) {
        const html = wrapEmailCard({
          innerHtml: `
            <h1 style="font-size:18px;margin:24px 0 8px;color:#0f172a;">${escapeHtml(iv.name)}님, 면접 일정 안내드립니다.</h1>
            <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
              담당 공고 <strong style="color:#0f172a;">${escapeHtml(r.jobTitle)}</strong> 의 면접이
              <strong style="color:#0f172a;">약 24시간 후</strong> 진행될 예정입니다.
            </p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:14px;color:#0f172a;line-height:1.8;margin:0 0 20px;">
              <strong>후보자</strong> ${escapeHtml(r.candidateName)}<br>
              <strong>일시</strong> ${slotLabel}<br>
              ${locationRow}
            </div>
            <p style="font-size:12px;color:#64748b;margin:0;">
              일정에 맞춰 면접 준비를 부탁드립니다.
            </p>
          `,
          footer: "본 메일은 Intervia 시스템에서 자동 발송되었습니다.",
        });
        try {
          await sendMail({
            to: iv.email,
            subject: `[Intervia] 내일 면접 안내 — ${r.candidateName} (${r.jobTitle})`,
            html,
            orgId: r.orgId,
            audience: "org",
          });
          remindersSent++;
        } catch (e) {
          console.error(
            `[interview-reminders] mail failed (schedule=${r.scheduleId}, to=${iv.email}):`,
            e instanceof Error ? e.message : e
          );
        }
      }
    }

    // 면접관이 없어도 처리 완료로 기록 — 다음 주기 재스캔 방지.
    await db
      .update(interviewSchedules)
      .set({ interviewerReminderSentAt: new Date(now).toISOString() })
      .where(eq(interviewSchedules.id, r.scheduleId));
    schedulesProcessed++;
  }

  return { scanned: rows.length, remindersSent, schedulesProcessed };
}

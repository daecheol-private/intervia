/**
 * 면접 리마인더 — cron(`/api/cron/interview-reminders`, 매시간)이 호출.
 *
 * 두 종류:
 *  1) sendScheduleReminders  — 확정 대면 면접(round1/round2) D-1(24h 전):
 *       · 면접관 전원에게 1회 발송 후 `interviewerReminderSentAt` 기록
 *       · 후보자에게 1회 발송 후 `candidateReminderSentAt` 기록 (독립 추적)
 *  2) sendAiInterviewReminders — AI 면접 미응답(pending/in_progress) 후보자에게
 *       링크 발급 후 24h / 48h 경과 시 각 1회 넛지. 완료/만료 세션은 제외.
 *
 * 공통: SMTP 미설정이면 발송을 건너뛰고 기록도 남기지 않음(설정 후 다음 주기 재시도).
 * 운영 메일이라 토큰 차감 없음.
 */
import { db } from "./db";
import {
  interviewSchedules,
  interviewSessions,
  candidates,
  jobPostings,
  organizations,
} from "./schema";
import { and, eq, isNull, or, inArray } from "drizzle-orm";
import {
  sendMail,
  isSmtpAvailable,
  wrapEmailCard,
  escapeHtml,
  buildInterviewReminderEmail,
  EMAIL_BRAND,
} from "./mailer";
import { getJobInterviewerEmails } from "./notifications";
import { sendCandidateAlimtalk } from "./alimtalk";
import { formatKstDateTime } from "./utils";
import { isAiInterviewSuperseded, isScheduleSuperseded } from "./stage-meta";

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const H24_MS = 24 * 60 * 60 * 1000;
const H48_MS = 48 * 60 * 60 * 1000;

/** 면접 링크용 절대 base URL. APP_BASE_URL 우선, 미설정 시 dev=localhost:3003. */
function resolveBaseUrl(): string {
  const envBase = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (envBase) return envBase;
  return process.env.NODE_ENV === "production" ? "" : "http://localhost:3003";
}

/**
 * DB 시각 문자열 → epoch ms.
 * ISO(JS `.toISOString()`)면 그대로, SQLite CURRENT_TIMESTAMP("YYYY-MM-DD HH:MM:SS", UTC)면
 * UTC 로 해석. (space-separated 를 로컬시간으로 오인 파싱하는 것을 막는다.)
 */
function parseDbTimeMs(s: string | null | undefined): number {
  if (!s) return NaN;
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  return Date.parse(iso);
}

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

/**
 * 확정 대면 면접 D-1 리마인더 — 면접관 + 후보자.
 * 대상: status='selected' + selectedSlot 이 지금~24h 이내(미래) + 각 리마인더 미발송.
 * 면접관/후보자 플래그를 독립 추적하므로 한 쪽만 보낸 뒤에도 나머지를 다음에 보낼 수 있다.
 */
export async function sendScheduleReminders(): Promise<{
  scanned: number;
  interviewerRemindersSent: number;
  candidateRemindersSent: number;
  schedulesProcessed: number;
}> {
  const now = Date.now();
  const windowEnd = now + REMINDER_WINDOW_MS;

  const rows = await db
    .select({
      scheduleId: interviewSchedules.id,
      jobId: interviewSchedules.jobId,
      orgId: interviewSchedules.orgId,
      round: interviewSchedules.round,
      selectedSlot: interviewSchedules.selectedSlot,
      modeOnline: interviewSchedules.modeOnline,
      address: interviewSchedules.address,
      addressDetail: interviewSchedules.addressDetail,
      onlineMeetingUrl: interviewSchedules.onlineMeetingUrl,
      interviewerSentAt: interviewSchedules.interviewerReminderSentAt,
      candidateSentAt: interviewSchedules.candidateReminderSentAt,
      candidateName: candidates.name,
      candidateEmail: candidates.email,
      candidatePhone: candidates.phone,
      candidateStage: candidates.stage,
      candidateOutcome: candidates.outcome,
      jobTitle: jobPostings.title,
      orgName: organizations.name,
    })
    .from(interviewSchedules)
    .innerJoin(candidates, eq(candidates.id, interviewSchedules.candidateId))
    .innerJoin(jobPostings, eq(jobPostings.id, interviewSchedules.jobId))
    .leftJoin(organizations, eq(organizations.id, interviewSchedules.orgId))
    .where(
      and(
        eq(interviewSchedules.status, "selected"),
        or(
          isNull(interviewSchedules.interviewerReminderSentAt),
          isNull(interviewSchedules.candidateReminderSentAt)
        )
      )
    );

  // 시간 윈도우(지금~24시간 이내, 미래) 필터 — selectedSlot 은 JSON 이라 JS 에서 거른다.
  const due = rows.filter((r) => {
    // 종결됐거나 해당 차수를 이미 지난 후보자에겐 D-1 리마인드를 보내지 않는다.
    // (수동 종결·전진은 스케줄 status 를 selected 로 둔 채라 파생 판정으로 차단.)
    if (
      isScheduleSuperseded({
        stage: r.candidateStage,
        outcome: r.candidateOutcome,
        round: r.round,
      })
    )
      return false;
    const start = r.selectedSlot?.start ? new Date(r.selectedSlot.start).getTime() : NaN;
    return Number.isFinite(start) && start > now && start <= windowEnd;
  });

  let interviewerRemindersSent = 0;
  let candidateRemindersSent = 0;
  let schedulesProcessed = 0;

  for (const r of due) {
    if (!(await isSmtpAvailable(r.orgId))) continue; // 설정 후 다음 주기에 재시도

    const slotLabel = fmtSlotKst(r.selectedSlot!);
    const roundLabel = r.round === "round2" ? "2차" : "1차";
    const locationRow = r.modeOnline
      ? `<strong>방식</strong> 온라인${
          r.onlineMeetingUrl
            ? ` · <a href="${escapeHtml(r.onlineMeetingUrl)}" style="color:${EMAIL_BRAND.primary};word-break:break-all;">미팅 링크</a>`
            : ""
        }`
      : `<strong>방식</strong> 오프라인${
          r.address
            ? ` · ${escapeHtml(r.address)}${r.addressDetail ? ` ${escapeHtml(r.addressDetail)}` : ""}`
            : ""
        }`;

    const update: {
      interviewerReminderSentAt?: string;
      candidateReminderSentAt?: string;
    } = {};
    const nowIso = new Date(now).toISOString();

    // 1) 면접관 리마인더 (미발송일 때만)
    if (!r.interviewerSentAt) {
      const interviewers = await getJobInterviewerEmails(r.jobId);
      for (const iv of interviewers) {
        const html = wrapEmailCard({
          innerHtml: `
            <h1 style="font-size:18px;margin:24px 0 8px;color:#0f172a;">${escapeHtml(iv.name)}님, 면접 일정 안내드립니다.</h1>
            <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
              담당 공고 <strong style="color:#0f172a;">${escapeHtml(r.jobTitle)}</strong> 의 ${roundLabel} 면접이
              <strong style="color:#0f172a;">약 24시간 후</strong> 진행될 예정입니다.
            </p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:14px;color:#0f172a;line-height:1.8;margin:0 0 20px;">
              <strong>후보자</strong> ${escapeHtml(r.candidateName)}<br>
              <strong>일시</strong> ${slotLabel}<br>
              ${locationRow}
            </div>
            <p style="font-size:12px;color:#64748b;margin:0;">일정에 맞춰 면접 준비를 부탁드립니다.</p>
          `,
          footer: "본 메일은 Intervia 시스템에서 자동 발송되었습니다.",
        });
        try {
          await sendMail({
            to: iv.email,
            subject: `[Intervia] 내일 ${roundLabel} 면접 안내 — ${r.candidateName} (${r.jobTitle})`,
            html,
            orgId: r.orgId,
            audience: "org",
          });
          interviewerRemindersSent++;
        } catch (e) {
          console.error(
            `[interview-reminders] interviewer mail failed (schedule=${r.scheduleId}, to=${iv.email}):`,
            e instanceof Error ? e.message : e
          );
        }
      }
      // 면접관이 없어도 처리 완료로 기록 — 다음 주기 재스캔 방지.
      update.interviewerReminderSentAt = nowIso;
    }

    // 2) 후보자 D-1 리마인더 (미발송일 때만) — 이메일 + 알림톡 병행.
    if (!r.candidateSentAt) {
      if (r.candidateEmail) {
        const html = wrapEmailCard({
          innerHtml: `
            <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">${escapeHtml(r.candidateName)}님, 내일 면접 안내드립니다.</h1>
            <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
              <strong style="color:#0f172a;">${escapeHtml(r.jobTitle)}</strong> ${roundLabel} 면접이
              <strong style="color:#0f172a;">약 24시간 후</strong> 진행될 예정입니다. 일정 확인 부탁드립니다.
            </p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:14px;color:#0f172a;line-height:1.8;margin:0 0 20px;">
              <strong>일시</strong> ${slotLabel}<br>
              ${locationRow}
            </div>
            <p style="font-size:12px;color:#64748b;margin:0;">
              부득이하게 참석이 어려우시면 채용 담당자에게 미리 연락 부탁드립니다.
            </p>
          `,
          footer: "본 메일은 채용 절차 안내를 위해 Intervia 시스템에서 자동 발송되었습니다.",
        });
        try {
          await sendMail({
            to: r.candidateEmail,
            subject: `[면접 안내] 내일 ${roundLabel} 면접이 예정되어 있습니다 — ${r.jobTitle}`,
            html,
            orgId: r.orgId,
            audience: "candidate",
          });
          candidateRemindersSent++;
        } catch (e) {
          console.error(
            `[interview-reminders] candidate mail failed (schedule=${r.scheduleId}):`,
            e instanceof Error ? e.message : e
          );
        }
      }
      // 알림톡 병행 (전화번호 있을 때만, 베스트에포트). 이메일과 독립.
      await sendCandidateAlimtalk("interview_day_reminder", {
        phone: r.candidatePhone,
        vars: {
          orgName: r.orgName,
          candidateName: r.candidateName,
          jobTitle: r.jobTitle,
          slotLabel,
        },
        fallbackText: `[${r.orgName ?? "채용"}] ${r.candidateName}님, ${r.jobTitle} 면접이 내일(${slotLabel}) 예정되어 있습니다.`,
      });
      // 이메일/알림톡이 없어도 처리 완료로 기록 — 다음 주기 재스캔 방지.
      update.candidateReminderSentAt = nowIso;
    }

    if (Object.keys(update).length > 0) {
      await db
        .update(interviewSchedules)
        .set(update)
        .where(eq(interviewSchedules.id, r.scheduleId));
      schedulesProcessed++;
    }
  }

  return { scanned: rows.length, interviewerRemindersSent, candidateRemindersSent, schedulesProcessed };
}

/**
 * AI 면접 미응답 리마인더 — 후보자.
 * 대상: status in (pending, in_progress) + 미만료 + 후보자 이메일 존재 +
 *       링크 발급(createdAt) 후 24h / 48h 경과 + 해당 tier 미발송.
 * 48h 가 먼저 due 면 24h 는 보내지 않고 함께 처리 완료로 기록(스팸 방지).
 */
export async function sendAiInterviewReminders(): Promise<{
  scanned: number;
  remindersSent: number;
  sessionsProcessed: number;
}> {
  const now = Date.now();

  const rows = await db
    .select({
      sessionId: interviewSessions.id,
      accessToken: interviewSessions.accessToken,
      expiresAt: interviewSessions.expiresAt,
      createdAt: interviewSessions.createdAt,
      reminder24SentAt: interviewSessions.reminder24SentAt,
      reminder48SentAt: interviewSessions.reminder48SentAt,
      candidateName: candidates.name,
      candidateEmail: candidates.email,
      candidatePhone: candidates.phone,
      orgId: candidates.orgId,
      candidateStage: candidates.stage,
      candidateOutcome: candidates.outcome,
      jobTitle: jobPostings.title,
      orgName: organizations.name,
    })
    .from(interviewSessions)
    .innerJoin(candidates, eq(candidates.id, interviewSessions.candidateId))
    .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .leftJoin(organizations, eq(organizations.id, candidates.orgId))
    .where(
      and(
        inArray(interviewSessions.status, ["pending", "in_progress"]),
        or(
          isNull(interviewSessions.reminder24SentAt),
          isNull(interviewSessions.reminder48SentAt)
        )
      )
    );

  const base = resolveBaseUrl();
  let remindersSent = 0;
  let sessionsProcessed = 0;

  for (const r of rows) {
    // 후보자가 AI 단계를 지났거나 종결됨 → 더 이상 AI 면접 넛지를 보내지 않는다.
    // (수동 단계 전진/종결은 pending 세션을 정리하지 않으므로 파생 판정으로 차단.
    //  링크가 무효화된 종결 후보에게 "응시하세요" 넛지가 나가는 모순도 함께 닫힌다.)
    if (
      isAiInterviewSuperseded({ stage: r.candidateStage, outcome: r.candidateOutcome })
    )
      continue;
    const createdMs = parseDbTimeMs(r.createdAt);
    const expiresMs = parseDbTimeMs(r.expiresAt);
    if (!Number.isFinite(createdMs)) continue;
    // 만료된 세션은 넛지 의미 없음 (status 가 아직 expired 로 안 바뀐 경우 대비 이중 가드).
    if (Number.isFinite(expiresMs) && expiresMs <= now) continue;

    const elapsed = now - createdMs;

    // tier 결정 — 48h 가 우선(스팸 방지: 24h+48h 동시 발송 X).
    let tier: 24 | 48 | null = null;
    if (elapsed >= H48_MS && !r.reminder48SentAt) tier = 48;
    else if (elapsed >= H24_MS && !r.reminder24SentAt) tier = 24;
    if (tier === null) continue;

    if (!(await isSmtpAvailable(r.orgId))) continue; // 설정 후 다음 주기 재시도

    const url = `${base}/interview/${r.accessToken}`;
    const expiresLabel = formatKstDateTime(r.expiresAt);

    if (r.candidateEmail) {
      const mail = buildInterviewReminderEmail({
        candidateName: r.candidateName,
        jobTitle: r.jobTitle,
        url,
        expiresAt: expiresLabel,
        orgName: null, // sendMail 이 orgId+audience=candidate 로 발신 표시이름에 법인명 주입
      });
      try {
        await sendMail({ to: r.candidateEmail, ...mail, orgId: r.orgId, audience: "candidate" });
        remindersSent++;
      } catch (e) {
        console.error(
          `[ai-interview-reminders] mail failed (session=${r.sessionId}):`,
          e instanceof Error ? e.message : e
        );
      }
    }

    // 알림톡 병행 (전화번호 있을 때만, 베스트에포트). 이메일과 독립.
    await sendCandidateAlimtalk("interview_reminder", {
      phone: r.candidatePhone,
      vars: {
        orgName: r.orgName,
        candidateName: r.candidateName,
        jobTitle: r.jobTitle,
        url,
        expiresAt: expiresLabel,
      },
      fallbackText: `[${r.orgName ?? "채용"}] ${r.candidateName}님, ${r.jobTitle} AI 면접이 아직 완료되지 않았습니다. 링크: ${url}`,
    });

    // 발송 여부와 무관하게 처리 완료로 기록 — 다음 주기 재스캔/중복 방지.
    // 48h tier 면 24h 도 함께 닫는다(이미 늦었으므로 24h 넛지는 무의미).
    const nowIso = new Date(now).toISOString();
    await db
      .update(interviewSessions)
      .set(
        tier === 48
          ? { reminder48SentAt: nowIso, ...(r.reminder24SentAt ? {} : { reminder24SentAt: nowIso }) }
          : { reminder24SentAt: nowIso }
      )
      .where(eq(interviewSessions.id, r.sessionId));
    sessionsProcessed++;
  }

  return { scanned: rows.length, remindersSent, sessionsProcessed };
}

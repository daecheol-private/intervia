/**
 * 면접관 일일 할 일 요약 메일 (daily digest).
 *
 * cron(`/api/cron/daily-digest`, 매일 KST 09:00 = UTC 00:00)이 호출.
 *
 * 면접관(job_interviewers 배정자)은 평소 서비스에 접속하지 않아 쌓인 면접·결정·검토를
 * 놓친다. 매일 아침 "본인이 면접관으로 배정된 공고"에 한해 오늘 할 일을 메일로 push 한다.
 *
 * 받는 사람: job_interviewers 에 배정된 active 사용자 전원(역할 무관). 각자 본인 배정 공고만.
 * 3블록:
 *   ① 오늘(KST) 진행할 확정 면접 — interview_schedules.status='selected' + 오늘 슬롯
 *   ② 결정 대기            — round1_waiting / round1_passed / round2_passed (outcome 미정)
 *   ③ 신규 지원·검토 대기  — applied / screened / ai_evaluated (outcome 미정)
 * 합계 0건이면 그 면접관에겐 보내지 않는다(빈 메일 방지).
 *
 * 멱등: (userId, digestDate) 를 daily_digest_logs 에 기록 — 같은 날 중복 실행 시 skip.
 * 운영 메일이라 토큰 차감 없음. SMTP 미설정이면 발송 skip(기록도 남기지 않아 다음 실행 재시도).
 */
import { db } from "./db";
import {
  jobInterviewers,
  users,
  candidates,
  jobPostings,
  interviewSchedules,
  dailyDigestLogs,
} from "./schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  sendMail,
  isSmtpAvailable,
  wrapEmailCard,
  escapeHtml,
  EMAIL_BRAND,
} from "./mailer";
import { formatSlotKst } from "./schedules";
import { roundLabel } from "./schedules";
import { STAGE_WAITER, isScheduleSuperseded, type Stage } from "./stage-meta";

/** "결정 대기"로 묶는 stage — 면접이 어느 정도 진행돼 합/불·다음 단계를 정해야 하는 단계. */
const DECISION_STAGES: Stage[] = ["round1_waiting", "round1_passed", "round2_passed"];
/** "신규 지원·검토 대기"로 묶는 stage — 면접 전 단계에서 검토·진행 결정이 필요한 단계. */
const REVIEW_STAGES: Stage[] = ["applied", "screened", "ai_evaluated"];

/** 메일 CTA 절대 base URL. APP_BASE_URL 우선, 미설정 시 dev=localhost:3003. */
function resolveBaseUrl(): string {
  const envBase = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (envBase) return envBase;
  return process.env.NODE_ENV === "production" ? "" : "http://localhost:3003";
}

/** Date → KST 기준 'YYYY-MM-DD' (en-CA 로케일이 이 형식을 보장). */
function kstDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

type DigestItem = { primary: string; secondary: string };

/**
 * 면접관 전원에게 일일 할 일 요약 메일 발송.
 * @returns sent=발송 통수, skipped=건너뛴 면접관 수(0건/이미발송/SMTP없음), recipients=대상 면접관 수.
 */
export async function sendDailyDigests(): Promise<{
  sent: number;
  skipped: number;
  recipients: number;
}> {
  const todayKst = kstDateStr(new Date());

  // 1) 면접관 배정 전부 → userId 로 그룹핑 (active + 이메일 보유자만).
  const assignments = await db
    .select({
      userId: jobInterviewers.userId,
      jobId: jobInterviewers.jobId,
      name: users.name,
      email: users.email,
      orgId: users.orgId,
      status: users.status,
    })
    .from(jobInterviewers)
    .innerJoin(users, eq(users.id, jobInterviewers.userId));

  const byUser = new Map<
    number,
    { name: string; email: string; orgId: number | null; jobIds: Set<number> }
  >();
  for (const a of assignments) {
    if (a.status !== "active" || !a.email) continue;
    let g = byUser.get(a.userId);
    if (!g) {
      g = { name: a.name, email: a.email, orgId: a.orgId, jobIds: new Set() };
      byUser.set(a.userId, g);
    }
    g.jobIds.add(a.jobId);
  }

  // 2) 오늘 이미 보낸 면접관 — 멱등.
  const sentRows = await db
    .select({ userId: dailyDigestLogs.userId })
    .from(dailyDigestLogs)
    .where(eq(dailyDigestLogs.digestDate, todayKst));
  const sentSet = new Set(sentRows.map((r) => r.userId));

  const base = resolveBaseUrl();
  let sent = 0;
  let skipped = 0;

  for (const [userId, g] of byUser) {
    if (sentSet.has(userId)) {
      skipped++;
      continue;
    }
    const jobIds = [...g.jobIds];
    if (jobIds.length === 0) {
      skipped++;
      continue;
    }

    // 블록① — 오늘(KST) 확정 면접. status='selected' 전체를 가져와 JS 에서 오늘·미종결 필터.
    const schedRows = await db
      .select({
        candidateId: interviewSchedules.candidateId,
        selectedSlot: interviewSchedules.selectedSlot,
        modeOnline: interviewSchedules.modeOnline,
        round: interviewSchedules.round,
        candidateName: candidates.name,
        candidateStage: candidates.stage,
        candidateOutcome: candidates.outcome,
        jobTitle: jobPostings.title,
      })
      .from(interviewSchedules)
      .innerJoin(candidates, eq(candidates.id, interviewSchedules.candidateId))
      .innerJoin(jobPostings, eq(jobPostings.id, interviewSchedules.jobId))
      .where(
        and(
          inArray(interviewSchedules.jobId, jobIds),
          eq(interviewSchedules.status, "selected")
        )
      );

    const todayInterviews: DigestItem[] = [];
    const todayCandidateIds = new Set<number>();
    for (const r of schedRows) {
      const start = r.selectedSlot?.start;
      if (!start || kstDateStr(new Date(start)) !== todayKst) continue;
      if (
        isScheduleSuperseded({
          stage: r.candidateStage,
          outcome: r.candidateOutcome,
          round: r.round,
        })
      )
        continue;
      todayCandidateIds.add(r.candidateId);
      todayInterviews.push({
        primary: `${r.candidateName} · ${r.jobTitle}`,
        secondary: `${roundLabel(r.round)} 면접 · ${formatSlotKst(
          r.selectedSlot!
        )} · ${r.modeOnline ? "온라인" : "오프라인"}`,
      });
    }

    // 블록② — 결정 대기. 블록①(오늘 면접)에 든 후보는 제외(중복 방지).
    const decisionRows = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        stage: candidates.stage,
        jobTitle: jobPostings.title,
      })
      .from(candidates)
      .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
      .where(
        and(
          inArray(candidates.jobId, jobIds),
          inArray(candidates.stage, DECISION_STAGES),
          isNull(candidates.outcome)
        )
      );
    const decisionPending: DigestItem[] = decisionRows
      .filter((r) => !todayCandidateIds.has(r.id))
      .map((r) => ({
        primary: `${r.name} · ${r.jobTitle}`,
        secondary: STAGE_WAITER[r.stage].label,
      }));

    // 블록③ — 신규 지원·검토 대기.
    const reviewRows = await db
      .select({
        name: candidates.name,
        stage: candidates.stage,
        jobTitle: jobPostings.title,
      })
      .from(candidates)
      .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
      .where(
        and(
          inArray(candidates.jobId, jobIds),
          inArray(candidates.stage, REVIEW_STAGES),
          isNull(candidates.outcome)
        )
      );
    const reviewPending: DigestItem[] = reviewRows.map((r) => ({
      primary: `${r.name} · ${r.jobTitle}`,
      secondary: STAGE_WAITER[r.stage].label,
    }));

    const total =
      todayInterviews.length + decisionPending.length + reviewPending.length;
    if (total === 0) {
      skipped++;
      continue;
    }

    // SMTP 미설정이면 기록 없이 skip — 설정 후 다음 실행(수동 재호출)에 재시도.
    if (!(await isSmtpAvailable(g.orgId))) {
      skipped++;
      continue;
    }

    const mail = buildDailyDigestEmail({
      name: g.name,
      dashboardUrl: `${base}/jobs`,
      todayInterviews,
      decisionPending,
      reviewPending,
    });

    try {
      await sendMail({
        to: g.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        orgId: g.orgId,
        audience: "org",
      });
    } catch (e) {
      console.error(
        `[daily-digest] mail failed (uid=${userId}):`,
        e instanceof Error ? e.message : e
      );
      skipped++;
      continue; // 기록하지 않음 → 같은 날 수동 재호출 시 재시도 가능.
    }

    // 멱등 기록 — unique(userId, digestDate) 충돌은 동시 실행 race 이므로 무시.
    try {
      await db.insert(dailyDigestLogs).values({ userId, digestDate: todayKst });
    } catch {
      /* already recorded by a concurrent run */
    }
    sent++;
  }

  return { sent, skipped, recipients: byUser.size };
}

/** 일일 할 일 요약 메일 빌더 — 3블록 카드. 비어 있는 블록은 생략한다. */
export function buildDailyDigestEmail(opts: {
  name: string;
  dashboardUrl: string;
  todayInterviews: DigestItem[];
  decisionPending: DigestItem[];
  reviewPending: DigestItem[];
}): { subject: string; html: string; text: string } {
  const { name, dashboardUrl, todayInterviews, decisionPending, reviewPending } =
    opts;

  const parts: string[] = [];
  if (todayInterviews.length) parts.push(`면접 ${todayInterviews.length}건`);
  if (decisionPending.length) parts.push(`결정 대기 ${decisionPending.length}건`);
  if (reviewPending.length) parts.push(`검토 대기 ${reviewPending.length}건`);
  const subject = `[Intervia] 오늘의 면접 할 일 — ${parts.join(" · ")}`;

  // --- text (plain fallback) ---
  const textSection = (title: string, items: DigestItem[]) =>
    items.length
      ? `\n[${title}] ${items.length}건\n` +
        items.map((it) => `· ${it.primary} — ${it.secondary}`).join("\n") +
        "\n"
      : "";
  const text = `${name}님, 오늘 처리하실 항목을 안내드립니다.
${textSection("오늘 진행할 면접", todayInterviews)}${textSection(
    "결정 대기",
    decisionPending
  )}${textSection("신규 지원·검토 대기", reviewPending)}
Intervia 에서 보기: ${dashboardUrl}

본 메일은 회원님이 면접관으로 배정된 공고에 한해 발송됩니다.`;

  // --- html ---
  const MAX = 8;
  const htmlSection = (title: string, accent: string, items: DigestItem[]) => {
    if (!items.length) return "";
    const shown = items.slice(0, MAX);
    const rest = items.length - shown.length;
    const lis = shown
      .map(
        (it) =>
          `<li style="padding:8px 0;border-bottom:1px solid #f1f5f9;list-style:none;">
            <span style="color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(
              it.primary
            )}</span><br>
            <span style="color:#64748b;font-size:12px;">${escapeHtml(
              it.secondary
            )}</span>
          </li>`
      )
      .join("");
    const more =
      rest > 0
        ? `<li style="padding:8px 0;list-style:none;color:#94a3b8;font-size:12px;">외 ${rest}건 더 있습니다.</li>`
        : "";
    return `
      <div style="margin:0 0 20px;">
        <div style="display:flex;align-items:center;margin:0 0 4px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${accent};margin-right:8px;"></span>
          <span style="font-size:13px;font-weight:700;color:#0f172a;">${title}</span>
          <span style="margin-left:8px;display:inline-block;background:${accent};color:#fff;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;">${items.length}</span>
        </div>
        <ul style="margin:8px 0 0;padding:0;">${lis}${more}</ul>
      </div>`;
  };

  const html = wrapEmailCard({
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 4px;color:#0f172a;">${escapeHtml(
        name
      )}님, 오늘의 할 일입니다.</h1>
      <p style="color:#475569;line-height:1.6;margin:0 0 24px;font-size:14px;">
        회원님이 면접관으로 배정된 공고에서 처리가 필요한 항목을 모았습니다.
      </p>
      ${htmlSection("오늘 진행할 면접", EMAIL_BRAND.primary, todayInterviews)}
      ${htmlSection("합격/불합격 결정 대기", "#b45309", decisionPending)}
      ${htmlSection("신규 지원·검토 대기", "#0f766e", reviewPending)}
      <p style="text-align:center;margin:28px 0 8px;">
        <a href="${dashboardUrl}" style="display:inline-block;background:${
          EMAIL_BRAND.primary
        };color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">Intervia에서 확인하기</a>
      </p>
    `,
    footer:
      "본 메일은 회원님이 면접관으로 배정된 공고에 한해 Intervia 시스템에서 매일 아침 자동 발송됩니다.",
  });

  return { subject, html, text };
}

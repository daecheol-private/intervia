/**
 * 면접관 일일 할 일 요약 메일 (daily digest).
 *
 * cron(`/api/cron/daily-digest`, 매일 KST 09:00 = UTC 00:00)이 호출.
 *
 * 면접관(job_interviewers 배정자)은 평소 서비스에 접속하지 않아 쌓인 면접·결정·검토를
 * 놓친다. 매일 아침 "본인이 면접관으로 배정된 공고"에 한해 오늘 할 일을 메일로 push 한다.
 *
 * 받는 사람: job_interviewers 에 배정된 active 사용자 전원(역할 무관). 각자 본인 배정 공고만.
 * 4블록:
 *   ① 오늘(KST) 진행할 확정 면접 — interview_schedules.status='selected' + 오늘 슬롯
 *   ② 결정·조치 대기       — 면접 단계(round1_waiting/round1_passed/round2_passed, outcome 미정)
 *      중 deriveCandidateState 로 판정한 대기주체가 hr 인 후보만. 확정된 면접(대기주체
 *      interviewer)·지원자 일정 응답 대기(candidate)는 제외 — D-1 리마인더 + 당일 블록①이 커버.
 *   ③ 신규 지원·검토 대기  — applied / screened / ai_evaluated (outcome 미정)
 *   ④ 자동 종결            — 링크 만료 자동 불합격(outcomeReason 기반), 신규 창 내 발생분.
 *      expire cron(24시간 가동)의 개별 알림 메일을 대체한다 — 야간·주말 메일 소스 제거.
 * 합계 0건이면 그 면접관에겐 보내지 않는다(빈 메일 방지).
 *
 * 변동 중심 발송(2026-07-15): 24h 내 변동(updated_at) 항목을 '신규'로 판정해 블록 상단
 * 정렬 + NEW 배지 + 제목에 건수 표기. "오늘 면접 0 + 신규 0"이면 발송을 스킵해 같은
 * 목록이 매일 반복되는 소음을 막는다 — 단 월요일(KST)은 변동이 없어도 전체 목록을
 * 발송(장기 미처리 항목이 묻히지 않게 하는 주간 앵커).
 *
 * 주말(토·일 KST)은 그날 진행할 확정 면접이 있는 면접관에게만 발송 — 그 외 주말 변동은
 * 월요일 앵커가 흡수한다(월요일의 '신규' 창을 72h 로 넓혀 금요일 digest 이후 변동이
 * 전부 NEW 로 표시됨). 판정 규칙은 shouldSendDigest 참조.
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
import { deriveCandidateState, type ScheduleStatus } from "./candidate-state";

/**
 * 블록② 후보군 stage — 여기서 다시 파생 판정(deriveCandidateState)으로 걸러진다.
 *
 * ⚠️ stage 만으로는 판정할 수 없다: 2차는 확정돼도 stage 가 round1_passed 로 유지되고
 * round2 스케줄 row 로만 진행된다(B-1 설계). stage 만 보면 8/5 면접이 확정된 후보도
 * "2차 진행 결정 대기"로 매일 나간다 — 실제 발생한 오발송. 확정·응답대기 스케줄이
 * 있으면 결정은 이미 내려진 것이므로, 대시보드·퍼널과 같은 파생 규칙으로 대기주체가
 * hr 인 후보만 남긴다.
 *
 * round1_waiting 을 포함하는 이유: 면접 전(r1_scheduled)은 waiter=interviewer 라
 * 자동 제외되고, 면접 시각이 지났는데 결과 미입력(r1_result_due)만 hr 로 걸린다.
 * 면접 전 반복 발송(소음)은 막으면서 결과 입력 누락은 잡는다.
 */
const DECISION_STAGES: Stage[] = [
  "round1_waiting",
  "round1_passed",
  "round2_passed",
];
/** "신규 지원·검토 대기"로 묶는 stage — 면접 전 단계에서 검토·진행 결정이 필요한 단계. */
const REVIEW_STAGES: Stage[] = ["applied", "screened", "ai_evaluated"];

/** "자동 종결" 블록의 outcomeReason — expire cron 이 자동 불합격 처리한 사유(수동 결정 제외). */
const AUTO_CLOSE_REASONS = ["ai_link_expired", "schedule_link_expired"] as const;
const AUTO_CLOSE_LABEL: Record<string, string> = {
  ai_link_expired: "AI면접 링크 만료 (응시 기한 경과)",
  schedule_link_expired: "1차 면접 일정 링크 만료",
};

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

/**
 * DB 시각 → epoch ms.
 * ISO('T' 포함)면 그대로, SQLite CURRENT_TIMESTAMP('YYYY-MM-DD HH:MM:SS', UTC)면 UTC 로 해석.
 */
function parseDbTimeMs(s: string | null | undefined): number {
  if (!s) return NaN;
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  return Date.parse(iso);
}

type DigestItem = { primary: string; secondary: string; isNew?: boolean };

/**
 * digest 발송 판정 (순수 — 테스트 용이).
 * 주말: 그날 진행할 확정 면접이 있는 사람에게만 — 그 외 변동은 월요일 앵커로 이월.
 * 월요일: 할 일이 있으면 무조건(주간 전체 앵커).
 * 평일: 오늘 면접 또는 신규 변동이 있을 때만(동일 목록 반복 방지).
 */
export function shouldSendDigest(p: {
  isWeekend: boolean;
  isMonday: boolean;
  todayCount: number;
  newCount: number;
  total: number;
}): boolean {
  if (p.total === 0) return false;
  if (p.isWeekend) return p.todayCount > 0;
  if (p.isMonday) return true;
  return p.todayCount > 0 || p.newCount > 0;
}

/** 신규 항목을 앞으로 (sort 는 stable — 그 외 기존 순서 유지). */
function sortNewFirst(items: DigestItem[]): void {
  items.sort((a, b) => Number(b.isNew ?? false) - Number(a.isNew ?? false));
}

/**
 * 면접관 전원에게 일일 할 일 요약 메일 발송.
 * @returns sent=발송 통수, skipped=건너뛴 면접관 수(0건/이미발송/SMTP없음), recipients=대상 면접관 수.
 */
export async function sendDailyDigests(): Promise<{
  sent: number;
  skipped: number;
  recipients: number;
}> {
  const now = Date.now();
  const todayKst = kstDateStr(new Date(now));
  const weekdayKst = new Date(now).toLocaleDateString("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  });
  const isMondayKst = weekdayKst === "Mon";
  const isWeekendKst = weekdayKst === "Sat" || weekdayKst === "Sun";
  // '신규' 판정 기준 — 직전 발송 digest 이후 변동. 평일은 24h(매일 09:00 cron),
  // 월요일은 주말 스킵분까지 커버하도록 72h(금요일 digest 이후).
  const newSinceMs = now - (isMondayKst ? 72 : 24) * 60 * 60 * 1000;

  // 1) 면접관 배정 전부 → userId 로 그룹핑 (active + 이메일 보유자만).
  const assignments = await db
    .select({
      userId: jobInterviewers.userId,
      jobId: jobInterviewers.jobId,
      name: users.name,
      email: users.email,
      orgId: users.orgId,
      status: users.status,
      digestOptOutAt: users.dailyDigestOptOutAt,
    })
    .from(jobInterviewers)
    .innerJoin(users, eq(users.id, jobInterviewers.userId));

  const byUser = new Map<
    number,
    { name: string; email: string; orgId: number | null; jobIds: Set<number> }
  >();
  for (const a of assignments) {
    // 비활성·이메일 없음, 그리고 본인이 요약 메일을 끈 경우(계정 설정 opt-out) 제외.
    if (a.status !== "active" || !a.email || a.digestOptOutAt != null) continue;
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

    // 활성 스케줄 전체(제시·역제시·확정) — 블록①(오늘 면접)과 블록②(파생 판정) 공용.
    const schedRows = await db
      .select({
        id: interviewSchedules.id,
        candidateId: interviewSchedules.candidateId,
        status: interviewSchedules.status,
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
          inArray(interviewSchedules.status, [
            "pending",
            "counter_proposed",
            "selected",
          ])
        )
      );

    // 후보·차수별 최신 활성 스케줄 — 재제시는 새 row 를 추가하므로 id 가 큰 쪽이 최신.
    const latestSched = new Map<
      string,
      { id: number; status: ScheduleStatus; end: string | null }
    >();
    for (const r of schedRows) {
      const key = `${r.candidateId}:${r.round}`;
      const prev = latestSched.get(key);
      if (prev && prev.id >= r.id) continue;
      latestSched.set(key, {
        id: r.id,
        status: r.status as ScheduleStatus,
        end: r.selectedSlot?.end ?? null,
      });
    }

    // 블록① — 오늘(KST) 확정 면접.
    const todayInterviews: DigestItem[] = [];
    const todayCandidateIds = new Set<number>();
    for (const r of schedRows) {
      if (r.status !== "selected") continue;
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
        updatedAt: candidates.updatedAt,
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
    const decisionPending: DigestItem[] = [];
    for (const r of decisionRows) {
      if (todayCandidateIds.has(r.id)) continue;
      const r1 = latestSched.get(`${r.id}:round1`);
      const r2 = latestSched.get(`${r.id}:round2`);
      // 대기주체가 hr 일 때만 — 면접 확정(interviewer)·지원자 응답 대기(candidate)는 제외.
      const state = deriveCandidateState(
        {
          stage: r.stage,
          outcome: null, // 쿼리에서 outcome IS NULL 로 이미 걸렀다
          round1ScheduleStatus: r1?.status ?? null,
          round1SelectedEnd: r1?.end ?? null,
          round2ScheduleStatus: r2?.status ?? null,
          round2SelectedEnd: r2?.end ?? null,
        },
        now
      );
      if (state.waiter !== "hr") continue;
      decisionPending.push({
        primary: `${r.name} · ${r.jobTitle}`,
        secondary: state.label,
        isNew: parseDbTimeMs(r.updatedAt) >= newSinceMs,
      });
    }
    sortNewFirst(decisionPending);

    // 블록③ — 신규 지원·검토 대기.
    const reviewRows = await db
      .select({
        name: candidates.name,
        stage: candidates.stage,
        jobTitle: jobPostings.title,
        updatedAt: candidates.updatedAt,
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
      isNew: parseDbTimeMs(r.updatedAt) >= newSinceMs,
    }));
    sortNewFirst(reviewPending);

    // 블록④ — 자동 종결(링크 만료). 신규 창 내 발생분만 — 창 밖은 이미 이전 digest 가 안내함.
    const autoClosedRows = await db
      .select({
        name: candidates.name,
        reason: candidates.outcomeReason,
        decidedAt: candidates.decidedAt,
        jobTitle: jobPostings.title,
      })
      .from(candidates)
      .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
      .where(
        and(
          inArray(candidates.jobId, jobIds),
          eq(candidates.outcome, "rejected"),
          inArray(candidates.outcomeReason, [...AUTO_CLOSE_REASONS])
        )
      );
    const autoClosed: DigestItem[] = autoClosedRows
      .filter((r) => parseDbTimeMs(r.decidedAt) >= newSinceMs)
      .map((r) => ({
        primary: `${r.name} · ${r.jobTitle}`,
        secondary: AUTO_CLOSE_LABEL[r.reason ?? ""] ?? r.reason ?? "링크 만료",
      }));

    const total =
      todayInterviews.length +
      decisionPending.length +
      reviewPending.length +
      autoClosed.length;
    const newCount =
      decisionPending.filter((it) => it.isNew).length +
      reviewPending.filter((it) => it.isNew).length;
    if (
      !shouldSendDigest({
        isWeekend: isWeekendKst,
        isMonday: isMondayKst,
        todayCount: todayInterviews.length,
        // 자동 종결은 창 내 새 이벤트 — 다른 변동이 없어도 발송 사유가 된다.
        newCount: newCount + autoClosed.length,
        total,
      })
    ) {
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
      autoClosed,
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

/** 일일 할 일 요약 메일 빌더 — 4블록 카드. 비어 있는 블록은 생략한다. */
export function buildDailyDigestEmail(opts: {
  name: string;
  dashboardUrl: string;
  todayInterviews: DigestItem[];
  decisionPending: DigestItem[];
  reviewPending: DigestItem[];
  autoClosed?: DigestItem[];
}): { subject: string; html: string; text: string } {
  const { name, dashboardUrl, todayInterviews, decisionPending, reviewPending } =
    opts;
  const autoClosed = opts.autoClosed ?? [];

  const parts: string[] = [];
  if (todayInterviews.length) parts.push(`면접 ${todayInterviews.length}건`);
  if (decisionPending.length) parts.push(`결정 대기 ${decisionPending.length}건`);
  if (reviewPending.length) parts.push(`검토 대기 ${reviewPending.length}건`);
  if (autoClosed.length) parts.push(`자동 종결 ${autoClosed.length}건`);
  const newCount = [...decisionPending, ...reviewPending].filter(
    (it) => it.isNew
  ).length;
  const subject = `[Intervia] 오늘의 면접 할 일 — ${parts.join(" · ")}${
    newCount ? ` (신규 ${newCount}건)` : ""
  }`;

  // --- text (plain fallback) ---
  const textSection = (title: string, items: DigestItem[]) =>
    items.length
      ? `\n[${title}] ${items.length}건\n` +
        items
          .map((it) => `· ${it.isNew ? "[신규] " : ""}${it.primary} — ${it.secondary}`)
          .join("\n") +
        "\n"
      : "";
  const autoClosedTextNote = autoClosed.length
    ? "※ 자동 종결은 링크 만료(응시 기한 경과)에 따른 처리이며 AI 평가 결과에 따른 결정이 아닙니다.\n"
    : "";
  const text = `${name}님, 오늘 처리하실 항목을 안내드립니다.
${textSection("오늘 진행할 면접", todayInterviews)}${textSection(
    "결정·조치 대기",
    decisionPending
  )}${textSection("신규 지원·검토 대기", reviewPending)}${textSection(
    "자동 종결 (링크 만료)",
    autoClosed
  )}${autoClosedTextNote}
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
            ${
              it.isNew
                ? `<span style="display:inline-block;background:#ffe9df;color:#9a3412;font-size:10px;font-weight:700;border-radius:4px;padding:1px 6px;margin-right:6px;vertical-align:1px;">NEW</span>`
                : ""
            }<span style="color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(
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
      ${htmlSection("결정·조치 대기", "#b45309", decisionPending)}
      ${htmlSection("신규 지원·검토 대기", "#0f766e", reviewPending)}
      ${htmlSection("자동 종결 (링크 만료)", "#64748b", autoClosed)}
      ${
        autoClosed.length
          ? `<p style="font-size:11px;color:#94a3b8;margin:-12px 0 20px;">링크 만료(응시 기한 경과)에 따른 자동 처리이며 AI 평가 결과에 따른 결정이 아닙니다.</p>`
          : ""
      }
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

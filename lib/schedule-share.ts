/**
 * 면접 일정 공유 수신자 — 면접관이 아닌 사람에게 일정 확정·변경·취소를 알린다.
 *
 * 왜: 회의실을 잡는 인사팀 담당자나, Intervia 계정이 없는 임원(2차 면접관)은
 * job_interviewers 에 없어서 기존 확정 메일을 받지 못한다. 일정 제시 시점에
 * 공유받을 사람을 선택(법인 멤버) 또는 직접 입력(외부 주소)해 두면 이 모듈이 발송한다.
 *
 * 발송 시점 3가지:
 *   confirmed   — 일정 확정 (지원자 선택 / HR 확정 / 수동 확정 / 미팅 링크 등록)
 *   rescheduled — 확정본을 변경 재제시해 기존 일정이 무효가 됨 (새 시간은 미정)
 *   cancelled   — 지원자 철회로 일정 자체가 사라짐
 *
 * 본문에는 후보자 이름·공고·일시·장소만 담는다. 연락처·이력서는 넣지 않는다 —
 * 외부 주소 오타 시 유출 범위를 최소화하기 위한 의도적 제한.
 * 예외는 평가 리포트 링크(recipient.report) — 제시자가 수신자별로 명시 선택했을 때만
 * 확정·변경 안내에 읽기 전용 공유 링크를 덧붙인다(취소 안내에는 넣지 않는다).
 */
import { db } from "./db";
import {
  candidates,
  jobPostings,
  organizations,
  users,
  interviewSchedules,
  type InterviewSchedule,
} from "./schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { sendMail, isSmtpAvailable } from "./mailer";
import { buildScheduleShareEmail, buildIcsInvite, roundLabel, type Slot } from "./schedules";
import { resolveMailBaseUrl } from "./notifications";
import { ensureActiveShareLink, SHARE_LINK_DEFAULT_DAYS } from "./shared-report";
import { addDays } from "./utils";
import { logAudit } from "./audit";

export type ShareRecipient = {
  email: string;
  name?: string;
  /** 법인 멤버로 선택된 경우만 — 발송 시점에 최신 이메일을 다시 조회한다. */
  userId?: number;
  /**
   * 확정·변경 안내에 평가 리포트 공유 링크(/shared/[token])를 함께 보낼지.
   * 별도 컬럼 대신 수신자 스냅샷에 얹는다 — 마이그레이션 없이 확정 4경로 전체에
   * 자동 반영되고, 나중에 수신자별로 갈라 줄 여지도 남는다.
   */
  report?: boolean;
};

/** 확정 1건당 추가 발송량 상한 — 메일 일일 예산 보호 + 오발송 시 유출 범위 제한. */
export const MAX_SHARE_RECIPIENTS = 10;

/** 최소 형식 검증 — 로컬@도메인.tld, 공백 없음. */
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/**
 * 클라이언트 입력 정규화 — 소문자·중복 제거·상한 검사.
 * 빈 배열/미입력은 정상(선택 기능)이라 ok:true + 빈 목록으로 돌려준다.
 */
export function normalizeShareRecipients(
  input: unknown
): { ok: true; list: ShareRecipient[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, list: [] };
  if (!Array.isArray(input))
    return { ok: false, error: "공유 수신자 형식이 올바르지 않습니다." };

  const out: ShareRecipient[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const email =
      typeof raw === "string"
        ? raw
        : typeof (raw as ShareRecipient)?.email === "string"
          ? (raw as ShareRecipient).email
          : null;
    if (!email) return { ok: false, error: "공유 수신자 형식이 올바르지 않습니다." };
    const normalized = email.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.length > 200 || !isValidEmail(normalized))
      return { ok: false, error: `이메일 형식이 올바르지 않습니다: ${email}` };
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const name =
      typeof raw === "object" && typeof (raw as ShareRecipient).name === "string"
        ? (raw as ShareRecipient).name!.trim().slice(0, 100) || undefined
        : undefined;
    const userIdRaw =
      typeof raw === "object" ? (raw as ShareRecipient).userId : undefined;
    const userId =
      typeof userIdRaw === "number" && Number.isInteger(userIdRaw) && userIdRaw > 0
        ? userIdRaw
        : undefined;
    // 평가 열람은 명시 opt-in — true 가 아닌 값(문자열 "true" 포함)은 전부 미포함 처리.
    const report =
      typeof raw === "object" && (raw as ShareRecipient).report === true
        ? true
        : undefined;
    out.push({ email: normalized, name, userId, report });
  }
  if (out.length > MAX_SHARE_RECIPIENTS)
    return {
      ok: false,
      error: `공유 수신자는 최대 ${MAX_SHARE_RECIPIENTS}명까지 지정할 수 있습니다.`,
    };
  return { ok: true, list: out };
}

type SchedForShare = Pick<
  InterviewSchedule,
  | "id"
  | "candidateId"
  | "jobId"
  | "orgId"
  | "round"
  | "modeOnline"
  | "address"
  | "addressDetail"
  | "shareRecipients"
>;

/**
 * 공유 수신자 전원에게 일정 안내 발송. 수신자가 없으면 아무것도 하지 않는다.
 * 개별 실패는 격리 — 한 명 실패가 나머지 발송을 막지 않는다.
 * @param excludeEmails 이미 다른 경로로 같은 내용을 받은 주소(면접관·후보자) — 중복 방지.
 */
export async function sendScheduleShareEmails(opts: {
  sched: SchedForShare;
  slot: Slot;
  kind: "confirmed" | "rescheduled" | "cancelled";
  meetingUrl?: string | null;
  pendingMeetingLink?: boolean;
  cancelReason?: string | null;
  excludeEmails?: Iterable<string>;
}): Promise<{ sent: number; skipped: number }> {
  const { sched, slot, kind } = opts;
  const list = sched.shareRecipients ?? [];
  if (list.length === 0) return { sent: 0, skipped: 0 };
  if (!(await isSmtpAvailable(sched.orgId))) return { sent: 0, skipped: list.length };

  // 법인 멤버로 선택된 수신자는 발송 시점의 최신 이메일을 쓴다 — 주소 변경·비활성 대응.
  const memberIds = list.map((r) => r.userId).filter((v): v is number => v != null);
  const memberById = new Map<number, { email: string; status: string }>();
  if (memberIds.length > 0) {
    const rows = await db
      .select({ id: users.id, email: users.email, status: users.status })
      .from(users)
      .where(inArray(users.id, memberIds));
    for (const r of rows) memberById.set(r.id, { email: r.email, status: r.status });
  }

  const [cand] = await db
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  const [job] = await db
    .select({ title: jobPostings.title })
    .from(jobPostings)
    .where(eq(jobPostings.id, sched.jobId));
  const org = sched.orgId
    ? (
        await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, sched.orgId))
      )[0]
    : null;

  const candName = cand?.name ?? "후보자";
  const jobTitle = job?.title ?? "공고";
  const orgName = org?.name ?? "법인";
  const rl = roundLabel(sched.round);
  const detailUrl = `${resolveMailBaseUrl()}/candidates/${sched.candidateId}`;

  // 취소 안내에는 캘린더 첨부를 넣지 않는다 — METHOD:CANCEL 동작이 클라이언트마다 달라
  // 잘못된 이벤트를 새로 만들 수 있다. 본문으로만 알린다.
  const ics =
    kind === "cancelled"
      ? null
      : buildIcsInvite({
          uid: `intervia-sched-${sched.id}@intervia`,
          slot,
          title: `[${orgName}] ${jobTitle} ${rl} 면접 (${candName})`,
          description: `${candName} 님 ${rl} 면접${opts.meetingUrl ? `\n미팅: ${opts.meetingUrl}` : ""}`,
          location: sched.modeOnline
            ? (opts.meetingUrl ?? "온라인")
            : [sched.address, sched.addressDetail].filter(Boolean).join(" ") || "미정",
        });

  // 평가 리포트 링크 — 수신자 중 명시 선택이 있고, 취소 안내가 아닐 때만.
  // 후보자당 활성 링크 1개를 재사용한다(수동 발급분 포함) — 새로 발급하면 먼저 링크를
  // 받은 사람이 끊긴다. 면접 뒤에 나오는 평가를 열람해야 하므로 만료 하한은 면접일 이후.
  let reportUrl: string | null = null;
  let reportExpiresAt: string | null = null;
  if (kind !== "cancelled" && list.some((r) => r.report)) {
    try {
      const link = await ensureActiveShareLink({
        candidateId: sched.candidateId,
        orgId: sched.orgId,
        minValidUntil: addDays(new Date(slot.start), SHARE_LINK_DEFAULT_DAYS),
      });
      reportUrl = `${resolveMailBaseUrl()}/shared/${link.token}`;
      reportExpiresAt = link.expiresAt;
      if (link.created)
        logAudit(null, {
          actorRole: "system",
          action: "shared_report.create",
          resourceType: "candidate",
          resourceId: sched.candidateId,
          orgId: sched.orgId,
          jobId: sched.jobId,
          metadata: {
            trigger: "schedule_share",
            scheduleId: sched.id,
            recipients: list.filter((r) => r.report).map((r) => r.email),
          },
        });
    } catch (e) {
      // 링크 발급 실패가 일정 안내 자체를 막지는 않는다 — 일정 통지가 더 시급하다.
      console.error(
        "[schedule-share] 평가 공유 링크 발급 실패",
        e instanceof Error ? e.message : e
      );
    }
  }

  const excluded = new Set(
    [...(opts.excludeEmails ?? [])].map((e) => e.trim().toLowerCase())
  );

  let sent = 0;
  let skipped = 0;
  for (const r of list) {
    // 멤버 선택분: 비활성 계정이면 발송하지 않는다(퇴사자 등).
    let to = r.email;
    if (r.userId != null) {
      const m = memberById.get(r.userId);
      if (!m || m.status !== "active") {
        skipped++;
        continue;
      }
      to = m.email.toLowerCase();
    }
    if (excluded.has(to)) {
      skipped++;
      continue;
    }
    excluded.add(to); // 목록 내 중복(멤버 최신주소가 직접입력분과 겹치는 경우)도 1통만.

    try {
      const mail = buildScheduleShareEmail({
        candidateName: candName,
        jobTitle,
        orgName,
        slot,
        kind,
        modeOnline: sched.modeOnline,
        address: sched.address,
        addressDetail: sched.addressDetail,
        meetingUrl: opts.meetingUrl ?? null,
        pendingMeetingLink: opts.pendingMeetingLink,
        cancelReason: opts.cancelReason ?? null,
        // 미가입 외부 수신자에게는 링크를 주지 않는다 — 로그인 벽에 막힌다.
        detailUrl: r.userId != null ? detailUrl : null,
        // 평가 링크는 지정된 수신자에게만 — 같은 목록 안에서도 사람마다 갈린다.
        reportUrl: r.report ? reportUrl : null,
        reportExpiresAt: r.report ? reportExpiresAt : null,
        round: sched.round,
      });
      await sendMail({
        to,
        ...mail,
        orgId: sched.orgId,
        audience: "org",
        kind: `schedule_share_${kind}`,
        attachments: ics
          ? [
              {
                filename: "interview.ics",
                content: ics,
                contentType: "text/calendar; charset=utf-8; method=REQUEST",
              },
            ]
          : undefined,
      });
      sent++;
    } catch (e) {
      skipped++;
      console.error(
        "[schedule-share] 공유 메일 실패",
        e instanceof Error ? e.message : e
      );
    }
  }
  return { sent, skipped };
}

/** 종결 사유(outcome) → 공유 수신자에게 보여줄 취소 사유 문구. */
const CANCEL_REASON_BY_OUTCOME: Record<string, string> = {
  rejected: "후보자가 불합격 처리되어 면접이 취소되었습니다.",
  withdrawn: "지원자가 지원을 취소했습니다.",
  hired: "채용이 확정되어 예정된 면접이 취소되었습니다.",
};

/**
 * 후보자가 종결(합격·불합격·지원취소)될 때, 아직 치르지 않은 확정 면접의 공유 수신자에게
 * 취소를 알린다. 회의실을 잡아둔 담당자가 취소를 모르면 빈 예약이 남는다.
 *
 * 이미 지난 면접은 건드리지 않는다 — 취소할 것이 없다.
 * 공유 수신자가 지정되지 않은 스케쥴은 쿼리 단계에서 빠지므로 대부분의 후보자에게 no-op.
 */
export async function notifyShareCancelOnCandidateClosed(
  candidateId: number,
  outcome: string | null | undefined
): Promise<{ notified: number }> {
  const rows = await db
    .select()
    .from(interviewSchedules)
    .where(
      and(
        eq(interviewSchedules.candidateId, candidateId),
        eq(interviewSchedules.status, "selected"),
        isNotNull(interviewSchedules.shareRecipients)
      )
    );
  if (rows.length === 0) return { notified: 0 };

  const reason =
    CANCEL_REASON_BY_OUTCOME[outcome ?? ""] ?? "면접이 취소되었습니다.";
  const now = Date.now();
  let notified = 0;
  for (const sched of rows) {
    const start = sched.selectedSlot?.start;
    if (!start || new Date(start).getTime() <= now) continue; // 이미 치른 면접
    try {
      const r = await sendScheduleShareEmails({
        sched,
        slot: sched.selectedSlot!,
        kind: "cancelled",
        cancelReason: reason,
      });
      notified += r.sent;
    } catch (e) {
      console.error(
        "[schedule-share] 종결 취소 통지 실패",
        e instanceof Error ? e.message : e
      );
    }
  }
  return { notified };
}

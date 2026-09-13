/**
 * 면접 일정 확정·취소 알림톡 — 알림 받을 면접관(일정별 선택) + 일정 공유받을 사람.
 *
 * 받는 사람 = interview_schedules.notifyUserIds(null 이면 공고 면접관 전원) ∪ shareRecipients.
 * 그중 notify_phones 에서 본인이 확인(verified)한 번호가 있는 사람에게만 보낸다.
 * 메일 발송(schedule-notify·schedule-share)과 독립 — 메일 서버 설정이 없어도 나간다.
 *
 * 확정 안내의 "지원자 정보 보기" 버튼은 카카오 템플릿 특성상 수신자마다 뺄 수 없어서, 수신자별
 * 서명 링크(/shared/view/[token]) 하나로 두고 누른 사람에 따라 보낸다 — 가입자는 후보자 상세
 * (로그인), 평가 리포트 공유가 허용된 비회원은 평가 리포트, 그 외 비회원은 일정 정보만.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  candidates,
  jobInterviewers,
  jobPostings,
  organizations,
  users,
  type InterviewSchedule,
} from "./schema";
import { sendStaffAlimtalk, type StaffAlimtalkVars } from "./alimtalk";
import { findVerifiedPhones } from "./notify-phone";
import { formatSlotKst, roundLabel, type Slot } from "./schedules";
import { maskPersonName } from "./email-domain";
import { resolveMailBaseUrl } from "./notifications";
import { SHARE_LINK_DEFAULT_DAYS } from "./shared-report";
import { addDays } from "./utils";

export type SchedForStaff = Pick<
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
  | "notifyUserIds"
>;

export type StaffRecipient =
  | { kind: "user"; userId: number; name: string }
  | { kind: "external"; email: string; name: string | null; report: boolean };

/** 카카오 본문의 취소 사유 — 잠금화면 미리보기에 합불 결과가 드러나지 않게 중립 문구만 쓴다. */
export const STAFF_CANCEL_REASON = {
  withdrawn: "지원자가 지원을 취소했습니다",
  rescheduled: "일정이 변경되었습니다. 새 일정이 확정되면 다시 안내드립니다",
  closed: "전형이 종료되었습니다",
} as const;

/**
 * 이 일정의 알림 대상 — 선택된 공고 면접관(비활성 제외) + 일정 공유받을 사람.
 * 같은 사람이 두 목록에 다 있으면 한 번만.
 */
export async function resolveScheduleRecipients(
  sched: SchedForStaff,
  excludeUserIds: number[] = []
): Promise<StaffRecipient[]> {
  const exclude = new Set(excludeUserIds);
  const selected = sched.notifyUserIds ? new Set(sched.notifyUserIds) : null;
  const out: StaffRecipient[] = [];
  const seenUsers = new Set<number>();
  const seenEmails = new Set<string>();

  const interviewers = await db
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(jobInterviewers)
    .innerJoin(users, eq(users.id, jobInterviewers.userId))
    .where(and(eq(jobInterviewers.jobId, sched.jobId), eq(users.status, "active")));
  for (const iv of interviewers) {
    if (selected && !selected.has(iv.userId)) continue;
    if (exclude.has(iv.userId) || seenUsers.has(iv.userId)) continue;
    seenUsers.add(iv.userId);
    seenEmails.add(iv.email.toLowerCase());
    out.push({ kind: "user", userId: iv.userId, name: iv.name });
  }

  const share = sched.shareRecipients ?? [];
  const memberIds = share.map((r) => r.userId).filter((v): v is number => v != null);
  const members =
    memberIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email, status: users.status })
          .from(users)
          .where(inArray(users.id, memberIds))
      : [];
  const memberById = new Map(members.map((m) => [m.id, m]));
  for (const r of share) {
    if (r.userId != null) {
      const m = memberById.get(r.userId);
      if (!m || m.status !== "active" || exclude.has(m.id) || seenUsers.has(m.id)) continue;
      seenUsers.add(m.id);
      seenEmails.add(m.email.toLowerCase());
      out.push({ kind: "user", userId: m.id, name: m.name });
      continue;
    }
    const email = r.email.trim().toLowerCase();
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    out.push({ kind: "external", email, name: r.name ?? null, report: r.report === true });
  }
  return out;
}

// ─── "지원자 정보 보기" 서명 링크 ─────────────────────────────────────────────

function viewKey(): Buffer | null {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  return hex ? Buffer.from(hex, "hex") : null;
}

/** 링크에 이메일을 그대로 싣지 않기 위한 참조값 — 열람 시 수신자 목록에서 다시 계산해 대조한다. */
export function emailRef(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("base64url")
    .slice(0, 16);
}

function signView(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(`staff-view:${payload}`).digest("base64url");
}

/** `{scheduleId}.{u<userId>|e<emailRef>}.{만료 epoch초}.{서명}` — DB 저장 없이 위변조만 막는다. */
export function issueStaffViewToken(
  scheduleId: number,
  r: StaffRecipient,
  expiresAt: Date
): string | null {
  const key = viewKey();
  if (!key) return null;
  const ref = r.kind === "user" ? `u${r.userId}` : `e${emailRef(r.email)}`;
  const payload = `${scheduleId}.${ref}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${payload}.${signView(payload, key)}`;
}

export type StaffViewRef =
  | { kind: "user"; userId: number }
  | { kind: "external"; emailRef: string };

export function verifyStaffViewToken(
  token: string
):
  | { ok: true; scheduleId: number; ref: StaffViewRef }
  | { ok: false; reason: "invalid" | "expired" } {
  const key = viewKey();
  const parts = token.split(".");
  if (!key || parts.length !== 4) return { ok: false, reason: "invalid" };
  const [sid, ref, exp, sig] = parts;
  const expected = Buffer.from(signView(`${sid}.${ref}.${exp}`, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: "invalid" };
  const scheduleId = Number(sid);
  const expSec = Number(exp);
  if (!Number.isInteger(scheduleId) || !Number.isInteger(expSec))
    return { ok: false, reason: "invalid" };
  if (Date.now() / 1000 > expSec) return { ok: false, reason: "expired" };
  if (ref.startsWith("u")) {
    const userId = Number(ref.slice(1));
    return Number.isInteger(userId) && userId > 0
      ? { ok: true, scheduleId, ref: { kind: "user", userId } }
      : { ok: false, reason: "invalid" };
  }
  if (ref.startsWith("e") && ref.length > 1)
    return { ok: true, scheduleId, ref: { kind: "external", emailRef: ref.slice(1) } };
  return { ok: false, reason: "invalid" };
}

// ─── 발송 ────────────────────────────────────────────────────────────────────

export function schedulePlaceLabel(
  sched: Pick<InterviewSchedule, "modeOnline" | "address" | "addressDetail">,
  meetingUrl?: string | null
): string {
  if (!sched.modeOnline)
    return [sched.address, sched.addressDetail].filter(Boolean).join(" ") || "추후 안내";
  return meetingUrl
    ? "온라인 화상 면접 (접속 링크는 메일로 안내)"
    : "온라인 화상 면접 (접속 링크는 추후 메일로 안내)";
}

async function loadScheduleContext(sched: SchedForStaff) {
  const [cand] = await db
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  const [job] = await db
    .select({ title: jobPostings.title })
    .from(jobPostings)
    .where(eq(jobPostings.id, sched.jobId));
  const [org] = sched.orgId
    ? await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, sched.orgId))
    : [];
  return {
    orgName: org?.name ?? null,
    jobTitle: job?.title ?? "공고",
    // 잠금화면 미리보기 노출 대비 — 전체 정보는 버튼 뒤(로그인·공유 링크)에서만 본다.
    candidateName: maskPersonName(cand?.name) || "지원자",
  };
}

async function withVerifiedPhones(sched: SchedForStaff, recipients: StaffRecipient[]) {
  const phones = await findVerifiedPhones({
    userIds: recipients.flatMap((r) => (r.kind === "user" ? [r.userId] : [])),
    orgId: sched.orgId,
    emails: recipients.flatMap((r) => (r.kind === "external" ? [r.email] : [])),
  });
  return recipients.flatMap((r) => {
    const phone = r.kind === "user" ? phones.byUser.get(r.userId) : phones.byEmail.get(r.email);
    return phone ? [{ r, phone }] : [];
  });
}

/** 일정 확정 알림톡. 보낸 건수를 돌려준다(번호 확인된 대상이 없으면 0, throw 안 함은 호출부 책임). */
export async function sendStaffScheduleConfirmed(opts: {
  sched: SchedForStaff;
  slot: Slot;
  meetingUrl?: string | null;
  /** 이미 아는 사람 — 수동 확정을 직접 등록한 면접관 등. */
  excludeUserIds?: number[];
}): Promise<number> {
  const { sched, slot } = opts;
  const targets = await withVerifiedPhones(
    sched,
    await resolveScheduleRecipients(sched, opts.excludeUserIds)
  );
  if (targets.length === 0) return 0;

  const ctx = await loadScheduleContext(sched);
  const base = resolveMailBaseUrl();
  // 면접 뒤에 나오는 평가까지 열어볼 수 있게 면접일 + 공유 리포트 기본 기간 동안 유효.
  const expiresAt = addDays(new Date(slot.start), SHARE_LINK_DEFAULT_DAYS);
  const items: Array<{ phone: string; vars: StaffAlimtalkVars }> = [];
  for (const { r, phone } of targets) {
    const token = issueStaffViewToken(sched.id, r, expiresAt);
    if (!token) {
      console.error("[staff-alimtalk] MASTER_ENCRYPTION_KEY 미설정 — 확정 알림톡 생략");
      return 0;
    }
    items.push({
      phone,
      vars: {
        orgName: ctx.orgName,
        recipientName: r.name || "담당자",
        jobTitle: ctx.jobTitle,
        roundLabel: roundLabel(sched.round),
        candidateName: ctx.candidateName,
        slotLabel: formatSlotKst(slot),
        place: schedulePlaceLabel(sched, opts.meetingUrl),
        url: `${base}/shared/view/${token}`,
      },
    });
  }
  const res = await sendStaffAlimtalk("staff_schedule_confirmed", items, {
    deferAtNight: true,
  });
  return res.ok ? res.sent : 0;
}

/** 확정됐던 일정의 취소 알림톡. 이미 지난 면접이면 보내지 않는다. */
export async function sendStaffScheduleCancelled(opts: {
  sched: SchedForStaff;
  slot: Slot;
  reason: string;
}): Promise<number> {
  const { sched, slot } = opts;
  if (new Date(slot.start).getTime() <= Date.now()) return 0;
  const targets = await withVerifiedPhones(sched, await resolveScheduleRecipients(sched));
  if (targets.length === 0) return 0;

  const ctx = await loadScheduleContext(sched);
  const items = targets.map(({ r, phone }) => ({
    phone,
    vars: {
      orgName: ctx.orgName,
      recipientName: r.name || "담당자",
      jobTitle: ctx.jobTitle,
      roundLabel: roundLabel(sched.round),
      candidateName: ctx.candidateName,
      slotLabel: formatSlotKst(slot),
      reason: opts.reason,
    },
  }));
  const res = await sendStaffAlimtalk("staff_schedule_cancelled", items, {
    deferAtNight: true,
  });
  return res.ok ? res.sent : 0;
}

// ─── 일정 제안 입력 ──────────────────────────────────────────────────────────

export async function getJobInterviewerIds(jobId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: jobInterviewers.userId })
    .from(jobInterviewers)
    .where(eq(jobInterviewers.jobId, jobId));
  return rows.map((r) => r.userId);
}

/**
 * 일정 제안 입력의 "알림 받을 면접관" — 공고 면접관만 남긴다.
 * 필드 자체가 없으면(구 클라이언트) null = 공고 면접관 전원. 빈 배열은 "아무에게도 안 보냄"으로 존중.
 */
export function normalizeNotifyUserIds(
  input: unknown,
  jobInterviewerIds: number[]
): number[] | null {
  if (!Array.isArray(input)) return null;
  const allowed = new Set(jobInterviewerIds);
  return [
    ...new Set(
      input.filter(
        (v): v is number => typeof v === "number" && Number.isInteger(v) && allowed.has(v)
      )
    ),
  ];
}

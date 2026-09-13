/**
 * 면접 일정 알림톡 수신 번호(notify_phones) — 등록·번호 확인·조회·삭제.
 *
 * 누가 입력하든(본인 계정 설정·가입 폼·법인 관리자·일정 제안자) pending 으로 저장하고 그 번호로
 * "번호 확인" 알림톡을 보낸다. 본인이 /verify/phone/[token] 에서 확인해야 verified 가 되고,
 * 일정 알림(lib/staff-alimtalk.ts)은 verified 번호에만 나간다 — 오타 번호로 지원자 일정이
 * 새는 것을 막고, 확인 시각·IP·UA 를 수신 동의 기록으로 남긴다.
 * "받지 않기"·삭제는 행 자체를 지운다(보관할 이유가 없는 연락처).
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "./db";
import { notifyPhones, organizations, type NotifyPhone } from "./schema";
import { normalizeMobile, sendStaffAlimtalk } from "./alimtalk";
import { resolveMailBaseUrl } from "./notifications";
import { isUniqueViolation } from "./db-errors";
import { addDays } from "./utils";

/** 확인 링크 유효기간(일) — 지나면 다시 요청해야 한다. */
export const PHONE_VERIFY_TTL_DAYS = 7;
/** 확인 기한이 지나고도 이 기간(일)이 더 지난 미확인 번호는 삭제한다. */
const STALE_PENDING_DAYS = 30;

/** 가입자는 userId, 비회원(일정 공유받을 사람)은 법인 + 이메일로 식별한다. */
export type PhoneOwner = { userId: number } | { orgId: number; email: string };

export type PhoneStatus = {
  phoneMasked: string;
  status: "pending" | "verified";
  verifySentAt: string | null;
};

/** "01012345678" → "010-****-5678" (화면 표시용). */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 8) return "***";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

function toStatus(row: NotifyPhone): PhoneStatus {
  return {
    phoneMasked: maskPhone(row.phone),
    status: row.status,
    verifySentAt: row.verifySentAt,
  };
}

function ownerWhere(owner: PhoneOwner) {
  return "userId" in owner
    ? eq(notifyPhones.userId, owner.userId)
    : and(
        eq(notifyPhones.orgId, owner.orgId),
        eq(notifyPhones.email, owner.email.trim().toLowerCase())
      );
}

export async function getPhoneStatus(owner: PhoneOwner): Promise<PhoneStatus | null> {
  const [row] = await db.select().from(notifyPhones).where(ownerWhere(owner));
  return row ? toStatus(row) : null;
}

export async function getPhoneStatusesForUsers(
  userIds: number[]
): Promise<Map<number, PhoneStatus>> {
  const out = new Map<number, PhoneStatus>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select()
    .from(notifyPhones)
    .where(inArray(notifyPhones.userId, userIds));
  for (const r of rows) if (r.userId != null) out.set(r.userId, toStatus(r));
  return out;
}

export async function getPhoneStatusesForEmails(
  orgId: number,
  emails: string[]
): Promise<Map<string, PhoneStatus>> {
  const out = new Map<string, PhoneStatus>();
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0) return out;
  const rows = await db
    .select()
    .from(notifyPhones)
    .where(and(eq(notifyPhones.orgId, orgId), inArray(notifyPhones.email, list)));
  for (const r of rows) if (r.email) out.set(r.email, toStatus(r));
  return out;
}

/** 발송용 — 본인이 확인(verified)한 번호만 돌려준다. */
export async function findVerifiedPhones(opts: {
  userIds: number[];
  orgId: number | null;
  emails: string[];
}): Promise<{ byUser: Map<number, string>; byEmail: Map<string, string> }> {
  const byUser = new Map<number, string>();
  const byEmail = new Map<string, string>();
  if (opts.userIds.length > 0) {
    const rows = await db
      .select({ userId: notifyPhones.userId, phone: notifyPhones.phone })
      .from(notifyPhones)
      .where(
        and(
          inArray(notifyPhones.userId, opts.userIds),
          eq(notifyPhones.status, "verified")
        )
      );
    for (const r of rows) if (r.userId != null) byUser.set(r.userId, r.phone);
  }
  const emails = [...new Set(opts.emails.map((e) => e.trim().toLowerCase()))];
  if (opts.orgId != null && emails.length > 0) {
    const rows = await db
      .select({ email: notifyPhones.email, phone: notifyPhones.phone })
      .from(notifyPhones)
      .where(
        and(
          eq(notifyPhones.orgId, opts.orgId),
          inArray(notifyPhones.email, emails),
          eq(notifyPhones.status, "verified")
        )
      );
    for (const r of rows) if (r.email) byEmail.set(r.email, r.phone);
  }
  return { byUser, byEmail };
}

export type RequestVerifyResult =
  | { ok: true; status: "pending" | "verified"; sent: boolean; reason?: string }
  | { ok: false; error: string };

/**
 * 번호 등록(변경) + 번호 확인 알림톡 발송.
 *  - 같은 번호가 이미 확인됐으면 아무것도 하지 않는다.
 *  - 같은 번호가 확인 대기 중이면 링크가 만료됐거나 force 일 때만 다시 보낸다 — 일정을
 *    제안할 때마다 같은 사람에게 확인 요청이 반복해서 가는 것을 막는다.
 *  - 번호가 바뀌면 새 토큰으로 pending 전환(옛 번호로는 더 이상 보내지 않음) 후 발송.
 */
export async function requestPhoneVerification(opts: {
  owner: PhoneOwner;
  orgId: number;
  name: string;
  phone: string;
  requestedByUserId: number | null;
  /** 확인 대기 중인 같은 번호에도 확인 알림톡을 다시 보낸다 (본인이 누른 "다시 보내기"). */
  force?: boolean;
}): Promise<RequestVerifyResult> {
  const phone = normalizeMobile(opts.phone);
  if (!phone)
    return {
      ok: false,
      error: "휴대폰 번호 형식이 올바르지 않습니다. (예: 010-1234-5678)",
    };

  const now = new Date();
  const [existing] = await db.select().from(notifyPhones).where(ownerWhere(opts.owner));
  if (existing && existing.phone === phone) {
    if (existing.status === "verified") return { ok: true, status: "verified", sent: false };
    const linkAlive = new Date(existing.verifyExpiresAt).getTime() > now.getTime();
    if (linkAlive && !opts.force) return { ok: true, status: "pending", sent: false };
  }

  const name = opts.name.trim().slice(0, 100) || "담당자";
  const verifyToken = "np_" + randomBytes(24).toString("hex");
  const fields = {
    orgId: opts.orgId,
    name,
    phone,
    status: "pending" as const,
    verifyToken,
    verifyExpiresAt: addDays(now, PHONE_VERIFY_TTL_DAYS).toISOString(),
    verifySentAt: null,
    requestedByUserId: opts.requestedByUserId,
    verifiedAt: null,
    verifiedIp: null,
    verifiedUa: null,
  };
  let rowId: number;
  try {
    if (existing) {
      await db.update(notifyPhones).set(fields).where(eq(notifyPhones.id, existing.id));
      rowId = existing.id;
    } else {
      const [row] = await db
        .insert(notifyPhones)
        .values({
          ...fields,
          userId: "userId" in opts.owner ? opts.owner.userId : null,
          email: "userId" in opts.owner ? null : opts.owner.email.trim().toLowerCase(),
        })
        .returning({ id: notifyPhones.id });
      rowId = row.id;
    }
  } catch (e) {
    // 같은 사람에 대한 동시 등록 — 먼저 들어간 요청이 확인 알림톡을 보낸다.
    if (isUniqueViolation(e)) return { ok: true, status: "pending", sent: false };
    throw e;
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, opts.orgId));
  // 본인이 방금 입력한 번호는 바로 확인하도록 즉시, 남이 입력한 번호는 심야면 아침으로 미룬다.
  const selfRequest =
    "userId" in opts.owner && opts.owner.userId === opts.requestedByUserId;
  const res = await sendStaffAlimtalk(
    "staff_phone_verify",
    [
      {
        phone,
        vars: {
          orgName: org?.name ?? null,
          recipientName: name,
          url: `${resolveMailBaseUrl()}/verify/phone/${verifyToken}`,
        },
      },
    ],
    { deferAtNight: !selfRequest }
  );
  if (res.ok)
    await db
      .update(notifyPhones)
      .set({ verifySentAt: now.toISOString() })
      .where(eq(notifyPhones.id, rowId));
  return { ok: true, status: "pending", sent: res.ok, reason: res.ok ? undefined : res.reason };
}

export async function removePhone(owner: PhoneOwner): Promise<boolean> {
  const rows = await db
    .delete(notifyPhones)
    .where(ownerWhere(owner))
    .returning({ id: notifyPhones.id });
  return rows.length > 0;
}

export type PhoneVerifyView =
  | { state: "not_found" }
  | {
      state: "expired" | "pending" | "verified";
      orgName: string;
      name: string;
      phoneMasked: string;
    };

/** 번호 확인 페이지 표시용 — 토큰 주인의 법인·이름·가린 번호와 상태. */
export async function getPhoneVerifyView(token: string): Promise<PhoneVerifyView> {
  const [row] = await db
    .select({
      phone: notifyPhones.phone,
      status: notifyPhones.status,
      verifyExpiresAt: notifyPhones.verifyExpiresAt,
      name: notifyPhones.name,
      orgName: organizations.name,
    })
    .from(notifyPhones)
    .leftJoin(organizations, eq(organizations.id, notifyPhones.orgId))
    .where(eq(notifyPhones.verifyToken, token));
  if (!row) return { state: "not_found" };
  const state =
    row.status === "verified"
      ? "verified"
      : new Date(row.verifyExpiresAt).getTime() < Date.now()
        ? "expired"
        : "pending";
  return {
    state,
    orgName: row.orgName ?? "Intervia",
    name: row.name ?? "담당자",
    phoneMasked: maskPhone(row.phone),
  };
}

export async function confirmPhoneByToken(
  token: string,
  meta: { ip: string | null; ua: string | null }
): Promise<{ ok: true; alreadyVerified: boolean } | { ok: false; code: "not_found" | "expired" }> {
  const [row] = await db.select().from(notifyPhones).where(eq(notifyPhones.verifyToken, token));
  if (!row) return { ok: false, code: "not_found" };
  if (row.status === "verified") return { ok: true, alreadyVerified: true };
  if (new Date(row.verifyExpiresAt).getTime() < Date.now())
    return { ok: false, code: "expired" };
  await db
    .update(notifyPhones)
    .set({
      status: "verified",
      verifiedAt: new Date().toISOString(),
      verifiedIp: meta.ip,
      verifiedUa: meta.ua?.slice(0, 500) ?? null,
    })
    .where(eq(notifyPhones.id, row.id));
  return { ok: true, alreadyVerified: false };
}

/** "받지 않기" — 확인 여부와 무관하게 번호를 지운다. */
export async function declinePhoneByToken(token: string): Promise<boolean> {
  const rows = await db
    .delete(notifyPhones)
    .where(eq(notifyPhones.verifyToken, token))
    .returning({ id: notifyPhones.id });
  return rows.length > 0;
}

/** 확인되지 않은 채 오래 남은 번호 삭제 — purge-original 일일 cron 이 호출. */
export async function cleanupStalePhoneRequests(): Promise<number> {
  // verifyExpiresAt 는 toISOString() 저장이라 같은 ISO 포맷끼리 비교해야 사전순=시간순이다.
  const cutoff = addDays(new Date(), -STALE_PENDING_DAYS).toISOString();
  const rows = await db
    .delete(notifyPhones)
    .where(and(eq(notifyPhones.status, "pending"), lt(notifyPhones.verifyExpiresAt, cutoff)))
    .returning({ id: notifyPhones.id });
  return rows.length;
}

export type SharePhoneInput = { email: string; name: string | null; phone: string };

/**
 * 일정 제안 입력(shareRecipients)에서 휴대폰 번호를 함께 적은 비회원만 추린다.
 * 가입자(userId)는 본인 번호(계정 설정)를 쓰므로 제외. 번호는 일정 스냅샷에 남기지 않고
 * notify_phones 로만 간다 — normalizeShareRecipients 가 phone 필드를 버린다.
 */
export function parseSharePhoneInputs(
  input: unknown
): { ok: true; list: SharePhoneInput[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: true, list: [] };
  const out: SharePhoneInput[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { email?: unknown; name?: unknown; userId?: unknown; phone?: unknown };
    if (r.userId != null || typeof r.email !== "string") continue;
    if (typeof r.phone !== "string" || !r.phone.trim()) continue;
    const phone = normalizeMobile(r.phone);
    if (!phone)
      return { ok: false, error: `휴대폰 번호 형식이 올바르지 않습니다: ${r.email}` };
    out.push({
      email: r.email.trim().toLowerCase(),
      name: typeof r.name === "string" ? r.name.trim() || null : null,
      phone,
    });
  }
  return { ok: true, list: out };
}

/** 공유받을 사람 번호 일괄 등록 — 새 번호·바뀐 번호에만 확인 알림톡이 나간다. */
export async function requestSharePhoneVerifications(
  orgId: number,
  list: SharePhoneInput[],
  requestedByUserId: number
): Promise<Array<{ email: string; status: "pending" | "verified"; sent: boolean }>> {
  const out: Array<{ email: string; status: "pending" | "verified"; sent: boolean }> = [];
  for (const p of list) {
    try {
      const r = await requestPhoneVerification({
        owner: { orgId, email: p.email },
        orgId,
        name: p.name ?? "",
        phone: p.phone,
        requestedByUserId,
      });
      if (r.ok) out.push({ email: p.email, status: r.status, sent: r.sent });
    } catch (e) {
      console.error(
        "[notify-phone] 공유받을 사람 번호 등록 실패",
        e instanceof Error ? e.message : e
      );
    }
  }
  return out;
}

/** 등록된 번호로 확인 알림톡 다시 보내기 — 화면에는 가린 번호만 있어 서버가 원번호를 쓴다. */
export async function resendPhoneVerification(
  owner: PhoneOwner,
  requestedByUserId: number
): Promise<RequestVerifyResult> {
  const [row] = await db.select().from(notifyPhones).where(ownerWhere(owner));
  if (!row) return { ok: false, error: "등록된 번호가 없습니다." };
  return requestPhoneVerification({
    owner,
    orgId: row.orgId,
    name: row.name ?? "",
    phone: row.phone,
    requestedByUserId,
    force: true,
  });
}

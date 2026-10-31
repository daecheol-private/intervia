/**
 * 휴대폰 인증번호(OTP) 공통 모듈 — 카카오 알림톡(실패 시 알리고가 문자로 대체).
 *
 * 쓰는 법 (기능 쪽 라우트):
 *   1) 자기 기능의 조건을 먼저 확인한 뒤 (예: 이 번호로 이미 접수된 지원서가 있을 때만)
 *      const r = await sendPhoneOtp(req, { purpose: "apply_duplicate", phone });
 *   2) 사용자가 입력한 번호를 검증 → 통과하면 짧게 유효한 ticket 을 받는다.
 *      const v = await verifyPhoneOtp({ purpose, phone, code });
 *   3) 실제 제출 라우트에서 verifyPhoneTicket(v.ticket, purpose, phone) 으로 다시 확인.
 *
 * ⚠️ 아무 번호로나 보내는 공개 발송 API 는 만들지 않는다 — 카톡·문자 비용을 남이 태울 수 있다.
 *    발송은 항상 기능 라우트가 자기 조건을 통과시킨 뒤에만 호출한다.
 *
 * 발송 제한 (카톡 비용 보호, 모두 한 INSERT 문 안에서 원자적으로 판정):
 *   - 같은 번호 재발송 60초 대기, 같은 번호 24시간 5회
 *   - 같은 IP 24시간 10회
 *   - 서비스 전체 24시간 OTP_DAILY_CAP(기본 300)회 — 넘으면 발송 중단 + Slack 알림
 * 검증 제한: 번호 하나당 5회 틀리면 그 번호는 폐기(재발송 필요). 가장 최근 번호만 유효.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { extractIp } from "./auth-attempts";
import { normalizeMobile, sendOtpAlimtalk, isOtpAlimtalkEnabled } from "./alimtalk";
import { postSlack } from "./slack";

/** 용도 → 알림톡 "#{용도} 화면에 …" 문구. 새 기능은 여기에 한 줄 추가. */
export const OTP_PURPOSES = {
  apply_duplicate: "지원서 본인 확인",
} as const;
export type OtpPurpose = keyof typeof OTP_PURPOSES;

export const OTP_TTL_MIN = 5;
const RESEND_COOLDOWN_SEC = 60;
const PHONE_DAILY_MAX = 5;
const IP_DAILY_MAX = 10;
const MAX_VERIFY_ATTEMPTS = 5;
const TICKET_TTL_SEC = 30 * 60;

function dailyCap(): number {
  const n = Number(process.env.OTP_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
}

function key(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex) throw new Error("MASTER_ENCRYPTION_KEY 미설정");
  return Buffer.from(hex, "hex");
}

function hashCode(purpose: string, phone: string, code: string): string {
  return createHmac("sha256", key()).update(`otp:${purpose}:${phone}:${code}`).digest("hex");
}

function rowsAffected(r: unknown): number {
  return Number((r as { rowsAffected?: number }).rowsAffected ?? 0);
}

export type OtpSendResult =
  | { ok: true; ttlSec: number; resendAfterSec: number }
  | {
      ok: false;
      reason: "invalid_phone" | "unavailable" | "cooldown" | "phone_limit" | "ip_limit" | "service_limit" | "send_failed";
      message: string;
      retryAfterSec?: number;
    };

let lastCapAlertAt = 0;

export async function sendPhoneOtp(
  req: Request,
  opts: { purpose: OtpPurpose; phone: string }
): Promise<OtpSendResult> {
  const phone = normalizeMobile(opts.phone);
  if (!phone) return { ok: false, reason: "invalid_phone", message: "휴대폰 번호를 확인해 주세요." };
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !isOtpAlimtalkEnabled())
    return { ok: false, reason: "unavailable", message: "지금은 휴대폰 인증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요." };

  const ip = extractIp(req);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const cap = dailyCap();

  // 제한 확인과 기록을 한 문장으로 — 동시에 여러 요청이 와도 한도를 넘겨 발송되지 않는다.
  const ins = await db.run(sql`
    INSERT INTO phone_otps (purpose, phone, code_hash, ip, expires_at)
    SELECT ${opts.purpose}, ${phone}, ${hashCode(opts.purpose, phone, code)}, ${ip},
           datetime('now', ${`+${OTP_TTL_MIN} minutes`})
    WHERE NOT EXISTS (SELECT 1 FROM phone_otps WHERE phone = ${phone}
                        AND created_at > datetime('now', ${`-${RESEND_COOLDOWN_SEC} seconds`}))
      AND (SELECT COUNT(*) FROM phone_otps WHERE phone = ${phone}
             AND created_at > datetime('now', '-1 day')) < ${PHONE_DAILY_MAX}
      AND (${ip} IS NULL OR (SELECT COUNT(*) FROM phone_otps WHERE ip = ${ip}
             AND created_at > datetime('now', '-1 day')) < ${IP_DAILY_MAX})
      AND (SELECT COUNT(*) FROM phone_otps
             WHERE created_at > datetime('now', '-1 day')) < ${cap}
  `);

  if (rowsAffected(ins) === 0) return explainRejection(phone, ip, cap);

  const sent = await sendOtpAlimtalk(phone, {
    code,
    purposeLabel: OTP_PURPOSES[opts.purpose],
    ttlMin: OTP_TTL_MIN,
  });
  if (!sent.ok) {
    if (!isProd && sent.skipped) {
      console.log(`[phone-otp] (로컬, 발송 생략) ${opts.purpose} ${phone} 인증번호=${code}`);
    } else {
      return { ok: false, reason: "send_failed", message: "인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
  }
  return { ok: true, ttlSec: OTP_TTL_MIN * 60, resendAfterSec: RESEND_COOLDOWN_SEC };
}

async function explainRejection(phone: string, ip: string | null, cap: number): Promise<OtpSendResult> {
  const { rows } = await db.run(sql`
    SELECT
      (SELECT MAX(created_at) FROM phone_otps WHERE phone = ${phone}) AS last_at,
      (SELECT COUNT(*) FROM phone_otps WHERE phone = ${phone} AND created_at > datetime('now', '-1 day')) AS phone_cnt,
      (SELECT COUNT(*) FROM phone_otps WHERE ip = ${ip} AND created_at > datetime('now', '-1 day')) AS ip_cnt,
      (SELECT COUNT(*) FROM phone_otps WHERE created_at > datetime('now', '-1 day')) AS all_cnt,
      CAST(strftime('%s', 'now') AS INTEGER) AS now_s
  `);
  const r = rows[0] as unknown as {
    last_at: string | null; phone_cnt: number; ip_cnt: number; all_cnt: number; now_s: number;
  };

  if (Number(r.all_cnt) >= cap) {
    if (Date.now() - lastCapAlertAt > 60 * 60 * 1000) {
      lastCapAlertAt = Date.now();
      void postSlack({ text: `:warning: 인증번호 발송이 24시간 한도(${cap}건)에 걸려 멈췄습니다. 남용 여부 확인 필요 (OTP_DAILY_CAP).` });
    }
    return { ok: false, reason: "service_limit", message: "지금은 인증번호 요청이 많아 잠시 멈췄습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (Number(r.phone_cnt) >= PHONE_DAILY_MAX)
    return { ok: false, reason: "phone_limit", message: "이 번호로 오늘 받을 수 있는 인증번호를 모두 사용했습니다. 내일 다시 시도해 주세요." };
  if (ip && Number(r.ip_cnt) >= IP_DAILY_MAX)
    return { ok: false, reason: "ip_limit", message: "인증번호 요청이 너무 많습니다. 내일 다시 시도해 주세요." };

  const lastS = r.last_at ? Math.floor(Date.parse(r.last_at.replace(" ", "T") + "Z") / 1000) : 0;
  const wait = Math.max(1, RESEND_COOLDOWN_SEC - (Number(r.now_s) - lastS));
  return { ok: false, reason: "cooldown", message: `${wait}초 후에 다시 받을 수 있습니다.`, retryAfterSec: wait };
}

export type OtpVerifyResult =
  | { ok: true; ticket: string }
  | { ok: false; reason: "expired" | "too_many" | "mismatch"; message: string; attemptsLeft?: number };

export async function verifyPhoneOtp(opts: {
  purpose: OtpPurpose;
  phone: string;
  code: string;
}): Promise<OtpVerifyResult> {
  const phone = normalizeMobile(opts.phone);
  const code = (opts.code ?? "").replace(/\D/g, "");
  const expired = { ok: false as const, reason: "expired" as const, message: "인증번호가 만료되었습니다. 다시 받아 주세요." };
  if (!phone || code.length !== 6) return { ok: false, reason: "mismatch", message: "6자리 인증번호를 입력해 주세요." };

  // 가장 최근 번호만 유효 — 재발송하면 앞 번호는 자동으로 무효.
  const { rows } = await db.run(sql`
    SELECT id, code_hash, consumed_at, expires_at > datetime('now') AS alive
    FROM phone_otps WHERE purpose = ${opts.purpose} AND phone = ${phone}
    ORDER BY id DESC LIMIT 1
  `);
  const row = rows[0] as unknown as { id: number; code_hash: string; consumed_at: string | null; alive: number } | undefined;
  if (!row || row.consumed_at || !Number(row.alive)) return expired;

  const bump = await db.run(sql`
    UPDATE phone_otps SET attempts = attempts + 1
    WHERE id = ${row.id} AND consumed_at IS NULL AND attempts < ${MAX_VERIFY_ATTEMPTS}
    RETURNING attempts
  `);
  const used = Number((bump.rows[0] as unknown as { attempts?: number } | undefined)?.attempts ?? 0);
  if (!used)
    return { ok: false, reason: "too_many", message: "인증번호를 여러 번 틀렸습니다. 새 인증번호를 받아 주세요." };

  const a = Buffer.from(hashCode(opts.purpose, phone, code));
  const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    const left = MAX_VERIFY_ATTEMPTS - used;
    return left > 0
      ? { ok: false, reason: "mismatch", message: `인증번호가 맞지 않습니다. (남은 횟수 ${left}회)`, attemptsLeft: left }
      : { ok: false, reason: "too_many", message: "인증번호를 여러 번 틀렸습니다. 새 인증번호를 받아 주세요." };
  }

  const done = await db.run(sql`
    UPDATE phone_otps SET consumed_at = datetime('now') WHERE id = ${row.id} AND consumed_at IS NULL
  `);
  if (rowsAffected(done) === 0) return expired;
  return { ok: true, ticket: issueTicket(opts.purpose, phone) };
}

function issueTicket(purpose: OtpPurpose, phone: string): string {
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;
  const payload = `${purpose}.${phone}.${exp}`;
  return `${payload}.${createHmac("sha256", key()).update(`otp-ticket:${payload}`).digest("base64url")}`;
}

/**
 * 인증 통과 증표 확인 (30분 유효). 같은 증표를 여러 번 쓰지 못하게 하는 건 기능 쪽 책임
 * (예: 같은 공고·번호 신고 1회 제한).
 */
export function verifyPhoneTicket(ticket: string | null | undefined, purpose: OtpPurpose, rawPhone: string): boolean {
  const phone = normalizeMobile(rawPhone);
  if (!ticket || !phone) return false;
  const parts = ticket.split(".");
  if (parts.length !== 4) return false;
  const [p, ph, expStr, sig] = parts;
  if (p !== purpose || ph !== phone) return false;
  const expected = createHmac("sha256", key()).update(`otp-ticket:${p}.${ph}.${expStr}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Math.floor(Date.now() / 1000) <= Number(expStr);
}

/** 2일 지난 인증번호 기록 삭제 (일일 cron). 제한 판정은 24시간만 보므로 충분. */
export async function cleanupOldPhoneOtps(): Promise<number> {
  const r = await db.run(sql`DELETE FROM phone_otps WHERE created_at < datetime('now', '-2 days')`);
  return rowsAffected(r);
}

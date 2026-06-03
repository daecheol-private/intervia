/**
 * TOTP (RFC 6238) — 외부 의존성 없는 순수 Node 구현.
 *
 * 30초 윈도우, 6자리 코드, HMAC-SHA1 (표준 — Google Authenticator/Authy/1Password 호환).
 *
 * 보안:
 *  - 시크릿은 base32 인코딩된 20바이트 (160bit) — RFC 권장.
 *  - 검증 시 ±1 윈도우(±30초) 허용 (클럭 스큐 대응).
 *  - 시크릿은 DB 저장 시 `lib/crypto.ts` AES-256-GCM 로 별도 암호화.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(byteLen = 20): string {
  const bytes = randomBytes(byteLen);
  return encodeBase32(bytes);
}

export function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

export function decodeBase32(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32 char: " + ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** 특정 시각의 6자리 TOTP 코드. (time = ms epoch, 기본 now) */
export function generateCode(secret: string, time = Date.now()): string {
  const counter = Math.floor(time / 1000 / 30);
  const key = decodeBase32(secret);
  const buf = Buffer.alloc(8);
  // 8바이트 big-endian counter
  buf.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/**
 * ±window 윈도우(기본 ±1 → ±30초) 검증 후, 매칭된 timestep(counter) 를 반환 (없으면 null).
 * `after` 가 주어지면 그 이하 counter 는 건너뛴다 — 이미 사용한 코드 재사용(replay) 차단.
 * 타이밍 공격 방지를 위해 timingSafeEqual 사용.
 */
export function verifyCodeReturningCounter(
  secret: string,
  inputCode: string,
  opts?: { window?: number; after?: number }
): number | null {
  const window = opts?.window ?? 1;
  const after = opts?.after;
  const clean = inputCode.replace(/\D/g, "");
  if (clean.length !== 6) return null;
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    const time = now + w * 30_000;
    const counter = Math.floor(time / 1000 / 30);
    if (after !== undefined && counter <= after) continue; // replay 방어
    const candidate = generateCode(secret, time);
    const a = Buffer.from(candidate);
    const b = Buffer.from(clean);
    if (a.length === b.length && timingSafeEqual(a, b)) return counter;
  }
  return null;
}

/** ±window 윈도우 검증 (boolean). replay 방어가 필요하면 `verifyCodeReturningCounter` 사용. */
export function verifyCode(
  secret: string,
  inputCode: string,
  window = 1
): boolean {
  return verifyCodeReturningCounter(secret, inputCode, { window }) !== null;
}

/**
 * Authenticator 앱이 인식하는 otpauth:// URL.
 * QR 코드로 렌더링하거나 사용자가 직접 클릭(딥링크)할 수 있음.
 */
export function provisioningUrl(opts: {
  secret: string;
  accountName: string; // 보통 user.email
  issuer: string; // 보통 "Intervia"
}): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.accountName}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

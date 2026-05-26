/**
 * 2FA 단계 사이의 short-lived challenge 토큰 (5분 유효).
 *
 * 비밀번호 검증 통과 → TOTP 입력 필요한 사용자에게 발급 → TOTP 검증 시 검증.
 * DB 저장 X — HMAC 서명만으로 위변조 차단.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SEC = 300;

function key(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex) throw new Error("MASTER_ENCRYPTION_KEY 미설정");
  return Buffer.from(hex, "hex");
}

export function issueLoginChallenge(userId: number): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const payload = `${userId}.${exp}`;
  const sig = createHmac("sha256", key()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyLoginChallenge(
  token: string
): { ok: true; userId: number } | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "형식 오류" };
  const [uidStr, expStr, sig] = parts;
  const uid = Number(uidStr);
  const exp = Number(expStr);
  if (!Number.isInteger(uid) || !Number.isInteger(exp))
    return { ok: false, reason: "형식 오류" };
  const expectedSig = createHmac("sha256", key())
    .update(`${uidStr}.${expStr}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: "서명 불일치" };
  if (Math.floor(Date.now() / 1000) > exp)
    return { ok: false, reason: "만료" };
  return { ok: true, userId: uid };
}

/**
 * AES-256-GCM 대칭 암호화.
 *
 * 용도: SMTP 비밀번호 등 운영자 입력 민감 정보를 DB 에 저장할 때 암호화.
 *
 * Key: 환경변수 `MASTER_ENCRYPTION_KEY` (32 byte = 64 hex chars).
 *      키 로테이션이 필요하면 enc 출력에 버전 prefix (현재 v1) 를 활용.
 *
 * Format: "enc:v1:" + base64( iv(12B) || authTag(16B) || ciphertext )
 *
 * 호환성: `decrypt` 는 prefix 가 없는 입력을 그대로 반환 (legacy 평문 보호 — 마이그레이션 도중 안전).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex)
    throw new Error(
      "MASTER_ENCRYPTION_KEY 가 설정되지 않았습니다 (32 byte hex)."
    );
  if (hex.length !== 64)
    throw new Error(
      `MASTER_ENCRYPTION_KEY 길이 오류: ${hex.length} (64 hex chars 필요)`
    );
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: string): string {
  if (!plain) return plain;
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(stored: string): string {
  if (!stored) return stored;
  // legacy 평문 또는 다른 prefix → 그대로 반환 (마이그레이션 안전망)
  if (!stored.startsWith(PREFIX)) return stored;
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (buf.length < IV_LEN + TAG_LEN)
    throw new Error("암호화 페이로드 형식 오류");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const key = getMasterKey();
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8"
  );
}

/** 이미 암호화된 값인지. 마이그레이션·로직 분기용. */
export function isEncrypted(s: string | null | undefined): boolean {
  return typeof s === "string" && s.startsWith(PREFIX);
}

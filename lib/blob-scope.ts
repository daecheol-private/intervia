/**
 * 클라이언트 직접 업로드(Blob) 경로 바인딩 — 업로드 토큰은 스코프 접두 경로로만 발급하고,
 * manifest 로 돌아온 URL 은 자기 스토어 + 같은 접두인지 검증한다.
 * (타 법인 Blob URL 을 manifest 에 넣어 서버 권한으로 읽어 오는 경로 차단 — 감사 C3)
 * 클라이언트에서도 import 하므로 node 전용 모듈을 쓰지 않는다.
 */

export type BlobScope = "apply" | "jobs" | "candidates";

export function blobScopePrefix(scope: BlobScope, id: number): string {
  return `${scope}/${id}/`;
}

function hasUnsafeSegment(rest: string): boolean {
  if (rest.includes("\\")) return true;
  for (let i = 0; i < rest.length; i++) {
    const c = rest.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true; // 제어문자
  }
  return rest.split("/").some((s) => s === "." || s === "..");
}

/** 업로드 토큰 발급 시 클라이언트가 요청한 pathname 검증. */
export function isScopedUploadPathname(pathname: string, prefix: string): boolean {
  if (typeof pathname !== "string" || !pathname.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length);
  if (!rest || rest.startsWith("/")) return false;
  return !hasUnsafeSegment(rest);
}

/** 이 배포의 Blob 스토어 호스트 — 토큰 `vercel_blob_rw_<storeId>_<secret>` 에서 도출(@vercel/blob 과 동일 규칙). */
export function ownBlobStoreHost(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const storeId = token?.split("_")[3];
  if (!storeId) return null;
  return `${storeId.toLowerCase()}.private.blob.vercel-storage.com`;
}

/** manifest 로 받은 Blob URL 이 자기 스토어 + 지정 접두 경로인지. */
export function isScopedBlobUrl(raw: unknown, prefix: string): boolean {
  if (typeof raw !== "string" || raw.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
  if (u.search || u.hash) return false;
  const host = ownBlobStoreHost();
  // 토큰 없는 환경(로컬·테스트)은 Blob 읽기 자체가 불가 — 사실상 거부.
  if (!host || u.hostname.toLowerCase() !== host) return false;
  // 인코딩된 구분자·점 세그먼트 우회 차단 (원문 기준).
  const rawPath = raw.replace(/^https:\/\/[^/?#]*/i, "").toLowerCase();
  if (/%2f|%5c|%2e|\\/.test(rawPath)) return false;
  if (rawPath.split("/").some((s) => s === "." || s === "..")) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(u.pathname.slice(1));
  } catch {
    return false;
  }
  return isScopedUploadPathname(decoded, prefix);
}

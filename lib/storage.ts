import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/**
 * 파일명(또는 경로) 확장자로 content-type 도출.
 * 미지정 시 octet-stream 으로 저장하면 브라우저가 inline 렌더 대신 무조건
 * 다운로드해버린다 (Content-Disposition: inline 무시). 그래서 업로드·로컬읽기
 * 양쪽에서 확장자 기반으로 정확한 타입을 매긴다.
 */
export function contentTypeFromName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".hwp": "application/x-hwp",
    ".hwpx": "application/vnd.hancom.hwpx",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".md": "text/plain",
    ".html": "text/html",
    ".htm": "text/html",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * 다운로드 응답에서 브라우저가 스크립트로 실행할 수 있는 위험 타입을
 * octet-stream 으로 강등. 업로드/Blob 이 보고한 content-type 을 그대로 흘리면
 * .html/.svg 가 세션 도메인에서 렌더되어 저장형 XSS 가 된다.
 * (호출부에서 nosniff 헤더 + attachment 강제와 함께 사용 — 다층 방어)
 */
export function safeDownloadContentType(contentType: string): string {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const DANGEROUS = new Set([
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "application/xml",
    "text/xml",
    "application/javascript",
    "text/javascript",
    "application/x-javascript",
  ]);
  return DANGEROUS.has(ct) ? "application/octet-stream" : contentType;
}

/** inline 미리보기를 허용할 안전한 타입만 inline, 그 외 attachment 강제(강제 다운로드). */
export function downloadDisposition(
  contentType: string
): "inline" | "attachment" {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const INLINE_OK = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "text/plain",
  ]);
  return INLINE_OK.has(ct) ? "inline" : "attachment";
}

function shouldUseBlob(): boolean {
  const has = !!process.env.BLOB_READ_WRITE_TOKEN;
  // 안전 가드: dev 에서 Blob 토큰이 실수로 .env.local 에 있으면 로컬 디스크 fallback
  if (
    has &&
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_PROD_BLOB_IN_DEV !== "1"
  ) {
    console.warn(
      "[storage] dev 모드에서 BLOB_READ_WRITE_TOKEN 감지 — 로컬 ./uploads/ 로 fallback (의도적이면 ALLOW_PROD_BLOB_IN_DEV=1)"
    );
    return false;
  }
  return has;
}

/**
 * 파일을 저장하고 DB에 보관할 "key"를 반환한다.
 * - 로컬: 파일명 (예: "1700000000_abcd.pdf")
 * - Vercel Blob: 전체 URL (예: "https://xxx.public.blob.vercel-storage.com/...")
 */
export async function saveFile(
  originalName: string,
  buffer: Buffer,
  contentType?: string
): Promise<string> {
  const ext = path.extname(originalName) || ".bin";
  // public Blob 은 URL 비밀성이 유일한 접근 통제 — 추측 불가능한 크기(128bit)의 랜덤 필수.
  const safeBase = `${Date.now()}_${randomBytes(16).toString("hex")}${ext}`;

  if (shouldUseBlob()) {
    const { put } = await import("@vercel/blob");
    // private 스토어 — URL 만으로는 접근 불가, 읽기는 fetchBlobFile(get) 프록시 경유만.
    // (스토어의 access 모드는 생성 시 고정 — BLOB_READ_WRITE_TOKEN 은 private 스토어여야 함)
    const result = await put(safeBase, buffer, {
      access: "private",
      contentType: contentType ?? contentTypeFromName(originalName),
      addRandomSuffix: false,
    });
    return result.url;
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, safeBase), buffer);
  return safeBase;
}

/**
 * 파일을 삭제. 키가 어떤 형식이든 자동 처리.
 */
export async function deleteFile(
  key: string | null | undefined
): Promise<void> {
  if (!key) return;
  if (/^https?:\/\//i.test(key)) {
    try {
      const { del } = await import("@vercel/blob");
      await del(key);
    } catch {
      // 이미 삭제됐거나 권한 없는 경우 무시.
      // legacy public 스토어 키는 현재 토큰(private 스토어)으로 못 지움 — 마이그레이션
      // 완료 후 옛 스토어를 대시보드에서 통째로 삭제하는 것으로 정리한다.
    }
    return;
  }
  if (key.includes("..") || key.includes("/") || key.includes("\\")) return;
  try {
    await fs.unlink(path.join(UPLOAD_DIR, key));
  } catch {
    // 파일 없음
  }
}

/**
 * 저장된 파일 URL(Blob) 이 허용된 호스트인지 검증 — SSRF 방어.
 * https + Vercel Blob 도메인(또는 BLOB_ALLOWED_HOSTS)만 통과. 다운로드 라우트와 동일 규칙.
 * key 는 항상 saveFile 이 생성한 서버 값이지만(사용자가 임의 URL 을 넣을 경로 없음),
 * fetch 하는 모든 경로에서 동일 allowlist 를 적용해 방어 일관성을 유지한다.
 */
export function isAllowedBlobUrl(urlStr: string): boolean {
  let host = "";
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return false;
    host = u.host.toLowerCase();
  } catch {
    return false;
  }
  const allowedHosts = new Set<string>([
    "blob.vercel-storage.com",
    ...(process.env.BLOB_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ]);
  // 정확히 일치하거나 허용 호스트의 서브도메인(.<host>)만 통과.
  return [...allowedHosts].some((h) => host === h || host.endsWith("." + h));
}

/** legacy public 스토어 URL 인지 — 호스트가 `<id>.public.blob.vercel-storage.com` 형태. */
export function isPublicBlobUrl(urlStr: string): boolean {
  try {
    return new URL(urlStr).host.toLowerCase().includes(".public.");
  } catch {
    return false;
  }
}

/**
 * Blob URL 을 buffer 로 읽는다 — private 스토어는 get()(토큰 인증),
 * legacy public 스토어(마이그레이션 전 잔존 키)는 일반 fetch.
 * SSRF allowlist 는 양쪽 공통. 못 읽으면 null.
 */
export async function fetchBlobFile(
  key: string
): Promise<{ data: Buffer; contentType: string | null } | null> {
  if (!isAllowedBlobUrl(key)) return null;
  try {
    if (isPublicBlobUrl(key)) {
      const r = await fetch(key);
      if (!r.ok) return null;
      return {
        data: Buffer.from(await r.arrayBuffer()),
        contentType: r.headers.get("content-type"),
      };
    }
    const { get } = await import("@vercel/blob");
    const g = await get(key, { access: "private" });
    if (!g || g.statusCode !== 200) return null;
    return {
      data: Buffer.from(await new Response(g.stream).arrayBuffer()),
      contentType: g.blob.contentType ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 저장된 파일을 다시 buffer 로 읽는다 — 워커가 비동기 파싱 시 사용.
 * key 가 http(s) URL(Blob)이면 fetchBlobFile, 아니면 로컬 ./uploads/ 에서 읽음.
 * 못 읽으면 null.
 */
export async function readStoredFile(key: string): Promise<Buffer | null> {
  if (/^https?:\/\//i.test(key)) {
    const found = await fetchBlobFile(key);
    return found?.data ?? null;
  }
  const local = await readLocalFile(key);
  return local?.data ?? null;
}

/**
 * 로컬 다운로드 핸들러용: 파일 buffer + content-type 반환
 */
export async function readLocalFile(
  filename: string
): Promise<{ data: Buffer; contentType: string } | null> {
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\"))
    return null;
  try {
    const data = await fs.readFile(path.join(UPLOAD_DIR, filename));
    return { data, contentType: contentTypeFromName(filename) };
  } catch {
    return null;
  }
}

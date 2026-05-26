import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

function useBlob(): boolean {
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
  const safeBase = `${Date.now()}_${randomBytes(4).toString("hex")}${ext}`;

  if (useBlob()) {
    const { put } = await import("@vercel/blob");
    const result = await put(safeBase, buffer, {
      access: "public",
      contentType: contentType ?? "application/octet-stream",
      addRandomSuffix: false,
    });
    return result.url;
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, safeBase), buffer);
  return safeBase;
}

/**
 * @deprecated `/api/uploads/candidate/[id]` 를 직접 사용하세요.
 * 이 함수는 Blob URL 을 외부에 직접 노출시켜 인증 우회가 가능합니다.
 */
export function getDownloadUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  return `/api/uploads/${encodeURIComponent(key)}`;
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
      // 이미 삭제됐거나 권한 없는 경우 무시
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
 * 로컬 다운로드 핸들러용: 파일 buffer + content-type 반환
 */
export async function readLocalFile(
  filename: string
): Promise<{ data: Buffer; contentType: string } | null> {
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\"))
    return null;
  try {
    const data = await fs.readFile(path.join(UPLOAD_DIR, filename));
    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".html" || ext === ".htm"
          ? "text/html"
          : "application/octet-stream";
    return { data, contentType };
  } catch {
    return null;
  }
}

/**
 * ZIP 파일에서 이력서·포트폴리오 등 자료 추출.
 *
 * fflate 동기 unzipSync 사용 — 단건 처리 (Vercel 함수 시간 내 충분).
 * 안전 가드:
 *   - 압축 해제 후 총 파일 수 200개 이내
 *   - 개별 파일 50MB 이내 (포트폴리오 PDF 20~50MB 흔함)
 *   - 총 압축 해제 크기 100MB 이내 (zip bomb 차단)
 *   - 디렉토리·맥OS 메타파일·시스템 파일 자동 제외
 *   - 허용 확장자만 (.pdf, .docx, .doc, .hwp, .hwpx, .png, .jpg, .jpeg, .pptx, .xlsx, .txt)
 */
import { unzipSync, strFromU8 } from "fflate";

const MAX_FILES = 200;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  "pdf",
  "docx",
  "doc",
  "hwp",
  "hwpx",
  "png",
  "jpg",
  "jpeg",
  "pptx",
  "xlsx",
  "txt",
  "md",
]);

const SKIP_RE = [
  /^__MACOSX\//,
  /(^|\/)\.DS_Store$/,
  /(^|\/)Thumbs\.db$/i,
  /(^|\/)desktop\.ini$/i,
  /(^|\/)\._/,
];

export type ZipEntry = {
  name: string; // 파일명 (leaf) — 표시·확장자 판정용
  path: string; // ZIP 안 원본 경로 — 폴더 그룹화용
  buf: Buffer;
};

export class ZipExtractError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/** 안전한 ZIP 내부 경로로 정규화 — '..' / 절대경로 차단, 구분자 통일. */
function safePath(rawName: string): { path: string; name: string } | null {
  const parts = rawName
    .split(/[/\\]/)
    .map((p) => p.trim())
    .filter((p) => p && p !== "." && p !== "..");
  if (parts.length === 0) return null;
  const name = parts[parts.length - 1];
  if (!name) return null;
  return { path: parts.join("/"), name };
}

/**
 * fflate 가 반환한 이름이 깨졌으면 (CP949 ZIP) 복구.
 *
 * fflate 동작: ZIP 헤더의 UTF-8 flag (bit 11) 가 켜져 있으면 UTF-8 디코딩,
 * 아니면 Latin-1 로 디코딩. 한국어 Windows 구버전·알집·7zip 기본 옵션은
 * UTF-8 flag 를 안 켜므로 한글 파일명이 Latin-1 로 잘못 해석돼 mojibake.
 *
 * 복구: Latin-1 로 잘못 해석된 문자열을 다시 바이트로 변환 → EUC-KR(CP949) 로 디코딩.
 */
function recoverKoreanFilename(s: string): string {
  // 0x80~0xFF 영역 문자가 있으면 mojibake 의심 (정상 UTF-8 디코딩이면 한글은 BMP 범위 가 위에 있음)
  if (!/[-ÿ]/.test(s)) return s;
  try {
    const bytes = Buffer.from(s, "latin1");
    const decoded = new TextDecoder("euc-kr", { fatal: false }).decode(bytes);
    // 한글 음절이 포함되면 복구 성공 — 사용
    if (/[가-힣]/.test(decoded)) return decoded;
  } catch {
    /* TextDecoder('euc-kr') 미지원 환경 — 원본 유지 */
  }
  return s;
}

function tryDecode(name: Uint8Array | string): string {
  const raw = typeof name === "string" ? name : strFromU8(name);
  return recoverKoreanFilename(raw);
}

export function extractZip(buf: Buffer): ZipEntry[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buf));
  } catch (e) {
    throw new ZipExtractError(
      "invalid_zip",
      `압축 파일을 열 수 없습니다: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const out: ZipEntry[] = [];
  let totalBytes = 0;
  let fileCount = 0;
  let totalEntries = 0;
  let skippedExt = 0;
  let mojibakeSuspect = false;

  for (const rawName in entries) {
    if (fileCount >= MAX_FILES)
      throw new ZipExtractError(
        "too_many_files",
        `압축 파일 안 항목이 너무 많습니다 (최대 ${MAX_FILES}개).`
      );
    const data = entries[rawName];
    // 디렉토리 엔트리 (마지막이 / 로 끝남) 자동 skip
    if (rawName.endsWith("/") || data.length === 0) continue;
    // 시스템 파일 skip
    if (SKIP_RE.some((re) => re.test(rawName))) continue;

    totalEntries++;
    const decoded = tryDecode(rawName);
    // 깨진 인코딩 의심 — 디코딩 결과에 ASCII 만 있거나 replacement char (U+FFFD) 가 있으면 mojibake.
    if (
      /�/.test(decoded) ||
      /[-ÿ]/.test(decoded) // Latin-1 영역 (CP437/CP949 깨진 흔적)
    ) {
      mojibakeSuspect = true;
    }
    const parsed = safePath(decoded);
    if (!parsed) continue;
    const ext = (parsed.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      skippedExt++;
      continue;
    }
    if (data.length > MAX_FILE_BYTES)
      throw new ZipExtractError(
        "file_too_large",
        `압축 안 '${parsed.name}' 파일이 너무 큽니다 (개별 최대 50MB).`
      );
    totalBytes += data.length;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new ZipExtractError(
        "total_too_large",
        `압축 해제 후 총 크기가 너무 큽니다 (최대 100MB).`
      );
    out.push({ name: parsed.name, path: parsed.path, buf: Buffer.from(data) });
    fileCount++;
  }

  if (out.length === 0) {
    let detail = `압축 파일 안에 처리 가능한 문서가 없습니다 (PDF/DOCX/이미지 등). 항목 ${totalEntries}개 중 확장자 미지원으로 ${skippedExt}개 제외됨.`;
    if (mojibakeSuspect)
      detail +=
        " 파일명 인코딩이 깨진 것 같습니다 (CP949 등 옛 ZIP) — UTF-8 인코딩으로 다시 압축해 주세요. macOS '내장 압축' 또는 Windows 11 기본 '압축(zip)' 사용 권장.";
    throw new ZipExtractError("no_valid_files", detail);
  }
  return out;
}

/**
 * 이력서·첨부 업로드 공용 검증 — 일괄 업로드(jobs/[id]/candidates)와
 * 후보자 상세 첨부 추가(candidates/[id]/attachments)가 같은 규칙을 공유한다.
 */

// 개별 첨부 1건 상한. 초과 시 그 파일만 제외 — 동영상 삽입된 PPT 등
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB
export const RESUME_EXTS = new Set(["pdf", "docx", "hwpx"]);
export const ATTACHMENT_EXTS = new Set([
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

export function ext(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function verifyMagic(name: string, buf: Buffer): string | null {
  const e = ext(name);
  if (e === "pdf") {
    if (
      buf.length < 5 ||
      buf[0] !== 0x25 ||
      buf[1] !== 0x50 ||
      buf[2] !== 0x44 ||
      buf[3] !== 0x46 ||
      buf[4] !== 0x2d
    )
      return "유효한 PDF 파일이 아닙니다.";
  } else if (e === "docx" || e === "pptx" || e === "xlsx" || e === "hwpx") {
    // hwpx 도 ZIP 컨테이너라 PK 매직(0x50 0x4b) 공유.
    if (buf.length < 2 || buf[0] !== 0x50 || buf[1] !== 0x4b)
      return `유효한 ${e.toUpperCase()} 파일이 아닙니다.`;
  }
  return null;
}

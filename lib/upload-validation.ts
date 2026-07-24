/**
 * 이력서·첨부 업로드 공용 검증 — 일괄 업로드(jobs/[id]/candidates)와
 * 후보자 상세 첨부 추가(candidates/[id]/attachments)가 같은 규칙을 공유한다.
 */

// 개별 첨부 1건 상한. 초과 시 그 파일만 제외 — 동영상 삽입된 PPT 등
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB
// 대면 면접 녹음 오디오 1건 상한 — Gemini Vertex inline 데이터 한도 회피
// (그 이상 장시간·고비트레이트는 준실시간 모드 권장). 상세: docs/LIVE_INTERVIEW_PLAN.md
export const MAX_AUDIO_BYTES = 18 * 1024 * 1024;

// 대면 면접 최소 길이(초). 이보다 짧은 녹음은 오녹음/실수(버튼 오조작·테스트 등)로 보고
// 전사·평가·과금을 전부 건너뛴다 — "결과가 어떻든 평가 완주 시 과금"되는 구조라, 무의미한
// 짧은 녹음이 과금되는 걸 막는다(2026-07-25 사용자 확정, 라이브·업로드 공통).
// 클라이언트는 이 값으로 사전 차단(라이브=실측, 업로드=파일 메타 측정)하고, 서버는
// finalize 직전 최종 방어한다. 측정 불가(durationSeconds=0)는 오차단 방지를 위해 통과시킨다.
// ⚠️ recorded-interview-{section,live}.tsx 에도 같은 값이 로컬 복제돼 있다(client 번들에
//    서버 유틸을 끌어오지 않으려는 기존 MAX_AUDIO_BYTES 패턴) — 바꾸면 세 곳을 함께 수정.
export const MIN_INTERVIEW_DURATION_SECONDS = 300; // 5분
export const TOO_SHORT_INTERVIEW_MESSAGE =
  "녹음이 5분 미만이라 평가하지 않았습니다. 정상적인 대면 면접 녹음인지 확인해 주세요.";
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

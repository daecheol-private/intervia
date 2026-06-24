/**
 * 이력서에서 증명사진(인물 사진)을 best-effort 로 추출한다.
 *
 * 용도: **후보자 상세 화면 표시 전용.** AI 평가 입력에는 절대 넣지 않는다(채용 편향 회피).
 *
 * 설계 원칙 — "있으면 보여주고, 없으면 조용히 넘어간다":
 *  - 신규 의존성 0. DOCX 는 이미 쓰는 fflate(zip), PDF 는 바이트 스캔.
 *  - 추출은 절대 파싱 파이프라인을 깨지 않는다 — 모든 실패는 null 반환(호출부 best-effort).
 *  - PDF 는 JPEG(DCTDecode) 스트림만 직접 추출한다. 한국 이력서 증명사진은 거의 JPEG 라
 *    pdfjs 같은 무거운 디코더 없이 이 경로로 대부분 커버된다. FlateDecode(PNG-only) 로만
 *    박힌 사진·스캔 PDF 는 미추출(graceful) — 그 경우 화면은 기존 이니셜 아바타로 폴백.
 *
 * 사진 = PII → 저장 후엔 본문(resume_file_path)과 동일한 보유기간 정책으로 폐기된다
 * (purgeOnDecision / purgeExpiredOriginals / deleteCandidateFiles).
 */
import { unzipSync } from "fflate";

export type ExtractedPhoto = { data: Buffer; ext: "jpg" | "png" };

// 인물 사진 판별 휴리스틱 한계값. 증명사진은 세로형(약 3:4) ~ 정사각이고,
// 로고/배너는 보통 가로형(ratio > 1.3), 아이콘/구분선은 아주 작다.
const MIN_DIM = 80; // px — 이보다 작으면 아이콘/장식
const MAX_LONG_SIDE = 1400; // px — 이보다 길면 전면 스캔 페이지(증명사진 아님)일 확률↑
const MAX_AREA = 1_500_000; // px² — 전면 페이지 이미지(스캔본) 배제
const MIN_BYTES = 2 * 1024; // 2KB 미만은 장식/스페이서
const MAX_BYTES = 5 * 1024 * 1024; // 5MB 초과 단일 이미지는 사진으로 취급 안 함

type Cand = { data: Buffer; ext: "jpg" | "png"; w: number; h: number };

/** w/h 비율·크기로 "증명사진스러움" 판정. 가로형 로고·초대형 페이지 스캔을 거른다. */
function looksLikePortraitPhoto(w: number, h: number): boolean {
  if (w < MIN_DIM || h < MIN_DIM) return false;
  if (Math.max(w, h) > MAX_LONG_SIDE) return false;
  if (w * h > MAX_AREA) return false;
  const ratio = w / h;
  return ratio >= 0.45 && ratio <= 1.3; // 세로형 ~ 약간 가로(정사각 부근)
}

/** JPEG SOF 마커에서 (w,h). 실패 시 null. */
function jpegSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // 데이터 없는 standalone 마커(RSTn·SOI·EOI)는 건너뜀
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    // SOF0~SOF15 (C0~CF) 중 DHT(C4)·JPGn(C8)·DAC(CC) 제외 = 프레임 헤더
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    i += 2 + len;
  }
  return null;
}

/** PNG IHDR 에서 (w,h). 실패 시 null. */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  // 시그니처 89 50 4E 47 0D 0A 1A 0A + IHDR(길이 13) → width@16, height@20
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47)
    return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w === 0 || h === 0) return null;
  return { w, h };
}

function sizeOf(buf: Buffer, ext: "jpg" | "png"): { w: number; h: number } | null {
  return ext === "jpg" ? jpegSize(buf) : pngSize(buf);
}

/** 후보 이미지들 중 가장 증명사진다운 1장 선택. 없으면 null. */
function pickBest(cands: Cand[]): ExtractedPhoto | null {
  const portrait = cands.filter((c) => looksLikePortraitPhoto(c.w, c.h));
  if (portrait.length === 0) return null;
  // 인물 사진은 보통 가장 큰(면적) 인물형 이미지 — 작은 인장·서명 이미지보다 우선.
  portrait.sort((a, b) => b.w * b.h - a.w * a.h);
  const best = portrait[0];
  return { data: best.data, ext: best.ext };
}

/** DOCX(zip)의 word/media/ 에서 인물 사진 후보 추출. */
function extractFromDocx(buffer: Buffer): ExtractedPhoto | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buffer, {
      // 미디어 폴더만 압축 해제 — 전체 docx 해제 비용 회피.
      filter: (f) => /^word\/media\/[^/]+\.(jpe?g|png)$/i.test(f.name),
    });
  } catch {
    return null;
  }
  const cands: Cand[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    const ext: "jpg" | "png" = /\.png$/i.test(name) ? "png" : "jpg";
    if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) continue;
    const data = Buffer.from(bytes);
    const dim = sizeOf(data, ext);
    if (!dim) continue;
    cands.push({ data, ext, w: dim.w, h: dim.h });
  }
  return pickBest(cands);
}

/**
 * PDF 안의 JPEG(DCTDecode) 이미지 스트림을 바이트 스캔으로 추출.
 *
 * 이미지 XObject 는 거의 항상 최상위 indirect object(대용량 바이너리라 object stream 에
 * 안 들어감)이고, 사진은 DCTDecode(=JPEG passthrough)로 저장되는 게 일반적이다.
 * `/DCTDecode` 뒤 첫 `stream` ~ `endstream` 구간의 바이트가 그대로 완결된 JPEG 이다.
 */
function extractFromPdf(buffer: Buffer): ExtractedPhoto | null {
  const cands: Cand[] = [];
  const DCT = Buffer.from("DCTDecode");
  const STREAM = Buffer.from("stream");
  const ENDSTREAM = Buffer.from("endstream");
  let from = 0;
  let guard = 0;
  while (guard++ < 64) {
    const dct = buffer.indexOf(DCT, from);
    if (dct === -1) break;
    // /DCTDecode 는 이미지 객체 dict 안에 있고, 실제 stream 키워드가 그 뒤에 온다.
    // (endstream 도 "stream" 을 포함하지만 dict→stream→data→endstream 순서라
    //  dict 뒤 첫 매치는 항상 진짜 stream 키워드다.)
    const sk = buffer.indexOf(STREAM, dct);
    if (sk === -1) break;
    let start = sk + STREAM.length;
    // PDF 명세: stream 키워드 뒤 CRLF 또는 LF 다음부터 데이터.
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;
    else if (buffer[start] === 0x0a) start += 1;
    const end = buffer.indexOf(ENDSTREAM, start);
    if (end === -1) break;
    let dataEnd = end;
    // endstream 직전 EOL 제거
    if (buffer[dataEnd - 1] === 0x0a) dataEnd--;
    if (buffer[dataEnd - 1] === 0x0d) dataEnd--;
    from = end + ENDSTREAM.length;

    const len = dataEnd - start;
    if (len < MIN_BYTES || len > MAX_BYTES) continue;
    // DCTDecode 스트림은 완결된 JPEG (FFD8 로 시작)이어야 한다.
    if (buffer[start] !== 0xff || buffer[start + 1] !== 0xd8) continue;
    const data = Buffer.from(buffer.subarray(start, dataEnd));
    const dim = jpegSize(data);
    if (!dim) continue;
    cands.push({ data, ext: "jpg", w: dim.w, h: dim.h });
  }
  return pickBest(cands);
}

function extOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

/**
 * 이력서 버퍼에서 증명사진 1장 추출. 못 찾으면 null.
 * 어떤 예외도 밖으로 던지지 않는다 — 호출부(ensureParsed)가 best-effort 로 쓴다.
 */
export async function extractPhotoFromBuffer(
  buffer: Buffer,
  originalName: string
): Promise<ExtractedPhoto | null> {
  try {
    const ext = extOf(originalName);
    if (ext === "docx") return extractFromDocx(buffer);
    if (ext === "pdf") return extractFromPdf(buffer);
    return null;
  } catch {
    return null;
  }
}

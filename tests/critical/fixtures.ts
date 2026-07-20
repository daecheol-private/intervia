/**
 * 이력서 PDF 픽스처 — pdfkit 으로 실행 시 생성 (바이너리 커밋 회피).
 * pdf-parse 가 30자+ 텍스트를 추출할 수 있는 실제 PDF 임을 사전 검증했다.
 */
import PDFDocument from "pdfkit";
import { zipSync, strToU8 } from "fflate";

export async function makeResumePdf(opts: {
  name: string;
  email: string;
  phone?: string;
  extra?: string;
}): Promise<Buffer> {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((res) => doc.on("end", () => res()));
  // pdfkit 기본 폰트는 한글 미지원 — 파서 추출 목적이므로 영문 구성으로 충분
  doc.fontSize(14).text(`RESUME - ${opts.name}`);
  doc.moveDown();
  doc
    .fontSize(11)
    .text(
      [
        `Name: ${opts.name}`,
        `Email: ${opts.email}`,
        `Phone: ${opts.phone ?? "010-1234-5678"}`,
        "Experience: 5 years backend development with Node.js and TypeScript.",
        "Worked on payment systems, message queues, and multi-tenant SaaS platforms.",
        "Education: Test University, Computer Science, 2018.",
        opts.extra ?? "Skills: SQL, Drizzle ORM, Next.js, distributed systems.",
      ].join("\n")
    );
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

export type DocxImage = {
  file: string; // word/media 파일명 (예: "photo.png")
  w: number;
  h: number;
  bytes?: number; // 총 바이트. 기본 4KB — photo-extract MIN_BYTES(2KB) 를 넘겨야 후보가 된다
};

/**
 * PNG 스텁 — 시그니처 + IHDR(가로·세로)만 정확하고 나머지는 0 패딩.
 *
 * photo-extract 는 헤더에서 크기만 읽고 디코딩하지 않으므로 이걸로 충분하다.
 * 실제 픽셀이 필요한 테스트에는 쓸 수 없다.
 */
function pngStub(w: number, h: number, size: number): Uint8Array {
  const buf = new Uint8Array(Math.max(size, 24));
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const dv = new DataView(buf.buffer);
  dv.setUint32(8, 13); // IHDR 길이
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return buf;
}

/**
 * 이력서 DOCX 픽스처 — 증명사진 선택 로직 검증용. 이미지 배치를 직접 통제한다.
 *
 * `body` = 본문 등장 순서, `zipOrder` = ZIP 엔트리 저장 순서(생략 시 body 와 동일).
 * 실제 이력서에서 이 둘은 일치하지 않는다 — 실측한 이력서는 첫 ZIP 엔트리가 image3,
 * 본문 첫 이미지가 image11 이었다. 그래서 순서를 따로 받는다.
 */
export function makeResumeDocx(body: DocxImage[], zipOrder?: string[]): Buffer {
  const rid = (i: number) => `rId${i + 10}`;
  const drawings = body
    .map(
      (_, i) =>
        `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData>` +
        `<pic:pic><pic:blipFill><a:blip r:embed="${rid(i)}"/></pic:blipFill></pic:pic>` +
        `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    )
    .join("");
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${drawings}</w:body></w:document>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    body
      .map(
        (img, i) =>
          `<Relationship Id="${rid(i)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.file}"/>`
      )
      .join("") +
    `</Relationships>`;

  // 키 삽입 순서가 곧 ZIP 엔트리 순서 (문자열 키라 JS 객체가 순서를 보존한다)
  const files: Record<string, Uint8Array> = {};
  for (const name of zipOrder ?? body.map((b) => b.file)) {
    const img = body.find((b) => b.file === name);
    if (img) files[`word/media/${img.file}`] = pngStub(img.w, img.h, img.bytes ?? 4096);
  }
  files["word/document.xml"] = strToU8(document);
  files["word/_rels/document.xml.rels"] = strToU8(rels);
  return Buffer.from(zipSync(files));
}

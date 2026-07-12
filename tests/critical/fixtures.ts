/**
 * 이력서 PDF 픽스처 — pdfkit 으로 실행 시 생성 (바이너리 커밋 회피).
 * pdf-parse 가 30자+ 텍스트를 추출할 수 있는 실제 PDF 임을 사전 검증했다.
 */
import PDFDocument from "pdfkit";

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

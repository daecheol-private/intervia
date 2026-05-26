/**
 * A-6 로컬 풀 사이클 테스트용 가상 이력서 PDF 생성.
 * PDFKit 사용 (devDependency).
 *
 * 시나리오: 백엔드 엔지니어 5년차. 마스킹 룰 검증을 위해 일부 한국어 토큰 포함.
 */
import fs from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";

const text = [
  ["Hong Gildong - Backend Engineer", 16, true],
  ["", 12, false],
  ["Email: hong.gildong@example.com", 10, false],
  ["Phone: 010-1234-5678", 10, false],
  ["Education: Seoul National University, Computer Science (2017)", 10, false],
  ["5 years experience in backend systems at scale", 10, false],
  ["", 8, false],
  ["===== Work Experience =====", 12, true],
  ["", 4, false],
  ["[1] Kakao Corp. - Backend Engineer", 11, true],
  ["    Period: 2020.03 - 2024.12 (4 years 9 months)", 9, false],
  ["    - Built messaging platform backend (Node.js, Go, MySQL, Redis)", 9, false],
  ["    - Operated chat system processing 100M daily transactions", 9, false],
  ["    - Designed and implemented gRPC microservices architecture", 9, false],
  ["    - Led chat search migration RDB -> Elasticsearch,", 9, false],
  ["      improved p99 latency 1.2s -> 80ms (15x improvement)", 9, false],
  ["    - Built Kafka-based event pipeline (500M messages/day)", 9, false],
  ["    - Code review and mentoring for 3 junior engineers", 9, false],
  ["", 4, false],
  ["[2] Naver Corp. - Junior Backend Engineer", 11, true],
  ["    Period: 2018.01 - 2020.02 (2 years 1 month)", 9, false],
  ["    - Built search result API (Java, Spring Boot)", 9, false],
  ["    - Implemented ad matching algorithm backend", 9, false],
  ["    - Introduced Redis caching strategy, reduced latency 40%", 9, false],
  ["", 8, false],
  ["===== Skills =====", 12, true],
  ["", 4, false],
  ["Languages: Go, Node.js (TypeScript), Java, Python", 9, false],
  ["Database: MySQL, PostgreSQL, Redis, Elasticsearch, Kafka", 9, false],
  ["Cloud: AWS (EC2, RDS, ECS), Kubernetes basics", 9, false],
  ["DevOps: Docker, GitLab CI, Datadog monitoring", 9, false],
  ["", 8, false],
  ["===== Major Projects =====", 12, true],
  ["", 4, false],
  ["- KakaoTalk chat room search migration (2023) - 15x latency improvement", 9, false],
  ["- Real-time ad bidding system (2022) - 500K bids/sec throughput", 9, false],
  ["- gRPC migration project (2021) - migrated 7 services REST -> gRPC", 9, false],
  ["", 8, false],
  ["===== Certifications =====", 12, true],
  ["", 4, false],
  ["- AWS Certified Solutions Architect Associate (2023)", 9, false],
  ["- Engineer Information Processing (2018)", 9, false],
  ["", 8, false],
  ["===== Motivation =====", 12, true],
  ["", 4, false],
  ["Spent 5 years owning backend reliability and performance at scale.", 9, false],
  ["Now seeking smaller team where I can build products from idea stage.", 9, false],
];

const doc = new PDFDocument({ size: "A4", margin: 50 });
const chunks = [];
doc.on("data", (c) => chunks.push(c));
const done = new Promise((resolve) => doc.on("end", resolve));

text.forEach(([line, size, bold]) => {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).text(line);
});

doc.end();
await done;
const pdfBuf = Buffer.concat(chunks);

const outDir = path.join(process.cwd(), "test-fixtures");
await fs.mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "test-resume-hong.pdf");
await fs.writeFile(outPath, pdfBuf);
console.log(`✅ 생성됨: ${outPath} (${pdfBuf.length} bytes)`);

// pdf-parse 로 검증
const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
const r = await pdfParse(pdfBuf);
console.log(`✅ pdf-parse 통과: ${r.numpages} 페이지, 텍스트 ${r.text.length}자`);
console.log(`   첫 150자: ${r.text.slice(0, 150).replace(/\n/g, " | ")}`);
console.log("\n후보자: Hong Gildong (홍길동), 백엔드 엔지니어 5년차 (Kakao·Naver)");
console.log(`업로드 경로: ${outPath}`);

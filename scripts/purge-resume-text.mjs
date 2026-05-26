import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function main() {
  console.log(`DB: ${url}`);
  console.log("기존 후보자의 마스킹 안된 원본 텍스트(resume_text)를 비웁니다.");

  const before = await db.execute(
    `SELECT COUNT(*) AS n FROM candidates WHERE resume_text != ''`
  );
  const n = Number(before.rows[0]?.n ?? 0);
  console.log(`  대상: ${n}건`);

  if (n > 0) {
    await db.execute(
      `UPDATE candidates SET resume_text = '' WHERE resume_text != ''`
    );
    console.log("  ✓ 비움 완료");
  }
  console.log("✅ done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

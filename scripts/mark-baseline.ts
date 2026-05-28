/**
 * drizzle/0000_*.sql 베이스라인을 "이미 적용됨" 으로 마킹.
 *
 * 사용처:
 *   db:push 로 운영해온 DB 에 처음 drizzle migration 추적을 도입할 때.
 *   실제 baseline SQL 은 실행하지 않고 (이미 적용된 상태), tracking 테이블에만 row 삽입.
 *
 * 동작:
 *   1. __drizzle_migrations 테이블 생성 (drizzle 형식)
 *   2. drizzle/meta/_journal.json 의 모든 entry 에 대해
 *      - sql 파일 읽기
 *      - drizzle 방식으로 hash 계산 (statement-breakpoint 로 split → \n 으로 join → sha256)
 *      - __drizzle_migrations 에 hash 가 없으면 insert
 *
 * 사용 — Turso:
 *   $env:TURSO_DATABASE_URL = "libsql://..."
 *   $env:TURSO_AUTH_TOKEN   = "..."
 *   npx tsx scripts/mark-baseline.ts
 *
 * 사용 — 로컬:
 *   npx tsx scripts/mark-baseline.ts
 */
import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

console.log(`\n🎯 Target DB: ${url}\n`);

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

function computeDrizzleHash(sqlContent: string): string {
  // drizzle migrator: split by '--> statement-breakpoint', trim each, join by '\n', sha256.
  const queries = sqlContent
    .split("--> statement-breakpoint")
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
  return createHash("sha256").update(queries.join("\n")).digest("hex");
}

async function main(): Promise<void> {
  // 1) 추적 테이블 생성 (drizzle 형식 — libsql/sqlite 동일)
  await db.execute(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    created_at NUMERIC
  )`);
  console.log("✓ __drizzle_migrations table ready");

  // 2) 저널 읽기
  const journalPath = path.resolve("./drizzle/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  console.log(`✓ journal: ${journal.entries.length} entry(ies)`);

  // 3) 기존 적용된 hash 조회
  const existing = await db.execute(`SELECT hash FROM __drizzle_migrations`);
  const have = new Set(existing.rows.map((r) => String(r.hash)));

  // 4) 각 entry 마다 hash 계산 후 없으면 insert
  let inserted = 0;
  let skipped = 0;
  for (const entry of journal.entries) {
    const sqlPath = path.resolve(`./drizzle/${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, "utf8");
    const hash = computeDrizzleHash(sql);
    if (have.has(hash)) {
      console.log(`  ⏭️  already marked: ${entry.tag} (${hash.slice(0, 12)}…)`);
      skipped++;
      continue;
    }
    await db.execute({
      sql: `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
      args: [hash, entry.when],
    });
    console.log(`  ✅ marked applied: ${entry.tag} (${hash.slice(0, 12)}…)`);
    inserted++;
  }

  console.log(`\n결과 — 삽입: ${inserted}, 스킵: ${skipped}\n`);
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

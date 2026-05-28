/**
 * Drizzle migration 적용 러너.
 * drizzle/*.sql 중 __drizzle_migrations 에 없는 것만 순서대로 실행.
 *
 * 사용 — Turso (운영):
 *   $env:TURSO_DATABASE_URL = "libsql://..."
 *   $env:TURSO_AUTH_TOKEN   = "..."
 *   npm run db:migrate
 *
 * 사용 — 로컬:
 *   $env:LOCAL_DB = "1"
 *   npm run db:migrate
 *
 * 워크플로우:
 *   1. lib/schema.ts 수정
 *   2. npm run db:generate         ← drizzle/NNNN_*.sql 새로 생성
 *   3. 생성된 SQL 검토 후 커밋
 *   4. npm run db:migrate          ← 로컬 적용
 *   5. (배포 후) Turso env 로 db:migrate 실행해서 운영 적용
 */
import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

const isTurso = url.startsWith("libsql://") || url.startsWith("wss://");
const target = isTurso ? "Turso (운영)" : "로컬 SQLite";

console.log(`\n🎯 Target DB: ${url}  [${target}]\n`);

const client = createClient({ url, authToken });
const db = drizzle(client);

async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✅ migrations applied (or no new migrations)\n");
}

main().catch((e) => {
  console.error("❌ migration failed:", e);
  process.exit(1);
});

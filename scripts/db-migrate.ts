/**
 * Drizzle migration 적용 러너 (멱등 — idempotent).
 *
 * drizzle/meta/_journal.json 순서대로, __drizzle_migrations 에 기록되지 않은
 * 마이그레이션만 statement 단위로 실행한다.
 *
 * ⚠️ 왜 표준 migrate() 대신 커스텀 러너인가:
 *   운영 Turso 는 초기 schema 일부가 `db:push`(setup-fresh-db) 로 선반영된 이력이
 *   있어, 표준 migrator 가 ADD COLUMN / CREATE TABLE 을 재실행하면 "duplicate column
 *   name" / "already exists" 로 빌드가 깨진다. SQLite 는 ADD COLUMN 에 IF NOT EXISTS
 *   를 지원하지 않으므로 SQL 만으로는 멱등화가 불가능 → 러너에서 "이미 존재" 류
 *   에러만 선별적으로 무시한다. 그 외 에러는 그대로 throw 하여 배포를 실패시킨다.
 *
 * 사용 — Turso (운영):
 *   $env:TURSO_DATABASE_URL = "libsql://..."; $env:TURSO_AUTH_TOKEN = "..."; npm run db:migrate
 * 사용 — 로컬:
 *   $env:LOCAL_DB = "1"; npm run db:migrate
 */
import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

const isTurso = url.startsWith("libsql://") || url.startsWith("wss://");
const target = isTurso ? "Turso (운영)" : "로컬 SQLite";
const FOLDER = "./drizzle";

console.log(`\n🎯 Target DB: ${url}  [${target}]\n`);

const client = createClient({ url, authToken });

// ───────────────────────────────────────────────────────────────────────────
// 🚨 운영 데이터 보호 가드 (2026-06-13 cascade 연쇄삭제 사고 후 추가. CLAUDE.md 절대 규칙)
//
// 1) destructive statement (DROP TABLE / DELETE FROM / DROP COLUMN) 는
//    ALLOW_DESTRUCTIVE_MIGRATION=1 없이 실행 거부. rebuild 보조용 `__` 접두
//    임시 테이블 DROP 만 예외. 이 게이트의 우회·완화·삭제 금지.
// 2) DROP TABLE 직전마다 PRAGMA foreign_keys 재확인. Turso(hrana-over-HTTP)는
//    연결 재수립 시 세션 PRAGMA 가 리셋되므로 "마이그레이션 첫머리에서 OFF 했다"
//    는 가정이 깨진다. FK ON 상태의 DROP 은 암묵 DELETE 가 자식 ON DELETE
//    CASCADE 를 발동시켜 운영 데이터를 연쇄 삭제한다 (실제 사고 사례).
// ───────────────────────────────────────────────────────────────────────────
function destructiveKind(stmt: string): string | null {
  const drop = stmt.match(/^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)/i);
  if (drop) return drop[1].startsWith("__") ? null : `DROP TABLE ${drop[1]}`;
  if (/^\s*DELETE\s+FROM/i.test(stmt)) return "DELETE FROM";
  if (/^\s*ALTER\s+TABLE[\s\S]+?\bDROP\s+COLUMN\b/i.test(stmt)) return "DROP COLUMN";
  return null;
}

async function guardStatement(stmt: string): Promise<void> {
  const kind = destructiveKind(stmt);
  if (kind && process.env.ALLOW_DESTRUCTIVE_MIGRATION !== "1") {
    throw new Error(
      `🚨 destructive statement 차단: ${kind}\n` +
        `운영 데이터 보호 규칙(CLAUDE.md)에 따라 사용자 명시 승인 없이 실행할 수 없다.\n` +
        `승인 후 진행하려면: 백업 확보(turso db dump + PITR 시점 기록) → ` +
        `ALLOW_DESTRUCTIVE_MIGRATION=1 설정(Vercel 배포면 env 에 임시 추가) → 재실행.`
    );
  }
  if (/^\s*DROP\s+TABLE/i.test(stmt)) {
    const fk = await client.execute("PRAGMA foreign_keys");
    const fkOn = Number(Object.values(fk.rows[0] ?? {})[0] ?? 1) === 1;
    if (fkOn) {
      throw new Error(
        `🚨 FK 강제 ON 상태에서 DROP TABLE 차단.\n` +
          `암묵 DELETE 가 자식 ON DELETE CASCADE 를 발동시켜 연쇄 삭제된다 (2026-06-13 사고).\n` +
          `Turso 는 PRAGMA foreign_keys=OFF 세션 유지를 보장하지 않으므로, 부모 테이블 재생성은\n` +
          `vercel-build 자동 적용 금지 — GOTCHAS §8-1 의 수동 절차를 따를 것.`
      );
    }
  }
}

// "이미 적용된 객체" 를 뜻하는, 무시해도 안전한 멱등 에러만 매칭.
function isIdempotentError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("duplicate column name") ||
    m.includes("already exists") ||
    // 인덱스 중복 등 일부 드라이버 표현
    m.includes("already an index")
  );
}

type JournalEntry = { idx: number; when: number; tag: string };

async function main(): Promise<void> {
  // drizzle 표준과 호환되는 추적 테이블 (향후 표준 migrate() 와도 공존 가능).
  await client.execute(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       hash TEXT NOT NULL,
       created_at NUMERIC
     )`
  );

  const journalRaw = readFileSync(join(FOLDER, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(journalRaw) as { entries: JournalEntry[] };
  const entries = [...journal.entries].sort((a, b) => a.when - b.when);

  // 이미 적용된 최신 created_at (drizzle 와 동일하게 timestamp 기준으로 판단).
  const last = await client.execute(
    `SELECT MAX(created_at) AS m FROM __drizzle_migrations`
  );
  const lastApplied = Number(last.rows[0]?.m ?? 0);

  let appliedCount = 0;
  let skippedStmts = 0;

  for (const entry of entries) {
    if (entry.when <= lastApplied) continue; // 이미 적용됨

    const sqlPath = join(FOLDER, `${entry.tag}.sql`);
    const sql = readFileSync(sqlPath, "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log(`▶ ${entry.tag} (${statements.length} statements)`);
    for (const stmt of statements) {
      await guardStatement(stmt);
      try {
        await client.execute(stmt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isIdempotentError(msg)) {
          skippedStmts++;
          console.log(`  ⏭  이미 존재 — 건너뜀: ${msg.split("\n")[0]}`);
          continue;
        }
        console.error(`  ❌ 실패한 statement:\n${stmt}\n`);
        throw e;
      }
    }

    const hash = createHash("sha256").update(sql).digest("hex");
    await client.execute({
      sql: `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
      args: [hash, entry.when],
    });
    appliedCount++;
  }

  if (appliedCount === 0) {
    console.log("✅ 적용할 새 마이그레이션 없음\n");
  } else {
    console.log(
      `✅ 마이그레이션 ${appliedCount}건 적용 완료 (멱등 건너뜀 ${skippedStmts}건)\n`
    );
  }
}

main().catch((e) => {
  console.error("❌ migration failed:", e);
  process.exit(1);
});

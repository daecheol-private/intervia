#!/usr/bin/env node
/**
 * 마이그레이션 안전 검사 — .git/hooks/pre-push 가 main push 전에 호출 (단독 실행도 가능).
 *
 * 1) 인자로 받은 drizzle SQL 파일에서 destructive statement 탐지
 *    (DROP TABLE / DELETE FROM / DROP COLUMN / PRAGMA foreign_keys=OFF 재생성 패턴)
 *    → 발견 시 exit 1. CLAUDE.md 절대 규칙(사용자 승인 + 백업) 절차를 따라야 한다.
 * 2) drizzle/meta/_journal.json 전체를 스크래치 SQLite 에 처음부터 적용하는 dry-run
 *    → SQL 오류 시 exit 1 (vercel-build 의 db-migrate 가 운영에서 실패하기 전에 잡는다).
 *
 * 원격(Turso)에는 절대 연결하지 않는다 — env 도 로드하지 않는다.
 * 이 파일은 가드 동결 대상: Claude 수정 금지 (CLAUDE.md 절대 규칙 §8).
 *
 * 사용: node scripts/check-migration-safety.mjs [drizzle/00xx_*.sql ...]
 */
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const files = process.argv.slice(2);
let failed = false;

const statementsOf = (sql) =>
  sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

// scripts/db-migrate.ts 의 destructiveKind 와 동일 기준 유지.
function destructiveKind(stmt) {
  const drop = stmt.match(/^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)/i);
  if (drop) return drop[1].startsWith("__") ? null : `DROP TABLE ${drop[1]}`;
  if (/^\s*DELETE\s+FROM/i.test(stmt)) return "DELETE FROM";
  if (/^\s*ALTER\s+TABLE[\s\S]+?\bDROP\s+COLUMN\b/i.test(stmt)) return "DROP COLUMN";
  return null;
}

// ── 1) destructive 스캔 (push 에 새로 포함된 파일만) ─────────────────────────
for (const f of files) {
  let sql;
  try {
    sql = readFileSync(f, "utf8");
  } catch {
    console.error(`❌ ${f}: 파일을 읽을 수 없음`);
    failed = true;
    continue;
  }
  if (/PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(sql)) {
    console.error(
      `❌ ${f}: PRAGMA foreign_keys=OFF — 테이블 재생성 패턴.\n` +
        `   Turso 는 FK OFF 세션 유지를 보장하지 않아 DROP 이 CASCADE 연쇄삭제를 유발한다 (2026-06-13 사고).\n` +
        `   vercel-build 자동 적용 금지 — GOTCHAS §8-1 수동 절차 + 사용자 승인 + 백업 필수.`
    );
    failed = true;
  }
  for (const stmt of statementsOf(sql)) {
    const kind = destructiveKind(stmt);
    if (kind) {
      console.error(
        `❌ ${f}: destructive statement — ${kind}\n` +
          `   사용자 승인 + 백업(turso db dump / PITR 시점 기록) 후에만 push (CLAUDE.md 절대 규칙).`
      );
      failed = true;
    } else if (/^\s*UPDATE\s/i.test(stmt)) {
      console.warn(`⚠️  ${f}: UPDATE 포함(데이터 백필) — 운영 행이 의도대로 바뀌는지 확인할 것.`);
    }
  }
}

// ── 2) 전체 journal 스크래치 dry-run ─────────────────────────────────────────
const cacheDir = join("node_modules", ".cache");
mkdirSync(cacheDir, { recursive: true });
const scratch = join(cacheDir, "iv-mig-dryrun.db");
// Windows 는 close() 후에도 파일 락이 남을 수 있어 정리는 best-effort (다음 실행의 사전 정리가 회수).
const rmQuiet = (p) => {
  try {
    rmSync(p, { force: true });
  } catch {}
};
for (const suf of ["", "-wal", "-shm"]) rmQuiet(scratch + suf);

const client = createClient({ url: `file:${scratch.replace(/\\/g, "/")}` });

// 운영 러너(db-migrate.ts)와 동일한 멱등 에러만 허용.
const isIdempotentError = (msg) => {
  const m = msg.toLowerCase();
  return (
    m.includes("duplicate column name") ||
    m.includes("already exists") ||
    m.includes("already an index")
  );
};

try {
  const journal = JSON.parse(readFileSync(join("drizzle", "meta", "_journal.json"), "utf8"));
  const entries = [...journal.entries].sort((a, b) => a.when - b.when);
  for (const entry of entries) {
    const sql = readFileSync(join("drizzle", `${entry.tag}.sql`), "utf8");
    for (const stmt of statementsOf(sql)) {
      try {
        await client.execute(stmt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isIdempotentError(msg)) continue;
        console.error(`❌ dry-run 실패 (${entry.tag}):\n${stmt}\n→ ${msg.split("\n")[0]}`);
        failed = true;
        break;
      }
    }
    if (failed) break;
  }
  if (!failed) console.log(`✅ dry-run: 마이그레이션 ${entries.length}건 스크래치 적용 성공`);
} finally {
  client.close();
  for (const suf of ["", "-wal", "-shm"]) rmQuiet(scratch + suf);
}

if (failed) {
  console.error("\n🚫 마이그레이션 안전 검사 실패 — push 를 중단해야 한다.");
  process.exit(1);
}
console.log("✅ 마이그레이션 안전 검사 통과");

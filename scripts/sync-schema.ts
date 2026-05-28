/**
 * lib/schema.ts 의 모든 테이블·컬럼·인덱스를 대상 DB 와 비교 후
 * 누락된 것을 ADD COLUMN / CREATE INDEX 로 동기화.
 *
 * 안전 정책 (운영용):
 *   - ADDITIVE 만: 컬럼 ADD, INDEX CREATE
 *   - DESTRUCTIVE 금지: DROP COLUMN / DROP TABLE / ALTER TYPE 등 절대 X
 *   - 신규 테이블은 발견 시 표시만 (자동 CREATE X — 별도 결정)
 *   - NOT NULL 컬럼은 DEFAULT 가 있을 때만 안전 추가
 *
 * 사용 — Turso (운영):
 *   $env:TURSO_DATABASE_URL = "libsql://..."
 *   $env:TURSO_AUTH_TOKEN   = "..."
 *   npx tsx scripts/sync-schema.ts
 *
 * 사용 — 로컬 dev:
 *   npx tsx scripts/sync-schema.ts          # → file:./data.db
 */
import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../lib/schema.js";

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

console.log(`\n🎯 Target DB: ${url}\n`);

function columnDefSql(col: ReturnType<typeof getTableConfig>["columns"][number]): string {
  // SQLite 타입 매핑.
  const t = (col as { columnType?: string }).columnType ?? "";
  let sqlType = "TEXT";
  if (t === "SQLiteInteger") sqlType = "INTEGER";
  else if (t === "SQLiteReal") sqlType = "REAL";
  else if (t === "SQLiteBlob") sqlType = "BLOB";

  let s = sqlType;
  const def = (col as { default?: unknown }).default;
  if (col.notNull) {
    if (def !== undefined) {
      // sql`` 표현식은 queryChunks 가짐 → 직접 직렬화 어려움.
      if (typeof def === "string") s += ` NOT NULL DEFAULT '${def.replaceAll("'", "''")}'`;
      else if (typeof def === "number") s += ` NOT NULL DEFAULT ${def}`;
      else if (typeof def === "object" && def !== null && "queryChunks" in def)
        s += ` NOT NULL`; // sql 표현식은 default 빼고 NOT NULL 만
      else s += ` NOT NULL`;
    } else {
      s += ` NOT NULL`;
    }
  } else if (def !== undefined) {
    if (typeof def === "string") s += ` DEFAULT '${def.replaceAll("'", "''")}'`;
    else if (typeof def === "number") s += ` DEFAULT ${def}`;
  }
  return s;
}

async function tableExists(name: string): Promise<boolean> {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const r = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function columnsOf(table: string): Promise<Set<string>> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return new Set(r.rows.map((row) => String(row.name)));
}

async function main(): Promise<void> {
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalIndexAdded = 0;
  const tablesMissing: string[] = [];

  const tables: SQLiteTable[] = [];
  for (const v of Object.values(schema)) {
    if (!v || typeof v !== "object") continue;
    try {
      getTableConfig(v as SQLiteTable);
      tables.push(v as SQLiteTable);
    } catch {
      /* not a sqliteTable instance */
    }
  }

  for (const table of tables) {
    const cfg = getTableConfig(table);
    const tName = cfg.name;

    if (!(await tableExists(tName))) {
      console.log(`📦 Table missing: ${tName}`);
      tablesMissing.push(tName);
      continue;
    }

    const existing = await columnsOf(tName);
    const expected = cfg.columns;
    const missing = expected.filter((c) => !existing.has(c.name));

    if (missing.length === 0) {
      console.log(`✓ ${tName}: ${expected.length} columns OK`);
    } else {
      console.log(`\n📋 ${tName}: ${missing.length} missing column(s)`);
      for (const col of missing) {
        const defSql = columnDefSql(col);
        const sql = `ALTER TABLE ${tName} ADD COLUMN ${col.name} ${defSql}`;
        try {
          await db.execute(sql);
          console.log(`  ✅ added: ${col.name} (${defSql})`);
          totalAdded++;
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e);
          if (/duplicate column|already exists/i.test(msg)) {
            console.log(`  ⏭️  skip (race): ${col.name}`);
            totalSkipped++;
          } else {
            console.error(`  ❌ failed: ${col.name} — ${msg}`);
            console.error(`     SQL: ${sql}`);
            totalFailed++;
          }
        }
      }
    }

    for (const idx of cfg.indexes ?? []) {
      const cfgI = (idx as { config?: { name?: string; columns?: unknown[]; unique?: boolean } })
        .config;
      if (!cfgI?.name) continue;
      const idxName = cfgI.name;
      if (await indexExists(idxName)) continue;
      const cols = (cfgI.columns ?? [])
        .map((c) => (typeof c === "string" ? c : (c as { name?: string })?.name))
        .filter((s): s is string => !!s);
      if (cols.length === 0) continue;
      const unique = cfgI.unique ? "UNIQUE " : "";
      const sql = `CREATE ${unique}INDEX IF NOT EXISTS ${idxName} ON ${tName}(${cols.join(", ")})`;
      try {
        await db.execute(sql);
        console.log(`  ✅ index: ${idxName}`);
        totalIndexAdded++;
      } catch (e) {
        console.error(`  ❌ index failed: ${idxName} — ${(e as Error)?.message ?? e}`);
        totalFailed++;
      }
    }
  }

  console.log(
    `\n결과 — 컬럼 추가: ${totalAdded}, 스킵: ${totalSkipped}, 실패: ${totalFailed}, 인덱스 추가: ${totalIndexAdded}`
  );
  if (tablesMissing.length > 0) {
    console.log(
      `\n⚠️  누락된 테이블 (${tablesMissing.length}): ${tablesMissing.join(", ")}`
    );
    console.log(
      `   → 신규 테이블은 안전을 위해 자동 생성 X. drizzle-kit push 또는 수동 CREATE 필요.`
    );
  }
  console.log();

  if (totalFailed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

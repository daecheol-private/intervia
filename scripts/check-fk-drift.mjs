// FK·인덱스 드리프트 스캔 (읽기 전용): drizzle 최신 스냅샷 vs 실제 DB 비교.
// 사용: LOCAL_DB=1 node scripts/check-fk-drift.mjs (로컬) / 기본 (운영 Turso)
// 배경: GOTCHAS.md §8-1 — push 선반영·ON DELETE 절 누락 드리프트는 db:generate 가 감지 못 함.
import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "node:fs";

const url =
  process.env.TURSO_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "file:./data.db";
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const snapFiles = readdirSync("./drizzle/meta").filter((f) => f.endsWith("_snapshot.json")).sort();
const snap = JSON.parse(readFileSync(`./drizzle/meta/${snapFiles.at(-1)}`, "utf8"));
console.log(`DB: ${url}\n스냅샷: ${snapFiles.at(-1)}\n`);

const fkOn = await client.execute("PRAGMA foreign_keys");
console.log(`PRAGMA foreign_keys = ${JSON.stringify(fkOn.rows[0])}\n`);

const norm = (s) => (s || "no action").toLowerCase();
let driftCount = 0;

for (const [tname, t] of Object.entries(snap.tables)) {
  const expected = Object.values(t.foreignKeys).map((fk) => ({
    from: fk.columnsFrom.join(","),
    table: fk.tableTo,
    to: fk.columnsTo.join(","),
    onDelete: norm(fk.onDelete),
    onUpdate: norm(fk.onUpdate),
  }));
  const res = await client.execute(`PRAGMA foreign_key_list(${tname})`);
  const actual = res.rows.map((r) => ({
    from: r.from,
    table: r.table,
    to: r.to,
    onDelete: norm(r.on_delete),
    onUpdate: norm(r.on_update),
  }));

  for (const e of expected) {
    const a = actual.find((x) => x.from === e.from && x.table === e.table);
    if (!a) {
      driftCount++;
      console.log(`❌ ${tname}.${e.from} → ${e.table}: DB에 FK 자체가 없음 (스키마: ON DELETE ${e.onDelete})`);
    } else if (a.onDelete !== e.onDelete || a.onUpdate !== e.onUpdate) {
      driftCount++;
      console.log(`❌ ${tname}.${e.from} → ${e.table}: 스키마 ON DELETE ${e.onDelete} / DB ON DELETE ${a.onDelete}`);
    }
  }
  for (const a of actual) {
    if (!expected.find((e) => e.from === a.from && e.table === a.table)) {
      driftCount++;
      console.log(`❌ ${tname}.${a.from} → ${a.table}: DB에만 있는 FK (스키마에 없음)`);
    }
  }

  const expIdx = Object.values(t.indexes || {}).map((i) => ({
    name: i.name,
    unique: !!i.isUnique,
  }));
  const idxRes = await client.execute(`PRAGMA index_list(${tname})`);
  const actIdx = idxRes.rows.filter((r) => r.origin === "c");
  for (const e of expIdx) {
    const a = actIdx.find((x) => x.name === e.name);
    if (!a) {
      driftCount++;
      console.log(`❌ ${tname}: 인덱스 ${e.name} (unique=${e.unique}) DB에 없음`);
    } else if (Boolean(Number(a.unique)) !== e.unique) {
      driftCount++;
      console.log(`❌ ${tname}: ${e.name} unique 불일치 (스키마 ${e.unique} / DB ${Boolean(Number(a.unique))})`);
    }
  }
  for (const a of actIdx) {
    if (!expIdx.find((e) => e.name === a.name)) {
      driftCount++;
      console.log(`❌ ${tname}: DB에만 있는 인덱스 ${a.name}`);
    }
  }
}

console.log(driftCount === 0 ? "✅ FK·인덱스 드리프트 없음" : `\n총 ${driftCount}건 드리프트`);

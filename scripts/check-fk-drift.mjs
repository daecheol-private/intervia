// 일회성 FK 드리프트 스캔: drizzle 최신 스냅샷 vs 실제 DB의 PRAGMA foreign_key_list 비교.
// 사용: LOCAL_DB=1 node scripts/check-fk-drift.mjs (로컬) / 기본 (운영 Turso, 읽기 전용)
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
}

console.log(driftCount === 0 ? "✅ FK 드리프트 없음" : `\n총 ${driftCount}건 드리프트`);

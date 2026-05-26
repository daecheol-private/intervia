import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function hasCol(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}

async function ensure(table, col, type) {
  if (await hasCol(table, col)) {
    console.log(`  = ${table}.${col} already exists`);
    return;
  }
  console.log(`  + ALTER ${table} ADD ${col} ${type}`);
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}

async function main() {
  console.log(`DB: ${url}`);
  await ensure("users", "terms_accepted_ip", "TEXT");
  await ensure("users", "terms_accepted_ua", "TEXT");
  await ensure("users", "privacy_accepted_ip", "TEXT");
  await ensure("users", "privacy_accepted_ua", "TEXT");
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

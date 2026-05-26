import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function tableHasColumn(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}

async function ensure(col, ddl) {
  if (!(await tableHasColumn("sessions", col))) {
    console.log(`  + ALTER sessions ADD ${col}`);
    await db.execute(`ALTER TABLE sessions ADD COLUMN ${ddl}`);
  } else {
    console.log(`  = sessions.${col} already exists`);
  }
}

async function main() {
  console.log(`DB: ${url}`);
  await ensure("ip", "ip TEXT");
  await ensure("user_agent", "user_agent TEXT");
  await ensure("last_seen_at", "last_seen_at TEXT");
  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

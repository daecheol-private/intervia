import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function tableHasColumn(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}

async function main() {
  console.log(`DB: ${url}`);

  if (!(await tableHasColumn("users", "email_verified_at"))) {
    console.log("  + ALTER users ADD email_verified_at");
    await db.execute(
      `ALTER TABLE users ADD COLUMN email_verified_at TEXT`
    );
    // 기존 사용자는 모두 verified로 간주 (createdAt 기준)
    await db.execute(
      `UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL`
    );
    console.log("  + backfilled existing users as verified");
  } else {
    console.log("  = users.email_verified_at already exists");
  }

  await db.execute(`CREATE TABLE IF NOT EXISTS email_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id)`
  );
  console.log("  ✓ table email_verifications");

  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ migration failed:", e);
  process.exit(1);
});

import "./_load-env.mjs";
import { createClient } from "@libsql/client";

// 신규 DB 셋업 시 첫 법인 — 환경변수 우선, 미설정 시 placeholder.
// 운영에선 사용자가 setup-fresh-db 후 회원가입으로 첫 법인을 만들기 때문에 이 값은 거의 안 쓰임.
const DEFAULT_ORG_NAME = process.env.DEFAULT_ORG_NAME ?? "default-org";
const DEFAULT_ORG_DOMAIN = process.env.DEFAULT_ORG_DOMAIN ?? "default-org.local";
const INITIAL_TOKEN_GRANT = 10000;
const DEFAULT_PRICING = [
  ["job_post", 10],
  ["resume_upload", 5],
  ["interview", 30],
];

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function tableHasColumn(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}

async function ensureColumn(table, col, ddl) {
  if (!(await tableHasColumn(table, col))) {
    console.log(`  + ALTER ${table} ADD ${col}`);
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

async function ensureTable(name, ddl) {
  await db.execute(ddl);
  console.log(`  ✓ table ${name}`);
}

async function main() {
  console.log(`DB: ${url}`);

  console.log("[1/6] Ensure new tables");
  await ensureTable(
    "organizations",
    `CREATE TABLE IF NOT EXISTS organizations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       biz_registration_no TEXT,
       email_domain TEXT,
       created_by_user_id INTEGER,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_org_email_domain ON organizations(email_domain)`
  );

  await ensureTable(
    "org_join_requests",
    `CREATE TABLE IF NOT EXISTS org_join_requests (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
       user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       status TEXT NOT NULL DEFAULT 'pending',
       decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
       decided_at TEXT,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await ensureTable(
    "token_wallets",
    `CREATE TABLE IF NOT EXISTS token_wallets (
       org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
       balance INTEGER NOT NULL DEFAULT 0,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await ensureTable(
    "token_ledger",
    `CREATE TABLE IF NOT EXISTS token_ledger (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
       delta INTEGER NOT NULL,
       reason TEXT NOT NULL,
       ref_type TEXT,
       ref_id INTEGER,
       balance_after INTEGER NOT NULL,
       created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
       memo TEXT,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await ensureTable(
    "token_pricing",
    `CREATE TABLE IF NOT EXISTS token_pricing (
       feature_key TEXT PRIMARY KEY,
       cost INTEGER NOT NULL,
       updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  await ensureTable(
    "payment_orders",
    `CREATE TABLE IF NOT EXISTS payment_orders (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
       amount_krw INTEGER NOT NULL,
       tokens INTEGER NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending',
       provider TEXT,
       provider_ref TEXT,
       created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`
  );

  console.log("[2/6] Add new columns to existing tables");
  await ensureColumn("users", "org_id", "org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL");
  await ensureColumn("users", "role", "role TEXT NOT NULL DEFAULT 'member'");
  await ensureColumn("users", "status", "status TEXT NOT NULL DEFAULT 'active'");
  await ensureColumn("job_postings", "org_id", "org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE");
  await ensureColumn("candidates", "org_id", "org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE");

  console.log("[3/6] Ensure default organization");
  let orgRow = (
    await db.execute({
      sql: "SELECT id FROM organizations WHERE name = ?",
      args: [DEFAULT_ORG_NAME],
    })
  ).rows[0];
  if (!orgRow) {
    const r = await db.execute({
      sql: "INSERT INTO organizations(name, email_domain) VALUES (?, ?)",
      args: [DEFAULT_ORG_NAME, DEFAULT_ORG_DOMAIN],
    });
    orgRow = { id: Number(r.lastInsertRowid) };
    console.log(`  + organization id=${orgRow.id}`);
  } else {
    console.log(`  = organization id=${orgRow.id} (existing)`);
  }
  const orgId = Number(orgRow.id);

  console.log("[4/6] Backfill users role/org");
  // system_admin: previously is_admin=1
  await db.execute(
    `UPDATE users SET role = 'system_admin' WHERE is_admin = 1 AND (role IS NULL OR role = 'member')`
  );
  // non-admin existing users → default org member
  await db.execute({
    sql: `UPDATE users SET org_id = ? WHERE org_id IS NULL AND is_admin = 0`,
    args: [orgId],
  });
  // promote oldest non-admin user to org_admin if no org_admin exists
  const adminExists = (
    await db.execute({
      sql: "SELECT id FROM users WHERE org_id = ? AND role = 'org_admin' LIMIT 1",
      args: [orgId],
    })
  ).rows[0];
  if (!adminExists) {
    const first = (
      await db.execute({
        sql: "SELECT id FROM users WHERE org_id = ? AND is_admin = 0 ORDER BY id ASC LIMIT 1",
        args: [orgId],
      })
    ).rows[0];
    if (first) {
      await db.execute({
        sql: "UPDATE users SET role = 'org_admin' WHERE id = ?",
        args: [first.id],
      });
      console.log(`  + promoted user id=${first.id} to org_admin of ${DEFAULT_ORG_NAME}`);
    }
  }

  console.log("[5/6] Backfill org_id on jobs/candidates");
  await db.execute({
    sql: `UPDATE job_postings SET org_id = ? WHERE org_id IS NULL`,
    args: [orgId],
  });
  await db.execute({
    sql: `UPDATE candidates SET org_id = ? WHERE org_id IS NULL`,
    args: [orgId],
  });

  console.log("[6/6] Seed wallet and pricing");
  const walletRow = (
    await db.execute({
      sql: "SELECT balance FROM token_wallets WHERE org_id = ?",
      args: [orgId],
    })
  ).rows[0];
  if (!walletRow) {
    await db.execute({
      sql: "INSERT INTO token_wallets(org_id, balance) VALUES (?, ?)",
      args: [orgId, INITIAL_TOKEN_GRANT],
    });
    await db.execute({
      sql: `INSERT INTO token_ledger(org_id, delta, reason, balance_after, memo)
            VALUES (?, ?, 'admin_adjust', ?, 'initial migration grant')`,
      args: [orgId, INITIAL_TOKEN_GRANT, INITIAL_TOKEN_GRANT],
    });
    console.log(`  + wallet ${INITIAL_TOKEN_GRANT}`);
  } else {
    console.log(`  = wallet exists (balance=${walletRow.balance})`);
  }

  for (const [key, cost] of DEFAULT_PRICING) {
    await db.execute({
      sql: `INSERT INTO token_pricing(feature_key, cost) VALUES (?, ?)
            ON CONFLICT(feature_key) DO NOTHING`,
      args: [key, cost],
    });
  }
  console.log(`  + pricing seeded`);

  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ migration failed:", e);
  process.exit(1);
});

import "./_load-env.mjs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

async function hasCol(table, col) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.some((row) => row.name === col);
}
async function tableExists(name) {
  const r = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return r.rows.length > 0;
}

async function main() {
  console.log(`DB: ${url}`);

  // organizations.office_address
  if (!(await hasCol("organizations", "office_address"))) {
    console.log("  + ALTER organizations ADD office_address");
    await db.execute(`ALTER TABLE organizations ADD COLUMN office_address TEXT`);
  } else {
    console.log("  = organizations.office_address already exists");
  }
  if (!(await hasCol("organizations", "office_address_detail"))) {
    console.log("  + ALTER organizations ADD office_address_detail");
    await db.execute(
      `ALTER TABLE organizations ADD COLUMN office_address_detail TEXT`
    );
  } else {
    console.log("  = organizations.office_address_detail already exists");
  }

  // interview_schedules table
  if (!(await tableExists("interview_schedules"))) {
    console.log("  + CREATE interview_schedules");
    await db.execute(`
      CREATE TABLE interview_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
        org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        round TEXT NOT NULL DEFAULT 'round1',
        access_token TEXT NOT NULL UNIQUE,
        proposed_slots TEXT NOT NULL,
        mode_online INTEGER NOT NULL DEFAULT 1,
        address TEXT,
        address_detail TEXT,
        selected_slot TEXT,
        counter_slots TEXT,
        candidate_note TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        proposed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at TEXT NOT NULL,
        responded_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.execute(
      `CREATE INDEX idx_interview_schedules_candidate ON interview_schedules(candidate_id, status)`
    );
    await db.execute(
      `CREATE INDEX idx_interview_schedules_org_status ON interview_schedules(org_id, status)`
    );
  } else {
    console.log("  = interview_schedules already exists");
  }

  console.log("✅ migration done");
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});

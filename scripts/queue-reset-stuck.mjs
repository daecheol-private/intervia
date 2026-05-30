import "./_load-env.mjs";
import { createClient } from "@libsql/client";

// 멈춘(processing) 좀비 job 을 queued 로 리셋. lockedAt 이 NaN/오래된 것 모두.
// 사용법: node scripts/queue-reset-stuck.mjs
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient(url ? { url, authToken } : { url: "file:./data.db" });

console.log("DB:", url ? "Turso(운영)" : "file(로컬)");

const before = await client.execute(
  "SELECT COUNT(*) c FROM screening_jobs WHERE status='processing'"
);
console.log("processing(멈춤) 건수:", before.rows[0].c);

const r = await client.execute({
  sql: `UPDATE screening_jobs
        SET status='queued', locked_at=NULL, locked_by=NULL, not_before=NULL
        WHERE status='processing'`,
  args: [],
});
console.log("→ queued 로 리셋:", r.rowsAffected);

const after = await client.execute(
  "SELECT status, COUNT(*) c FROM screening_jobs GROUP BY status ORDER BY c DESC"
);
console.log("\n=== 리셋 후 status 분포 ===");
for (const x of after.rows) console.log(` ${x.status}: ${x.c}`);

process.exit(0);

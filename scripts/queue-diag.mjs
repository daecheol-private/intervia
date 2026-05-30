import "./_load-env.mjs";
import { createClient } from "@libsql/client";

// 운영 DB 큐 상태 진단 (읽기 전용).
// 사용법: node scripts/queue-diag.mjs        → 운영(.env.production.local)
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient(url ? { url, authToken } : { url: "file:./data.db" });

console.log("DB:", url ? "Turso(운영)" : "file(로컬)");

const byStatus = await client.execute(
  "SELECT status, COUNT(*) c FROM screening_jobs GROUP BY status ORDER BY c DESC"
);
console.log("\n=== screening_jobs status 분포 ===");
for (const r of byStatus.rows) console.log(` ${r.status}: ${r.c}`);

const proc = await client.execute(
  `SELECT id, candidate_id, status, attempts, locked_at, locked_by, last_error
   FROM screening_jobs WHERE status IN ('processing','queued','paused') ORDER BY id DESC LIMIT 40`
);
console.log("\n=== queued/processing/paused 상세 (최신 40) ===");
const now = Date.now();
for (const r of proc.rows) {
  const lockAgeS = r.locked_at
    ? Math.round((now - new Date(String(r.locked_at).replace(" ", "T") + "Z").getTime()) / 1000)
    : null;
  console.log(
    ` job#${r.id} cand#${r.candidate_id} [${r.status}] att=${r.attempts}` +
      (lockAgeS != null ? ` lockAge=${lockAgeS}s` : "") +
      (r.last_error ? ` err="${String(r.last_error).slice(0, 90)}"` : "")
  );
}

const cand = await client.execute(
  `SELECT c.id, c.name, c.screening_score IS NOT NULL done,
          COALESCE(LENGTH(c.resume_masked_text),0) masked_len
   FROM candidates c
   JOIN screening_jobs j ON j.candidate_id = c.id
   WHERE j.status IN ('processing','queued','paused')
   ORDER BY c.id DESC LIMIT 40`
);
console.log("\n=== 진행중 후보자 파싱 상태 ===");
for (const r of cand.rows) {
  console.log(
    ` cand#${r.id} ${r.name} masked_len=${r.masked_len} ${r.masked_len >= 30 ? "(파싱됨)" : "(미파싱=분석중)"}`
  );
}

// 지갑 잔액 (paused 원인 점검)
const wallet = await client.execute(
  `SELECT o.id org_id, o.name, w.balance
   FROM organizations o LEFT JOIN token_wallets w ON w.org_id = o.id
   ORDER BY o.id`
);
console.log("\n=== 법인 지갑 잔액 ===");
for (const r of wallet.rows) console.log(` org#${r.org_id} ${r.name}: balance=${r.balance}`);

process.exit(0);

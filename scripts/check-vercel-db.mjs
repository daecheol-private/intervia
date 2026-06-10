/**
 * intervia.kr(Vercel)이 "실제로" 쓰는 DB를 확인 — READ ONLY.
 *
 * 1) 먼저 Vercel 운영 env 를 그대로 끌어온다:
 *      vercel env pull .env.vercel-prod --environment=production
 * 2) 실행:
 *      node scripts/check-vercel-db.mjs                 (기본 .env.vercel-prod)
 *      node scripts/check-vercel-db.mjs .env.production.local   (비교용)
 *
 * .env.production.local 의 TURSO host 와 Vercel 의 TURSO host 가 다르면,
 * 그게 바로 "내가 본 DB ≠ 운영이 쓰는 DB" 의 증거다.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const envPath = process.argv[2] || ".env.vercel-prod";
const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const url = env.TURSO_DATABASE_URL;
console.log(`[${envPath}]`);
console.log("  TURSO host:", url ? new URL(url.replace(/^libsql:/, "https:")).host : "(none)");
console.log("  SYSTEM_ADMIN_EMAIL:", env.SYSTEM_ADMIN_EMAIL ?? "(none)");

const db = createClient({ url, authToken: env.TURSO_AUTH_TOKEN });

const u = await db.execute(
  "SELECT id,email,name,role,status FROM users WHERE role='system_admin' OR email LIKE '%@company-a.test' ORDER BY id"
);
console.log(`\n  system_admin / company-a.test 행 (${u.rows.length}):`);
for (const x of u.rows) console.log(`    #${x.id} ${x.role} ${x.status} ${x.email} | ${x.name}`);

const a = await db.execute(
  "SELECT created_at, action, resource_id, metadata FROM audit_logs " +
    "WHERE action LIKE 'password_reset%' OR action='user.password_reset_email' ORDER BY id DESC LIMIT 5"
);
console.log(`\n  최근 비번재설정 audit (${a.rows.length}):`);
for (const x of a.rows) console.log(`    [${x.created_at}] ${x.action} #${x.resource_id} ${x.metadata}`);

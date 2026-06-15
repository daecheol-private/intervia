/**
 * 운영(Turso) DB의 system_admin 계정 점검 — READ ONLY (SELECT 만).
 *
 * 실행: node scripts/check-prod-sysadmin.mjs
 *   - .env.production.local 의 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 사용
 *
 * member@company-a.test "시스템 관리자" 유령 행이 운영 DB에 남아있는지,
 * 그리고 정상 sysadmin(admin.intervia@gmail.com)이 따로 있는지 확인한다.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const env = {};
for (const line of readFileSync(".env.production.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

const r = await db.execute(
  "SELECT id, email, name, role, status FROM users " +
    "WHERE role='system_admin' OR email LIKE '%@company-a.test' ORDER BY id"
);
console.log(`운영 DB — system_admin / company-a.test 행 (${r.rows.length}건):\n`);
for (const x of r.rows) {
  console.log(`  #${x.id}  ${x.role}  ${x.status}  ${x.email}  | ${x.name}`);
}
console.log(
  "\n→ member@company-a.test 가 system_admin 으로 보이면 그게 '유령' 행입니다."
);

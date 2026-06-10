/**
 * 운영(Turso) DB — 최근 비밀번호 재설정 발송 기록 조회. READ ONLY.
 *
 * 실행: node scripts/check-prod-reset-audit.mjs
 *
 * 방금 발송이 "어느 계정"을 대상으로, "어느 경로"로 나갔는지 확정한다.
 *   - action='password_reset.request'      → 로그인페이지 자가 비번찾기 (입력 이메일로 매칭된 계정)
 *   - action='user.password_reset_email'   → 관리자 화면 "비번 리셋" 버튼
 *   - metadata.email / metadata.targetEmail = 실제 수신 대상 계정 이메일
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
  `SELECT a.id, a.created_at, a.action, a.actor_role, a.actor_user_id,
          a.resource_id, a.metadata,
          tu.email AS target_email, tu.name AS target_name, tu.role AS target_role
     FROM audit_logs a
     LEFT JOIN users tu ON tu.id = a.resource_id
    WHERE a.action IN ('password_reset.request','user.password_reset_email','password_reset.confirm')
    ORDER BY a.id DESC
    LIMIT 10`
);
console.log(`최근 비번재설정 감사로그 (${r.rows.length}건, 최신순):\n`);
for (const x of r.rows) {
  console.log(`[${x.created_at}] ${x.action}  actor=${x.actor_role}(#${x.actor_user_id ?? "-"})`);
  console.log(`   대상 user #${x.resource_id}: ${x.target_email} | ${x.target_name} (${x.target_role})`);
  console.log(`   metadata: ${x.metadata}\n`);
}

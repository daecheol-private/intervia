/**
 * 운영(Turso) DB의 메일 수신 대상 도메인 분포 점검 — READ ONLY (SELECT 만).
 *
 * 실행: node scripts/check-mail-domains.mjs
 *   - .env.production.local 의 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 사용
 *
 * 목적: 550 "User unknown in virtual mailbox table" 은 발신 서버(mail.expernet.co.kr)가
 * 그 주소를 외부 릴레이가 아닌 자기 로컬 도메인으로 배달하려다 실패했다는 뜻이다.
 * 즉 수신 도메인이 그 서버가 관장하는 도메인인지 확인해야 원인이 잡힌다.
 * 로컬파트(개인 식별)는 조회하지 않고 도메인만 집계한다.
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

async function q(label, sql) {
  console.log(`\n=== ${label} ===`);
  try {
    const r = await db.execute(sql);
    if (r.rows.length === 0) {
      console.log("  (없음)");
      return;
    }
    for (const row of r.rows) {
      console.log(
        "  " +
          Object.entries(row)
            .map(([k, v]) => `${k}=${v}`)
            .join("  ")
      );
    }
  } catch (e) {
    console.log("  [쿼리 실패] " + (e?.message ?? e));
  }
}

await q(
  "전체 users 이메일 도메인",
  `SELECT lower(substr(email, instr(email,'@')+1)) AS domain,
          count(*) AS total,
          sum(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active
     FROM users
    WHERE email IS NOT NULL AND email <> ''
    GROUP BY 1 ORDER BY total DESC`
);

await q(
  "daily-digest 실제 대상 (공고 배정 + active + 수신거부 아님)",
  `SELECT lower(substr(u.email, instr(u.email,'@')+1)) AS domain,
          count(DISTINCT u.id) AS users
     FROM job_interviewers ji
     JOIN users u ON u.id = ji.user_id
    WHERE u.status = 'active'
      AND u.email IS NOT NULL AND u.email <> ''
      AND u.daily_digest_opt_out_at IS NULL
    GROUP BY 1 ORDER BY users DESC`
);

await q(
  "면접 리마인더 대상 후보자 도메인 (확정 일정 보유)",
  `SELECT lower(substr(c.email, instr(c.email,'@')+1)) AS domain, count(*) AS n
     FROM interview_schedules s
     JOIN candidates c ON c.id = s.candidate_id
    WHERE s.status = 'selected'
      AND c.email IS NOT NULL AND c.email <> ''
    GROUP BY 1 ORDER BY n DESC LIMIT 20`
);

await q(
  "digest 발송 기록 (최근 날짜별)",
  `SELECT digest_date, count(*) AS sent
     FROM daily_digest_logs GROUP BY 1 ORDER BY 1 DESC LIMIT 5`
);

// 오늘 대상자 중 발송 기록이 없는 사람 = 실패자(또는 skip). 실패 시 기록을 남기지 않는
// 멱등 설계라, 기록 누락이 곧 발송 실패의 흔적이다.
await q(
  "오늘 digest 대상자별 발송 여부",
  `SELECT u.id, u.email, u.role,
          (SELECT count(*) FROM daily_digest_logs l
            WHERE l.user_id = u.id
              AND l.digest_date = (SELECT max(digest_date) FROM daily_digest_logs)
          ) AS sent_today
     FROM job_interviewers ji
     JOIN users u ON u.id = ji.user_id
    WHERE u.status = 'active'
      AND u.email IS NOT NULL AND u.email <> ''
      AND u.daily_digest_opt_out_at IS NULL
    GROUP BY u.id ORDER BY sent_today, u.id`
);

await q(
  "사용자별 digest 누적 수신 이력 (한 번도 못 받은 계정 식별)",
  `SELECT u.id, u.email, count(l.user_id) AS total_received,
          ifnull(max(l.digest_date),'-') AS last_received
     FROM users u
     LEFT JOIN daily_digest_logs l ON l.user_id = u.id
    WHERE u.status = 'active'
    GROUP BY u.id ORDER BY total_received, u.id`
);

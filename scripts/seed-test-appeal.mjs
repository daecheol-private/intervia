/**
 * 테스트용 샘플 이의제기 시드 — `/admin/appeals` 화면 확인용.
 *
 * 전제: 먼저 `npm run db:seed-test` 로 법인/사용자/공고가 있어야 함.
 * test-company-a 의 첫 공고에 후보자 2명 + 면접세션 + 이의제기(대기 1, 완료 1) 를 넣는다.
 *
 * 실행 (PowerShell, 로컬 DB 강제):
 *   $env:LOCAL_DB=1; node scripts/seed-test-appeal.mjs
 *
 * 샘플 정리 (생성한 샘플 후보자/이의제기/세션/감사로그 삭제):
 *   $env:LOCAL_DB=1; node scripts/seed-test-appeal.mjs --clean
 */
import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";

const url =
  process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

const CLEAN = process.argv.includes("--clean");
const SAMPLE_EMAILS = ["hong@example.com", "kim@example.com"];

const tok = () => "tk_" + randomBytes(16).toString("hex");
const iso = (deltaDays = 0) =>
  new Date(Date.now() + deltaDays * 86_400_000).toISOString();

async function clean() {
  const ph = SAMPLE_EMAILS.map(() => "?").join(",");
  const c = await db.execute({
    sql: `SELECT id FROM candidates WHERE email IN (${ph})`,
    args: SAMPLE_EMAILS,
  });
  const ids = c.rows.map((r) => Number(r.id));
  if (ids.length === 0) {
    console.log("🧹 정리할 샘플 후보자가 없습니다.");
    return;
  }
  const idPh = ids.map(() => "?").join(",");
  // appeal_logs 는 논리 FK(cascade 없음) → 명시 삭제. candidates 삭제는 interview_sessions cascade.
  await db.execute({
    sql: `DELETE FROM appeal_logs WHERE candidate_id IN (${idPh})`,
    args: ids,
  });
  await db.execute({
    sql: `DELETE FROM audit_logs WHERE resource_type = 'candidate' AND resource_id IN (${idPh})`,
    args: ids,
  });
  await db.execute({
    sql: `DELETE FROM candidates WHERE id IN (${idPh})`,
    args: ids,
  });
  console.log(`🧹 샘플 후보자 ${ids.length}명 + 이의제기/세션/감사로그 삭제 완료`);
}

async function main() {
  console.log(`DB: ${url}`);

  if (CLEAN) {
    await clean();
    return;
  }

  const org = await db.execute({
    sql: "SELECT id FROM organizations WHERE name = ? LIMIT 1",
    args: ["test-company-a"],
  });
  if (org.rows.length === 0) {
    console.error(
      "❌ test-company-a 가 없습니다. 먼저 `npm run db:seed-test` 를 실행하세요."
    );
    process.exit(1);
  }
  const orgId = Number(org.rows[0].id);

  let job = await db.execute({
    sql: "SELECT id, title FROM job_postings WHERE org_id = ? ORDER BY id LIMIT 1",
    args: [orgId],
  });
  if (job.rows.length === 0) {
    const r = await db.execute({
      sql: `INSERT INTO job_postings(org_id, title, position, level, employment_type,
              responsibilities, requirements, published_at, closes_at)
            VALUES (?, '백엔드 개발자', '백엔드', '경력', '정규직', '주요업무', '자격요건', ?, ?)`,
      args: [orgId, iso(0), iso(30)],
    });
    job = { rows: [{ id: Number(r.lastInsertRowid), title: "백엔드 개발자" }] };
  }
  const jobId = Number(job.rows[0].id);

  // 후보자 2명
  async function makeCandidate(name, email) {
    const r = await db.execute({
      sql: `INSERT INTO candidates(org_id, job_id, name, email, resume_file_path, resume_text)
            VALUES (?, ?, ?, ?, '', '')`,
      args: [orgId, jobId, name, email],
    });
    return Number(r.lastInsertRowid);
  }
  async function makeSession(candidateId) {
    const r = await db.execute({
      sql: `INSERT INTO interview_sessions(candidate_id, access_token, status, expires_at)
            VALUES (?, ?, 'completed', ?)`,
      args: [candidateId, tok(), iso(7)],
    });
    return Number(r.lastInsertRowid);
  }

  const c1 = await makeCandidate("홍길동", "hong@example.com");
  const s1 = await makeSession(c1);
  await db.execute({
    sql: `INSERT INTO appeal_logs(candidate_id, interview_session_id, email, reason, status)
          VALUES (?, ?, ?, ?, 'pending')`,
    args: [
      c1,
      s1,
      "hong@example.com",
      "AI 면접 평가 결과에 동의할 수 없습니다. 제 경력과 답변이 충분히 반영되지 않은 것 같아 사람의 재검토를 요청합니다.",
    ],
  });

  const c2 = await makeCandidate("김영희", "kim@example.com");
  const s2 = await makeSession(c2);
  await db.execute({
    sql: `INSERT INTO appeal_logs(candidate_id, interview_session_id, email, reason, status, reviewed_at, response)
          VALUES (?, ?, ?, ?, 'resolved', ?, ?)`,
    args: [
      c2,
      s2,
      "kim@example.com",
      "평가 기준에 대한 설명을 요청드립니다.",
      iso(0),
      "검토 결과 평가 기준을 안내드렸습니다.",
    ],
  });

  console.log("✅ 샘플 이의제기 2건 생성 (대기 1, 완료 1)");
  console.log("   → http://localhost:3003/admin/appeals 에서 확인");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

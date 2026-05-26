/**
 * Sentry 통합 sanity check.
 *
 * production env 로드 → lib/error-reporter 의 captureError 호출 → Sentry envelope POST.
 * 1분 안에 Sentry Issues 에 표시되면 통합 OK.
 */
import "./_load-env.mjs";

const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  console.error("❌ SENTRY_DSN 미설정 — .env.production.local 확인");
  process.exit(1);
}
console.log(`SENTRY_DSN OK: ${dsn.slice(0, 50)}…\n`);

// DSN 파싱 검증
let parts;
try {
  const u = new URL(dsn);
  parts = {
    publicKey: u.username,
    host: u.host,
    projectId: u.pathname.slice(1),
    ingest: `https://${u.host}/api/${u.pathname.slice(1)}/envelope/`,
  };
  console.log(`Parsed: project=${parts.projectId}, host=${parts.host}\n`);
} catch (e) {
  console.error("❌ DSN 파싱 실패:", e);
  process.exit(1);
}

// envelope 직접 POST (라이브러리 import 시 Next 의존성 충돌 회피)
import { randomBytes } from "node:crypto";
const eventId = randomBytes(16).toString("hex"); // 32 hex chars 정확히

const event = {
  event_id: eventId,
  timestamp: new Date().toISOString(),
  platform: "node",
  level: "error",
  environment: "test",
  server_name: "intervia",
  exception: {
    values: [
      {
        type: "SentryIntegrationTest",
        value: `Intervia Sentry 통합 검증 — ${new Date().toISOString()}`,
        stacktrace: { frames: [{ filename: "scripts/test-sentry.mjs" }] },
      },
    ],
  },
  extra: {
    note: "이 에러는 의도된 테스트입니다. Sentry Issues 대시보드에 표시되면 통합 성공.",
    expected: true,
  },
};

const envelope =
  JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) +
  "\n" +
  JSON.stringify({ type: "event", content_type: "application/json" }) +
  "\n" +
  JSON.stringify(event);

console.log(`Sending test event id=${eventId} …`);
const t0 = Date.now();
const r = await fetch(parts.ingest, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-sentry-envelope",
    "X-Sentry-Auth": `Sentry sentry_version=7,sentry_key=${parts.publicKey},sentry_client=intervia-test/1.0`,
  },
  body: envelope,
});
const ms = Date.now() - t0;

if (r.ok) {
  console.log(`\n✅ Sentry envelope 전송 성공 (HTTP ${r.status}, ${ms}ms)`);
  console.log(`\n다음 단계:`);
  console.log(`  1. https://sentry.io/organizations/<your-org>/issues/ 접속`);
  console.log(`  2. 1분 내 "SentryIntegrationTest" 이슈 표시되는지 확인`);
  console.log(`  3. 표시되면 → Resolve 또는 Delete 처리`);
} else {
  console.error(
    `\n❌ Sentry 전송 실패: HTTP ${r.status} ${r.statusText}\n${await r.text()}`
  );
  process.exit(1);
}

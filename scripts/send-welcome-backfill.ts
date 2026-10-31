/**
 * 기존 가입자 1회 안내 — 환영 메일이 생기기 전에 이미 가입해 있던 사용자에게
 * 서비스 소개서·사용 가이드를 한 번만 보낸다 (variant="existing").
 *
 * 앞으로 가입하는 사람은 인증/승인 시점에 자동으로 받으므로(lib/email-welcome.ts)
 * 이 스크립트는 그 경계 이전 가입자만 대상으로 한다.
 *
 * 대상 조건 (셋 다 만족):
 *   · status = 'active'             — 로그인이 막힌 pending/disabled 제외
 *   · email_verified_at IS NOT NULL — 미인증 주소로 보내면 반송이 쌓인다
 *   · created_at < CUTOFF_UTC       — 그 뒤 가입자는 자동 경로로 이미 받았다
 *
 * ⚠️ email_verified_at 은 'YYYY-MM-DD HH:MM:SS' 와 ISO 가 섞여 있어(생성 경로마다 다름)
 *    문자열 대소 비교를 쓰면 안 된다. NULL 여부만 본다. 날짜 경계는 포맷이 일관된
 *    created_at(SQL CURRENT_TIMESTAMP, UTC)으로만 자른다.
 *
 * 중복 방지: 보낸 사람을 scripts/_welcome-backfill-sent.json 에 기록하고 다음 실행에서
 *    건너뛴다(.gitignore 의 /scripts/_* 로 커밋 제외). 리허설 발송은 기록하지 않는다.
 *
 * ⚠️ 세 모드를 **같은 NODE_ENV 로** 돌려야 한다. dev 모드에서는 lib/db.ts 가 Turso 대신
 *    file:./data.db 로 폴백하므로, 미리보기만 맨손으로 돌리면 로컬 목록을 보고
 *    --send(NODE_ENV=production) 는 운영 목록으로 보내는 어긋남이 생긴다. 그래서 운영
 *    대상 작업은 셋 다 NODE_ENV=production 으로 한다(스크립트가 어긋나면 멈춘다).
 *
 * 실행 방법은 docs/RUNBOOK.md "기존 가입자 1회 안내" 참고.
 * 요약: 인자 없이 = 미리보기(읽기 전용) / --rehearsal = REHEARSAL_TO 로만 발송 /
 *      --send = 실제 발송(NODE_ENV=production 필수).
 * 옵션: --limit N (상위 N명만), --before "YYYY-MM-DD HH:MM:SS" (기준 시각 UTC),
 *      --exclude 1,9,a@b.com (미리보기에서 보고 뺄 사람 — id 또는 이메일)
 */
import "./_load-env.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { db, currentDbTarget } from "../lib/db";
import { users } from "../lib/schema";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { buildWelcomeEmail } from "../lib/email-welcome";
import { sendMail } from "../lib/mailer";

/** 환영 메일 자동 발송이 운영에 올라간 시각(UTC). 이 뒤 가입자는 자동으로 받았다. */
const CUTOFF_UTC = "2026-10-30 05:15:00";

/** 보낸 사람 기록 — 재실행 시 건너뛰기용. */
const SENT_LOG = "scripts/_welcome-backfill-sent.json";

/** 연속 발송 간격(ms) — 발신 서버에 한꺼번에 몰지 않는다. */
const GAP_MS = 1500;

/**
 * --rehearsal 수신자. mailer 의 로컬 리다이렉트에 기대지 않고 여기서 직접 고정한다.
 * 운영 목록을 보려면 NODE_ENV=production 이 필요한데, 그 순간 로컬 리다이렉트가 꺼져
 * 리허설이 진짜 수신자에게 날아가기 때문이다.
 */
const REHEARSAL_TO = process.env.SYSTEM_ADMIN_EMAIL ?? "admin.intervia@gmail.com";

/**
 * 항상 빼는 주소 (2026-10-31 사용자 결정) — 운영자 본인 계정들과 테스트 계정.
 * 플래그가 아니라 코드에 박는 이유: --exclude 로만 두면 미리보기·리허설엔 붙이고
 * 정작 --send 에서 빠뜨려 본인이 4통 받는 식의 사고가 나기 쉽다.
 * id 가 아니라 이메일로 적는다 — 읽어서 알 수 있고 DB id 변화에도 안 흔들린다.
 */
const ALWAYS_EXCLUDE = [
  "admin.intervia@gmail.com", // 시스템 관리자 계정
  "dckang@expernet.co.kr", // 운영자 본인
  "dckang@erop.co.kr", // 운영자 본인
  "daecheol1983@naver.com", // 운영자 본인
  "test@intervia.kr", // 테스트 계정
];

/**
 * 반드시 반송되는 예약 TLD (RFC 2606/6761) — 시드·검증 계정이 여기에 걸린다.
 * 반송이 쌓이면 발신 평판이 깎여 면접 초대·일정 메일까지 영향을 받으므로 제외한다.
 */
const UNDELIVERABLE_TLDS = [".test", ".example", ".invalid", ".localhost", ".local"];

function isUndeliverable(email: string): boolean {
  const addr = email.toLowerCase().trim();
  return UNDELIVERABLE_TLDS.some((t) => addr.endsWith(t));
}

type SentEntry = { userId: number; email: string; at: string };

function loadSent(): SentEntry[] {
  if (!existsSync(SENT_LOG)) return [];
  try {
    return JSON.parse(readFileSync(SENT_LOG, "utf8")) as SentEntry[];
  } catch {
    console.error(`⚠️  ${SENT_LOG} 를 읽을 수 없습니다. 중복 발송을 막을 수 없어 중단합니다.`);
    process.exit(1);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const send = argv.includes("--send");
  const rehearsal = argv.includes("--rehearsal");
  const li = argv.indexOf("--limit");
  const limit = li >= 0 && argv[li + 1] ? Number(argv[li + 1]) : null;
  const bi = argv.indexOf("--before");
  const cutoff = bi >= 0 && argv[bi + 1] ? argv[bi + 1] : CUTOFF_UTC;
  // --exclude 1,9,test@intervia.kr — 미리보기에서 보고 빼기로 한 사람(id 또는 이메일).
  const xi = argv.indexOf("--exclude");
  const excluded = new Set([
    ...ALWAYS_EXCLUDE.map((v) => v.toLowerCase()),
    ...(xi >= 0 && argv[xi + 1] ? argv[xi + 1] : "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  ]);

  const isProdEnv = process.env.NODE_ENV === "production";

  // env 가 아니라 "실제로 붙은 DB" 를 본다. dev 모드에서는 TURSO_DATABASE_URL 이 있어도
  // lib/db.ts 가 file:./data.db 로 폴백하므로, LOCAL_DB 만 보고 PRODUCTION 이라 찍으면
  // 미리보기는 로컬을 읽고 --send(NODE_ENV=production)는 운영을 읽는 어긋남이 생긴다.
  const target = currentDbTarget();
  if (target.isLocalFile && process.env.LOCAL_DB !== "1") {
    console.error(
      `✋ 운영을 보려던 것 같은데 실제로는 로컬 DB(${target.url})에 붙었습니다.\n` +
        "   dev 모드라 lib/db.ts 가 Turso 대신 로컬 파일로 폴백했습니다.\n" +
        "   · 운영 대상을 보려면:  $env:NODE_ENV=\"production\" 을 먼저 설정하세요\n" +
        "   · 일부러 로컬을 보려면: LOCAL_DB=1 을 붙이세요\n" +
        "   이대로 두면 미리보기 목록과 실제 발송 대상이 서로 다른 DB 가 됩니다."
    );
    process.exit(1);
  }

  // 실제 발송은 NODE_ENV=production 에서만. 아니면 mailer 가 수신자를 전부
  // admin.intervia@gmail.com 으로 바꾸는데(lib/mailer.ts resolveMailOverride),
  // 그걸 모르고 --send 하면 아무에게도 안 간 채 "보냄" 으로 기록돼 영영 누락된다.
  if (send && !isProdEnv) {
    console.error(
      "✋ --send 는 NODE_ENV=production 에서만 동작합니다.\n" +
        "   지금 보내면 수신자가 전부 admin.intervia@gmail.com 으로 바뀝니다.\n" +
        "   리허설이 목적이면 --rehearsal 을 쓰세요(기록을 남기지 않습니다)."
    );
    process.exit(1);
  }

  const mode = send
    ? "실제 발송 ✉️"
    : rehearsal
      ? `리허설(${REHEARSAL_TO} 로) 🔁`
      : "미리보기 👀";
  console.log(
    `[welcome-backfill] DB=${target.isLocalFile ? `LOCAL (${target.url})` : `PRODUCTION ⚠️ (${target.url})`} / mode=${mode} / 기준=${cutoff} UTC`
  );

  const sent = loadSent();
  const sentIds = new Set(sent.map((e) => e.userId));

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        isNotNull(users.emailVerifiedAt),
        lt(users.createdAt, cutoff)
      )
    )
    .orderBy(users.id);

  const isExcluded = (r: { id: number; email: string }) =>
    excluded.has(String(r.id)) || excluded.has(r.email.toLowerCase());

  const already = rows.filter((r) => sentIds.has(r.id)).length;
  const undeliverable = rows.filter((r) => isUndeliverable(r.email));
  const skipped = rows.filter((r) => isExcluded(r));
  const eligible = rows.filter(
    (r) => !sentIds.has(r.id) && !isUndeliverable(r.email) && !isExcluded(r)
  );
  const targets = limit ? eligible.slice(0, limit) : eligible;

  console.log(
    `조건 충족 ${rows.length}명 / 이미 보냄 ${already}명 / 반송 예약도메인 ${undeliverable.length}명 / 직접 제외 ${skipped.length}명 / 남은 대상 ${eligible.length}명 / 이번 실행 ${targets.length}명`
  );
  for (const u of undeliverable) {
    console.log(`  × [${u.id}] ${u.email} — 예약 TLD, 제외`);
  }
  const always = new Set(ALWAYS_EXCLUDE.map((v) => v.toLowerCase()));
  for (const u of skipped) {
    const why = always.has(u.email.toLowerCase()) ? "고정 제외(본인·테스트)" : "--exclude 지정";
    console.log(`  × [${u.id}] ${u.email} — ${why}`);
  }
  // 오타로 아무도 안 걸러지는 걸 눈치채지 못하는 일이 없도록. ALWAYS_EXCLUDE 는
  // 다른 환경(로컬 등)엔 없는 게 정상이므로 CLI 로 넘긴 값만 검사한다.
  const cliExcluded = (xi >= 0 && argv[xi + 1] ? argv[xi + 1] : "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const unmatched = cliExcluded.filter(
    (v) => !rows.some((r) => String(r.id) === v || r.email.toLowerCase() === v)
  );
  if (unmatched.length) {
    console.log(`  ⚠️  --exclude 중 대상에 없는 값: ${unmatched.join(", ")}`);
  }
  for (const t of targets) {
    console.log(`  - [${t.id}] ${t.email} (${t.name}, ${t.role}, 가입 ${t.createdAt})`);
  }

  if (!send && !rehearsal) {
    console.log(
      "\n미리보기입니다. 위 목록을 확인한 뒤 --rehearsal → --send 순서로 실행하세요."
    );
    process.exit(0);
  }
  if (targets.length === 0) {
    console.log("보낼 대상이 없습니다.");
    process.exit(0);
  }

  const baseUrl = process.env.APP_BASE_URL ?? "https://intervia.kr";
  let ok = 0;
  const failed: Array<{ id: number; email: string; err: string }> = [];

  for (const t of targets) {
    const mail = buildWelcomeEmail({
      userName: t.name,
      baseUrl,
      variant: "existing",
    });
    try {
      await sendMail({
        to: rehearsal ? REHEARSAL_TO : t.email,
        ...mail,
        audience: "org",
        kind: "welcome_backfill",
      });
      ok++;
      // 리허설은 기록하지 않는다 — 실제 수신자에게 간 게 아니다.
      if (send) {
        sent.push({ userId: t.id, email: t.email, at: new Date().toISOString() });
        writeFileSync(SENT_LOG, JSON.stringify(sent, null, 2));
      }
      console.log(
        rehearsal ? `  ✓ [${t.id}] ${t.email} 분을 ${REHEARSAL_TO} 로` : `  ✓ [${t.id}] ${t.email}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ id: t.id, email: t.email, err: msg });
      console.error(`  ✗ [${t.id}] ${t.email} — ${msg}`);
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  console.log(`\n성공 ${ok} / 실패 ${failed.length}`);
  if (failed.length) {
    console.log("실패분은 기록되지 않았으니, 원인을 고친 뒤 같은 명령을 다시 실행하면 재시도됩니다.");
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

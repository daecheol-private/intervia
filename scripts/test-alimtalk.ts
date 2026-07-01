/**
 * 카카오 알림톡(알리고) 발송 1회 sanity 테스트.
 *
 * lib/alimtalk.ts 의 실제 발송 함수(sendCandidateAlimtalk)를 그대로 호출한다.
 * 운영에서 나가는 것과 동일한 경로를 검증하며, throw 하지 않고 단계별 reason 을 돌려주므로
 * 어디서 막히는지(키 틀림 / 템플릿 미설정·미승인 / 번호 형식 / 본문 불일치)를 짚어준다.
 *
 * env (.env.production.local 에 작성하거나 PowerShell $env: 로 주입):
 *   ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_KEY, ALIGO_SENDER   (4개 필수)
 *   ALIGO_TPL_*                                                     (테스트할 종류의 승인 템플릿 코드)
 *   ALIGO_TEST_MODE=1   → 실발송·과금 없이 알리고 요청 검증만 (선택, 첫 시도 권장)
 *
 * 사용:
 *   # ① 먼저 검증만 (실제 카톡 안 감, 과금 X) — 키/발신프로필/템플릿코드 정합 확인
 *   $env:ALIGO_TEST_MODE="1"; npx tsx scripts/test-alimtalk.ts 01012345678
 *
 *   # ② 실제 수신 테스트 (본인 폰으로 진짜 발송 + 소액 과금)
 *   npx tsx scripts/test-alimtalk.ts 01012345678
 *
 *   # 종류 지정 (기본 interview_invite)
 *   npx tsx scripts/test-alimtalk.ts 01012345678 decision_pass
 */
import "./_load-env.mjs";
import {
  sendCandidateAlimtalk,
  type AlimtalkType,
} from "../lib/alimtalk";

const TYPES: AlimtalkType[] = [
  "interview_invite",
  "interview_reminder",
  "schedule_propose",
  "interview_day_reminder",
  "decision_pass",
];

// type → 해당 승인 템플릿 코드를 담는 env 변수명 (lib/alimtalk.ts TEMPLATE_ENV 와 동일)
const TPL_ENV: Record<AlimtalkType, string> = {
  interview_invite: "ALIGO_TPL_INTERVIEW_INVITE",
  interview_reminder: "ALIGO_TPL_INTERVIEW_REMINDER",
  schedule_propose: "ALIGO_TPL_SCHEDULE_PROPOSE",
  interview_day_reminder: "ALIGO_TPL_INTERVIEW_DAY",
  decision_pass: "ALIGO_TPL_DECISION_PASS",
};

function mask(s: string): string {
  if (s.length <= 8) return s.slice(0, 2) + "***";
  return s.slice(0, 4) + "***" + s.slice(-3);
}

const phone = process.argv[2];
const type = (process.argv[3] as AlimtalkType) || "interview_invite";

if (!phone) {
  console.error("❌ 휴대폰 번호를 인자로 주세요.");
  console.error("   예: npx tsx scripts/test-alimtalk.ts 01012345678 [종류]");
  console.error(`   종류(선택): ${TYPES.join(" | ")}  (기본 interview_invite)`);
  process.exit(1);
}
if (!TYPES.includes(type)) {
  console.error(`❌ 알 수 없는 종류: ${type}`);
  console.error(`   가능: ${TYPES.join(" | ")}`);
  process.exit(1);
}

const testMode = process.env.ALIGO_TEST_MODE === "1";

console.log("─".repeat(64));
console.log("카카오 알림톡(알리고) 발송 테스트");
console.log("─".repeat(64));

// 1) 게이트 env 점검
const REQUIRED = ["ALIGO_API_KEY", "ALIGO_USER_ID", "ALIGO_SENDER_KEY", "ALIGO_SENDER"];
let envOk = true;
for (const k of REQUIRED) {
  const v = process.env[k];
  if (!v) envOk = false;
  console.log(`  ${v ? "✅" : "❌"} ${k}${v ? ` = ${mask(v)}` : " (없음)"}`);
}
// 2) 종류별 템플릿 코드
const tplCode = process.env[TPL_ENV[type]];
console.log(
  `  ${tplCode ? "✅" : "❌"} ${TPL_ENV[type]}${tplCode ? ` = ${tplCode}` : " (없음)"}   ← 종류: ${type}`
);

console.log(
  `\n  모드: ${
    testMode
      ? "TEST (실제 발송 X · 과금 X — 알리고 요청 검증만)"
      : "🔴 실발송 (실제 카카오톡 전송 + 소액 과금)"
  }`
);
console.log(`  수신: ${phone}\n`);

if (!envOk) {
  console.error("❌ 필수 env 가 비어 있습니다. .env.production.local 에 채우거나 $env: 로 주입 후 다시 실행하세요.");
  process.exit(1);
}

// 3) 테스트용 변수 — 변수 자리에만 들어가므로 더미 값이어도 승인 템플릿이면 발송 통과한다.
const path = type === "schedule_propose" ? "schedule" : "interview";
const vars = {
  orgName: "테스트컴퍼니",
  candidateName: "테스트",
  jobTitle: "테스트 포지션",
  url: `https://intervia.kr/${path}/TESTONLY`,
  expiresAt: "2026-07-08 23:59",
  slotLabel: "2026-07-03 14:00",
};

void (async () => {
  console.log(`발송 시도…\n`);
  const result = await sendCandidateAlimtalk(type, { phone, vars });

  console.log("─".repeat(64));
  if (result.ok) {
    if (testMode) {
      console.log("✅ 검증 통과 — 알리고가 요청을 수락(code=0).");
      console.log("   키 · 발신프로필키 · 발신번호 · 템플릿코드 정합 모두 정상.");
      console.log("   → 실제 수신 확인은 ALIGO_TEST_MODE 를 빼고 다시 실행하세요.");
    } else {
      console.log("✅ 발송 성공 — 잠시 후 휴대폰에서 알림톡 도착을 확인하세요.");
      console.log("   (안 오면: 카카오 채널 '채팅 차단' 여부 / 스팸 / 번호 확인)");
    }
  } else if (result.skipped) {
    console.log(`⏭️  skip (${result.reason})`);
    const hint: Record<string, string> = {
      not_configured: "ALIGO_API_KEY / USER_ID / SENDER_KEY / SENDER 4개를 모두 채우세요.",
      template_not_set: `${TPL_ENV[type]} (이 종류의 승인 템플릿 코드)가 env 에 없습니다.`,
      no_phone: "번호 형식이 휴대폰(01x...)이 아닙니다.",
    };
    if (hint[result.reason]) console.log(`   → ${hint[result.reason]}`);
  } else {
    console.log(`❌ 발송 실패 (${result.reason})`);
    console.log("   흔한 원인:");
    console.log("   - token_failed       → ALIGO_API_KEY / ALIGO_USER_ID 가 틀림");
    console.log("   - 템플릿 미승인/검수중 → 카카오가 거부. 알리고에서 해당 템플릿 '승인' 상태 확인");
    console.log("   - 본문 불일치         → 승인 템플릿 본문과 buildMessage() 텍스트가 글자까지 같아야 함");
    console.log("   - senderkey/발신번호 불일치 → 발신프로필키·발신번호 재확인");
    process.exit(1);
  }
  console.log("─".repeat(64));
})();

/**
 * Resend SMTP 발송 1회 sanity 테스트.
 *
 * 현재 셋업 (onboarding@resend.dev sandbox) 에서는 본인 계정 이메일(daecheol1983@gmail.com)
 * 에만 발송 가능. 도메인 verify 후엔 모든 주소로 발송 가능.
 *
 * 목적: SMTP 라이브러리·env 변수·Resend 키 통합 자체가 정상인지 확인.
 *       메일 도달 여부는 사용자가 받은편지함에서 확인.
 */
import "./_load-env.mjs";
import nodemailer from "nodemailer";

const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ 누락된 env: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(
  `SMTP: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} (user=${process.env.SMTP_USER})`
);
console.log(`FROM: ${process.env.SMTP_FROM}\n`);

const TO = "daecheol1983@gmail.com";

const port = Number(process.env.SMTP_PORT);
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

console.log("[1/2] SMTP verify…");
try {
  await transporter.verify();
  console.log("     ✅ SMTP 연결 OK");
} catch (e) {
  console.error(`     ❌ verify 실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

console.log(`\n[2/2] 테스트 메일 발송 → ${TO}`);
const t0 = Date.now();
try {
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: TO,
    subject: "[Intervia] SMTP 발송 통합 sanity 테스트",
    text: `안녕하세요,\n\n이 메일은 Intervia 의 Resend SMTP 통합이 정상 동작하는지 확인하기 위한 테스트 메일입니다.\n\n발송 시각: ${new Date().toISOString()}\n발송자: ${process.env.SMTP_FROM}\n수신자: ${TO}\n\n받으셨다면 Phase A 메일 인프라 정상 동작 확인.\nPhase B 에서 도메인 verify 후 모든 후보자 주소로 발송 가능.`,
  });
  const ms = Date.now() - t0;
  console.log(`     ✅ 발송 OK (${ms}ms)`);
  console.log(`     messageId: ${info.messageId}`);
  console.log(`     response: ${info.response?.slice(0, 100)}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`     ❌ 발송 실패: ${msg}`);
  if (msg.includes("403") || msg.includes("only send")) {
    console.error(
      "     → onboarding@resend.dev 는 본인 계정 메일만 발송 가능. TO 가 daecheol1983@gmail.com 맞는지 확인."
    );
  }
  process.exit(1);
}

console.log("\n✅ Resend 통합 정상");
console.log("   다음: 받은편지함(daecheol1983@gmail.com) 에서 메일 도착 확인");
console.log("   Phase B 에서 도메인 verify 후엔 onboarding@resend.dev → noreply@your-domain 으로 교체");

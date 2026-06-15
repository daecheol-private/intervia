/**
 * 메일 템플릿 3종을 본인 이메일로 발송 — 새 녹색 IV 로고/CTA 시각 확인용 1회성 스크립트.
 * 실행: npx tsx scripts/preview-email-templates.ts
 */
import "./_load-env.mjs";
import nodemailer from "nodemailer";
import { buildInterviewEmail } from "../lib/mailer";
import { buildPasswordResetEmail } from "../lib/password-reset";
import { buildVerificationEmail } from "../lib/email-verify";

async function main() {
  const TO = "admin.intervia@gmail.com";
  const port = Number(process.env.SMTP_PORT);
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });

  const samples = [
    buildVerificationEmail({
      userName: "강대철",
      verifyUrl: "https://intervia.kr/verify?token=preview",
    }),
    buildPasswordResetEmail({
      userName: "강대철",
      resetUrl: "https://intervia.kr/password-reset?token=preview",
    }),
    buildInterviewEmail({
      candidateName: "홍길동",
      jobTitle: "백엔드 개발자",
      url: "https://intervia.kr/interview/preview-token",
      expiresAt: "2026-06-01 18:00 (KST)",
    }),
  ];

  for (const m of samples) {
    const info = await t.sendMail({
      from: process.env.SMTP_FROM,
      to: TO,
      subject: `[미리보기] ${m.subject}`,
      text: m.text,
      html: m.html,
    });
    console.log("sent:", m.subject, "—", info.messageId);
  }
  console.log("\n✅ 3종 발송 완료. 받은편지함에서 로고/색상 확인하세요.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

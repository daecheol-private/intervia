import { db } from "./db";
import { emailVerifications, users } from "./schema";
import { eq, and, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { addDays } from "./utils";
import { sendMail, EMAIL_BRAND, wrapEmailCard } from "./mailer";

const TOKEN_TTL_DAYS = 3;

export function buildVerificationEmail(opts: {
  userName: string;
  verifyUrl: string;
}): { subject: string; html: string; text: string } {
  const { userName, verifyUrl } = opts;
  return {
    subject: "[Intervia] 이메일 인증을 완료해주세요",
    text: `${userName} 님, 가입을 완료하려면 아래 링크를 클릭하세요. (3일 이내)\n\n${verifyUrl}\n\n본인이 가입하지 않았다면 이 메일은 무시해주세요.`,
    html: wrapEmailCard({
      innerHtml: `
        <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">이메일 인증</h1>
        <p style="color:#475569;line-height:1.6;margin:0 0 24px;">
          <strong style="color:#0f172a;">${userName}</strong> 님, Intervia 가입을 환영합니다.<br>
          아래 버튼을 눌러 이메일 인증을 완료해 주세요.
        </p>
        <p style="text-align:center;margin:0 0 16px;">
          <a href="${verifyUrl}" style="display:inline-block;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">이메일 인증하기</a>
        </p>
        <p style="font-size:12px;color:#64748b;margin:0 0 20px;text-align:center;">
          버튼이 동작하지 않으면 아래 링크를 복사해 주세요:<br>
          <a href="${verifyUrl}" style="color:${EMAIL_BRAND.primary};word-break:break-all;">${verifyUrl}</a>
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;">
          <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">안내</div>
          • 이 링크는 <strong>3일</strong> 이내에 사용해야 유효합니다.<br>
          • 본인이 가입하지 않았다면 이 메일은 무시해 주세요.
        </div>
      `,
      footer: "본 메일은 Intervia 시스템에서 자동 발송되었습니다.",
    }),
  };
}

export async function createVerificationToken(userId: number): Promise<string> {
  const token = "v_" + randomBytes(24).toString("hex");
  const expiresAt = addDays(new Date(), TOKEN_TTL_DAYS).toISOString();
  await db.insert(emailVerifications).values({
    userId,
    token,
    expiresAt,
  });
  return token;
}

export async function sendVerificationMail(opts: {
  userId: number;
  email: string;
  name: string;
  baseUrl: string;
}): Promise<void> {
  const token = await createVerificationToken(opts.userId);
  const verifyUrl = `${opts.baseUrl}/verify?token=${token}`;
  const mail = buildVerificationEmail({ userName: opts.name, verifyUrl });
  await sendMail({ to: opts.email, ...mail, audience: "org" });
}

export async function consumeVerificationToken(token: string): Promise<{
  ok: boolean;
  userId?: number;
  reason?: string;
}> {
  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.token, token));
  if (!row) return { ok: false, reason: "유효하지 않은 토큰입니다." };
  if (row.consumedAt) return { ok: false, reason: "이미 사용된 토큰입니다." };
  if (new Date(row.expiresAt) < new Date())
    return { ok: false, reason: "토큰이 만료되었습니다." };

  const now = new Date().toISOString();
  await db
    .update(emailVerifications)
    .set({ consumedAt: now })
    .where(eq(emailVerifications.id, row.id));
  await db
    .update(users)
    .set({ emailVerifiedAt: now })
    .where(eq(users.id, row.userId));
  return { ok: true, userId: row.userId };
}

export async function hasPendingVerification(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: emailVerifications.id })
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.userId, userId),
        isNull(emailVerifications.consumedAt)
      )
    );
  return !!row;
}

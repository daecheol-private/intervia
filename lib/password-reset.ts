import { db } from "./db";
import { passwordResets, users } from "./schema";
import { eq, sql, and, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { addDays } from "./utils";
import { sendMail, EMAIL_BRAND, wrapEmailCard, escapeHtml } from "./mailer";

const TOKEN_TTL_HOURS = 1; // 1시간 유효 — 짧게.

export function buildPasswordResetEmail(opts: {
  userName: string;
  resetUrl: string;
}): { subject: string; html: string; text: string } {
  const { userName, resetUrl } = opts;
  return {
    subject: "[Intervia] 비밀번호 재설정 안내",
    text: `${userName} 님, 비밀번호 재설정 요청을 받았습니다. 아래 링크는 1시간 동안 유효합니다.\n\n${resetUrl}\n\n본인이 요청하지 않았다면 이 메일은 무시해주세요. 계정은 안전합니다.`,
    html: wrapEmailCard({
      innerHtml: `
        <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">비밀번호 재설정</h1>
        <p style="color:#475569;line-height:1.6;margin:0 0 24px;">
          <strong style="color:#0f172a;">${escapeHtml(userName)}</strong> 님, Intervia 계정의 비밀번호 재설정 요청을 받았습니다.<br>
          아래 버튼을 눌러 새 비밀번호를 설정해 주세요.
        </p>
        <p style="text-align:center;margin:0 0 16px;">
          <a href="${resetUrl}" style="display:inline-block;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">비밀번호 재설정</a>
        </p>
        <p style="font-size:12px;color:#64748b;margin:0 0 20px;text-align:center;">
          버튼이 동작하지 않으면 아래 링크를 복사해 주세요:<br>
          <a href="${resetUrl}" style="color:${EMAIL_BRAND.primary};word-break:break-all;">${resetUrl}</a>
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;">
          <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">보안 안내</div>
          • 이 링크는 <strong>1시간</strong> 동안만 유효합니다.<br>
          • 본인이 요청하지 않았다면 이 메일은 무시해 주세요 — 계정은 안전합니다.
        </div>
      `,
      footer: "본 메일은 Intervia 시스템에서 자동 발송되었습니다.",
    }),
  };
}

export async function createResetToken(
  userId: number,
  requestedIp?: string | null
): Promise<string> {
  const token = "p_" + randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600 * 1000).toISOString();
  // 기존 미사용 토큰 무효화 — 한 사용자당 활성 토큰 1개로 제한.
  await db
    .update(passwordResets)
    .set({ consumedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(passwordResets.userId, userId),
        isNull(passwordResets.consumedAt)
      )
    );
  await db.insert(passwordResets).values({
    userId,
    token,
    expiresAt,
    requestedIp: requestedIp ?? null,
  });
  return token;
}

export async function sendPasswordResetMail(opts: {
  userId: number;
  email: string;
  name: string;
  baseUrl: string;
  requestedIp?: string | null;
  orgId?: number | null;
}): Promise<void> {
  const token = await createResetToken(opts.userId, opts.requestedIp);
  const resetUrl = `${opts.baseUrl}/password-reset?token=${token}`;
  const mail = buildPasswordResetEmail({ userName: opts.name, resetUrl });
  await sendMail({ to: opts.email, ...mail, orgId: opts.orgId ?? null, audience: "org" });
  void addDays; // (placeholder — keep import stable)
}

export async function consumeResetToken(token: string): Promise<{
  ok: boolean;
  userId?: number;
  reason?: string;
}> {
  const [row] = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.token, token));
  if (!row) return { ok: false, reason: "유효하지 않은 토큰입니다." };
  if (row.consumedAt) return { ok: false, reason: "이미 사용된 토큰입니다." };
  if (new Date(row.expiresAt) < new Date())
    return { ok: false, reason: "토큰이 만료되었습니다. 다시 요청해주세요." };

  await db
    .update(passwordResets)
    .set({ consumedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(passwordResets.id, row.id));
  return { ok: true, userId: row.userId };
}

export async function verifyResetTokenActive(token: string): Promise<{
  valid: boolean;
  userId?: number;
  email?: string;
}> {
  const [row] = await db
    .select({
      id: passwordResets.id,
      userId: passwordResets.userId,
      expiresAt: passwordResets.expiresAt,
      consumedAt: passwordResets.consumedAt,
      email: users.email,
    })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(eq(passwordResets.token, token));
  if (!row) return { valid: false };
  if (row.consumedAt) return { valid: false };
  if (new Date(row.expiresAt) < new Date()) return { valid: false };
  return { valid: true, userId: row.userId, email: row.email };
}

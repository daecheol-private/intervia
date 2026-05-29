import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { db } from "@/lib/db";
import { users, organizations } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getBalance } from "@/lib/tokens";
import { sendMail, wrapEmailCard, EMAIL_BRAND } from "@/lib/mailer";

export const runtime = "nodejs";

/**
 * 멤버가 법인 관리자에게 토큰 충전을 요청하는 메일을 보낸다.
 * 권한: 로그인한 멤버 누구나 (org_admin 은 직접 충전 가능하므로 사용 안 함).
 * 대상: 본 법인의 활성 org_admin 전원.
 */
export async function POST() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return new Response("법인 없음", { status: 400 });

  const admins = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.orgId, me!.orgId),
        eq(users.role, "org_admin"),
        eq(users.status, "active")
      )
    );

  if (admins.length === 0) {
    return new Response(
      "법인 관리자가 없습니다. 시스템 관리자에게 문의해 주세요.",
      { status: 400 }
    );
  }

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, me!.orgId));

  const balance = await getBalance(me!.orgId);
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3003";
  const tokensUrl = `${base}/org/tokens`;

  const subject = `[Intervia] ${me!.name} 님이 토큰 충전을 요청했습니다`;

  for (const a of admins) {
    if (!a.email) continue;
    const innerHtml = `
      <h2 style="margin:8px 0 16px;font-size:18px;color:${EMAIL_BRAND.ink};line-height:1.4;">
        ${a.name || "관리자"} 님, ${me!.name} 님이 토큰 충전을 요청했습니다
      </h2>
      <p style="margin:0 0 16px;color:#475569;line-height:1.6;font-size:14px;">
        같은 법인의 멤버가 토큰 잔액 부족으로 충전을 요청했습니다.<br/>
        아래 상세 정보를 확인하시고 토큰 페이지에서 충전을 진행해 주세요.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;margin:0 0 20px;">
        <tr>
          <td style="padding:14px 16px;font-size:12px;color:#64748b;width:90px;">요청자</td>
          <td style="padding:14px 16px;font-size:13px;color:${EMAIL_BRAND.ink};font-weight:600;">
            ${me!.name} <span style="color:#94a3b8;font-weight:400;">&lt;${me!.email}&gt;</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 16px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">법인</td>
          <td style="padding:14px 16px;font-size:13px;color:${EMAIL_BRAND.ink};border-top:1px solid #e2e8f0;">
            ${org?.name ?? "-"}
          </td>
        </tr>
        <tr>
          <td style="padding:14px 16px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">현재 잔액</td>
          <td style="padding:14px 16px;font-size:14px;color:${balance <= 0 ? "#dc2626" : EMAIL_BRAND.ink};font-weight:700;border-top:1px solid #e2e8f0;">
            ${balance.toLocaleString()} 토큰
          </td>
        </tr>
      </table>
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="${tokensUrl}" style="display:inline-block;padding:12px 28px;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">
          토큰 충전하러 가기
        </a>
      </div>
    `;
    const html = wrapEmailCard({
      innerHtml,
      footer: `본 메일은 ${me!.name} 님이 Intervia 대시보드에서 "충전 요청" 버튼을 눌러 발송한 자동 메일입니다.`,
    });
    const text = `${a.name || "관리자"} 님,

같은 법인의 ${me!.name}(${me!.email}) 님이 토큰 충전을 요청했습니다.
법인: ${org?.name ?? "-"}
현재 잔액: ${balance.toLocaleString()} 토큰

토큰 충전 페이지: ${tokensUrl}`;

    try {
      await sendMail({
        to: a.email,
        subject,
        html,
        text,
        orgId: me!.orgId,
        audience: "org",
      });
    } catch (e) {
      console.error("[request-charge] sendMail failed", a.email, e);
      // 한 관리자 실패해도 나머지는 계속 시도
    }
  }

  return Response.json({
    sent: admins.length,
    admins: admins.map((a) => ({ name: a.name, email: a.email })),
  });
}

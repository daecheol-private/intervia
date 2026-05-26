/**
 * 비로그인 사용자가 시스템관리자(Intervia 운영자) 에게 법인 admin 권한 부여를 요청.
 *
 * 시나리오: A 가 AA법인을 먼저 가입해서 org_admin이 됐는데, 진짜 인사담당자 B 가
 * 가입하려고 보니 A 는 응답이 없음 → B 가 시스템관리자에게 권한 이관을 요청.
 *
 * 보안:
 *   - 비로그인 — IP 기준 분당 2회 제한
 *   - PII 노출 최소화 — 운영자 메일에만 전체 정보, 응답은 ok만
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import { DPO_INFO, COMPANY_INFO, SITE_INFO } from "@/lib/site-info";
import { logAudit } from "@/lib/audit";
import { isValidEmail, normalizeEmail } from "@/lib/email-domain";
import { extractIp } from "@/lib/auth-attempts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await rateLimit(req, "admin-request", {
    limit: 2,
    windowSec: 60,
  });
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    orgId?: number;
    requesterEmail?: string;
    requesterName?: string;
    reason?: string;
  };

  const orgId = Number(body.orgId);
  const requesterEmail = body.requesterEmail?.trim();
  const requesterName = body.requesterName?.trim();
  const reason = body.reason?.trim() ?? "";

  if (!orgId || !requesterEmail || !requesterName)
    return new Response("법인/이메일/이름은 필수입니다.", { status: 400 });
  if (!isValidEmail(requesterEmail))
    return new Response("올바른 이메일이 아닙니다.", { status: 400 });
  if (reason.length > 2000)
    return new Response("사유는 2000자 이내로 작성해 주세요.", { status: 400 });

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인을 찾을 수 없습니다.", { status: 404 });

  const normalizedEmail = normalizeEmail(requesterEmail);

  // 감사 로그 — 시스템 관리자가 이력 확인 가능
  logAudit(req, {
    actorRole: "anonymous",
    action: "org.admin_transfer_request",
    resourceType: "organization",
    resourceId: org.id,
    orgId: org.id,
    metadata: {
      requester_email: normalizedEmail,
      requester_name: requesterName,
      reason_length: reason.length,
      ip: extractIp(req),
    },
  });

  // 운영자 메일 발송 — 시스템 SMTP (env) 사용. 실패해도 감사로그 있으니 응답은 OK.
  if (await isSmtpAvailable(null)) {
    const adminUrl = `${SITE_INFO.baseUrl}/admin/users?q=${encodeURIComponent(org.name)}`;
    try {
      await sendMail({
        to: DPO_INFO.email,
        orgId: null,
        audience: "org",
        subject: `[${SITE_INFO.serviceName}] 법인 권한 이관 요청 — ${org.name}`,
        text: `법인 admin 권한 이관 요청이 접수되었습니다.

법인: ${org.name} (id=${org.id})
신청자: ${requesterName} <${normalizedEmail}>
사유:
${reason || "(미작성)"}

검토:
1. ${SITE_INFO.baseUrl}/admin/users — 현재 법인 admin 확인
2. 신청자 신원·재직 증명 확인 (별도 회신 요청 권장)
3. 승인 시 신청자의 사용자 row 가 생성된 후(가입 또는 합류 요청 거쳐서) role 을 org_admin 으로 변경
4. 기존 admin 강등 여부는 운영자 판단

${COMPANY_INFO.name} 시스템관리자 알림`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="color:#0f172a;font-size:18px;">법인 admin 권한 이관 요청</h2>
  <table style="font-size:13px;color:#334155;border-collapse:collapse;margin-top:12px;">
    <tr><td style="padding:4px 8px;color:#64748b;width:80px;">법인</td><td><strong>${escHtml(org.name)}</strong> (id=${org.id})</td></tr>
    <tr><td style="padding:4px 8px;color:#64748b;">신청자</td><td>${escHtml(requesterName)} &lt;${escHtml(normalizedEmail)}&gt;</td></tr>
  </table>
  ${
    reason
      ? `<div style="margin-top:12px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;white-space:pre-wrap;">${escHtml(reason)}</div>`
      : ""
  }
  <p style="margin-top:16px;font-size:12px;color:#64748b;">신청자 신원·재직 증명을 별도 회신으로 받은 뒤 권한 이관을 진행하세요.</p>
  <a href="${adminUrl}" style="display:inline-block;margin-top:8px;background:#2563eb;color:white;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px;">${SITE_INFO.serviceName} 관리자 페이지</a>
</div>`,
      });
    } catch (e) {
      console.error("[admin-request] mail failed:", e);
    }
  }

  return Response.json({ ok: true });
}

function escHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

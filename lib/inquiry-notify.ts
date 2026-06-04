/**
 * 신규 고객센터 문의 접수 시 지원 이메일(APPEAL_CONTACT = DPO/문의 단일 채널)로 통지.
 *
 * fire-and-forget 으로 호출 — 실패해도 문의 제출 자체는 성공 응답.
 * SMTP 미설정(법인 + 시스템 모두) 이면 조용히 skip (인박스에는 행이 남으므로 누락 아님).
 */
import {
  sendMail,
  isSmtpAvailable,
  wrapEmailCard,
  EMAIL_BRAND,
  escapeHtml,
} from "@/lib/mailer";
import { APPEAL_CONTACT, SITE_INFO } from "@/lib/site-info";
import { CATEGORY_LABEL, SOURCE_LABEL, type InquirySource } from "@/lib/inquiry";

export async function notifyNewInquiry(opts: {
  source: InquirySource;
  category: string;
  message: string;
  contactEmail: string;
  orgName?: string | null;
  orgId?: number | null;
}): Promise<void> {
  const orgId = opts.orgId ?? null;
  if (!(await isSmtpAvailable(orgId))) return;

  const sourceLabel = SOURCE_LABEL[opts.source];
  const categoryLabel = CATEGORY_LABEL[opts.category] ?? opts.category;
  const adminUrl = `${SITE_INFO.baseUrl}/admin/inquiries`;
  const subject = `[${SITE_INFO.serviceName}] ${sourceLabel} 문의 접수 — ${categoryLabel}`;

  const innerHtml = `
    <h2 style="margin:8px 0 16px;font-size:18px;color:${EMAIL_BRAND.ink};line-height:1.4;">
      새 ${escapeHtml(sourceLabel)} 문의가 접수되었습니다
    </h2>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;margin:0 0 16px;">
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:#64748b;width:80px;">분류</td>
        <td style="padding:12px 16px;font-size:13px;color:${EMAIL_BRAND.ink};font-weight:600;">${escapeHtml(categoryLabel)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">법인</td>
        <td style="padding:12px 16px;font-size:13px;color:${EMAIL_BRAND.ink};border-top:1px solid #e2e8f0;">${escapeHtml(opts.orgName ?? "-")}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">연락처</td>
        <td style="padding:12px 16px;font-size:13px;color:${EMAIL_BRAND.ink};border-top:1px solid #e2e8f0;">${escapeHtml(opts.contactEmail)}</td>
      </tr>
    </table>
    <div style="margin:0 0 20px;padding:14px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap;">${escapeHtml(opts.message)}</div>
    <div style="text-align:center;margin:8px 0;">
      <a href="${adminUrl}" style="display:inline-block;padding:12px 28px;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">
        문의함에서 처리하기
      </a>
    </div>
  `;
  const html = wrapEmailCard({
    innerHtml,
    footer: `본 메일은 ${SITE_INFO.serviceName} 고객센터에 문의가 접수되어 자동 발송되었습니다.`,
  });
  const text = `새 ${sourceLabel} 문의가 접수되었습니다.

분류: ${categoryLabel}
법인: ${opts.orgName ?? "-"}
연락처: ${opts.contactEmail}

내용:
${opts.message}

처리: ${adminUrl}`;

  await sendMail({
    to: APPEAL_CONTACT.email,
    subject,
    html,
    text,
    orgId,
    audience: "org",
  });
}

/**
 * 고객센터 문의 통지 — 접수 통지 + 처리 결과 회신.
 *
 * 접수 시(notifyNewInquiry):
 *   1) 시스템 관리자(운영자 지원 데스크) 인앱 알림 — SMTP 무관, 항상 시도.
 *      → 운영자가 로그인하면 알림 벨에 바로 뜸(문의함을 직접 열지 않아도 인지).
 *   2) Slack(SLACK_WEBHOOK_URL) 즉시 푸시 — 메타데이터만. 본문·연락처는 PII 라
 *      국외 리전인 Slack 에 보내지 않는다(내용은 /admin/inquiries 에서).
 *   3) 지원 이메일(APPEAL_CONTACT = DPO/문의 단일 채널)로 통지 메일 — SMTP 있을 때만.
 *
 * 처리/완료 시(notifyInquiryReply):
 *   1) 문의자가 로그인 고객(userId 있음)이면 인앱 알림 — SMTP 무관, 항상 시도.
 *   2) 문의자(고객/후보자) 회신용 이메일로 운영팀 답변·처리 상태를 발송.
 *      → 비로그인 후보자도 처리 결과를 확인할 수 있는 유일한 채널.
 *
 * 호출은 라우트에서 next/server `after()` 로 — 응답 반환 후 서버리스 인스턴스가
 * suspend 되기 전에 실행이 보장된다 (void fire-and-forget 은 유실될 수 있음).
 * SMTP 미설정이면 메일은 조용히 skip (인박스/내 문의 내역에는 남으므로 누락 아님).
 */
import {
  sendMail,
  isSmtpAvailable,
  wrapEmailCard,
  EMAIL_BRAND,
  escapeHtml,
} from "@/lib/mailer";
import { APPEAL_CONTACT, SITE_INFO } from "@/lib/site-info";
import {
  CATEGORY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  type InquirySource,
  type InquiryStatus,
} from "@/lib/inquiry";
import { createNotification, notifySystemAdmins } from "@/lib/notifications";
import { notifyOps } from "@/lib/error-reporter";

export async function notifyNewInquiry(opts: {
  source: InquirySource;
  category: string;
  message: string;
  contactEmail: string;
  contactPhone?: string | null;
  orgName?: string | null;
  orgId?: number | null;
}): Promise<void> {
  const orgId = opts.orgId ?? null;
  const sourceLabel = SOURCE_LABEL[opts.source];
  const categoryLabel = CATEGORY_LABEL[opts.category] ?? opts.category;

  // 1) 인앱 알림 — 시스템 관리자(운영자) 전원. SMTP 와 무관하게 항상 시도.
  try {
    await notifySystemAdmins({
      type: "new_inquiry",
      title: `${sourceLabel} 문의 접수 — ${categoryLabel}`,
      href: "/admin/inquiries",
      payload: { source: opts.source, category: opts.category, orgId },
    });
  } catch (e) {
    console.error("[inquiry] 인앱 알림 실패:", e);
  }

  // 2) Slack 즉시 푸시 — 본문·연락처(PII)는 제외, 메타데이터만.
  await notifyOps(
    `📬 새 ${sourceLabel} 문의 — ${categoryLabel}${opts.orgName ? ` · ${opts.orgName}` : ""}\n처리: ${SITE_INFO.baseUrl}/admin/inquiries`
  ).catch(() => {});

  // 3) 지원 이메일 통지 — 수신자가 운영팀이므로 항상 시스템 기본 SMTP(env)로 발송.
  //    문의한 법인의 SMTP 로 라우팅하면 법인 설정 오류에 따라 조용히 누락된다.
  if (!(await isSmtpAvailable(null))) return;

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
        <td style="padding:12px 16px;font-size:13px;color:${EMAIL_BRAND.ink};border-top:1px solid #e2e8f0;">${escapeHtml(opts.contactEmail)}${opts.contactPhone ? ` · ${escapeHtml(opts.contactPhone)}` : ""}</td>
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
연락처: ${opts.contactEmail}${opts.contactPhone ? ` · ${opts.contactPhone}` : ""}

내용:
${opts.message}

처리: ${adminUrl}`;

  await sendMail({
    to: APPEAL_CONTACT.email,
    subject,
    html,
    text,
    orgId: null,
    audience: "org",
  });
}

/**
 * 문의 처리 결과 회신 — 문의자(고객/후보자)의 회신용 이메일로 발송.
 *
 * 운영팀(Intervia)이 답변/처리하는 채널이므로 발신은 항상 시스템 기본 메일(env SMTP).
 * 법인 SMTP 는 사용하지 않는다(orgId 미전달) — 후보자가 "회사" 가 아닌 "운영팀" 발신으로 인지.
 * 후보자(candidate)는 별도 계정·조회 화면이 없으므로 이 메일이 유일한 처리 확인 수단.
 */
export async function notifyInquiryReply(opts: {
  source: InquirySource;
  category: string;
  status: InquiryStatus;
  adminNote: string | null;
  contactEmail: string;
  /** 문의자 userId (org_user 문의만 존재). 있으면 인앱 알림 발송. */
  userId?: number | null;
}): Promise<void> {
  const categoryLabel = CATEGORY_LABEL[opts.category] ?? opts.category;
  const statusLabel = STATUS_LABEL[opts.status];
  const resolved = opts.status === "resolved";
  const note = opts.adminNote?.trim() || "";

  // 1) 문의자 인앱 알림 — 로그인 고객만. SMTP 와 무관하게 항상 시도.
  if (opts.userId) {
    try {
      await createNotification({
        userId: opts.userId,
        type: "inquiry_replied",
        title: resolved
          ? `문의가 처리 완료되었습니다 — ${categoryLabel}`
          : `문의에 운영팀 답변이 등록되었습니다 — ${categoryLabel}`,
        href: "/support",
        payload: { category: opts.category, status: opts.status },
      });
    } catch (e) {
      console.error("[inquiry] 회신 인앱 알림 실패:", e);
    }
  }

  // 2) env(시스템 기본) SMTP 가용 시에만 발송. 미설정이면 조용히 skip.
  if (!(await isSmtpAvailable(null))) return;

  const subject = resolved
    ? `[${SITE_INFO.serviceName}] 문의가 처리 완료되었습니다 — ${categoryLabel}`
    : `[${SITE_INFO.serviceName}] 문의 처리 상태 안내 — ${categoryLabel}`;

  const headline = resolved
    ? "문의가 처리 완료되었습니다"
    : "문의 처리 상태가 변경되었습니다";

  const noteBlock = note
    ? `
    <div style="margin:0 0 8px;font-size:12px;color:#64748b;">운영팀 답변</div>
    <div style="margin:0 0 20px;padding:14px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;font-size:14px;color:#14532d;line-height:1.7;white-space:pre-wrap;">${escapeHtml(note)}</div>`
    : "";

  const innerHtml = `
    <h2 style="margin:8px 0 16px;font-size:18px;color:${EMAIL_BRAND.ink};line-height:1.4;">
      ${escapeHtml(headline)}
    </h2>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;margin:0 0 16px;">
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:#64748b;width:80px;">분류</td>
        <td style="padding:12px 16px;font-size:13px;color:${EMAIL_BRAND.ink};font-weight:600;">${escapeHtml(categoryLabel)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">처리 상태</td>
        <td style="padding:12px 16px;font-size:13px;color:${EMAIL_BRAND.ink};font-weight:600;border-top:1px solid #e2e8f0;">${escapeHtml(statusLabel)}</td>
      </tr>
    </table>
    ${noteBlock}
    <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
      추가 문의가 있으시면 본 메일에 회신해 주세요.
    </p>
  `;
  const html = wrapEmailCard({
    innerHtml,
    footer: `본 메일은 ${SITE_INFO.serviceName} 고객센터 문의 처리 결과로 자동 발송되었습니다.`,
  });
  const text = `${headline}

분류: ${categoryLabel}
처리 상태: ${statusLabel}
${note ? `\n운영팀 답변:\n${note}\n` : ""}
추가 문의가 있으시면 본 메일에 회신해 주세요.`;

  await sendMail({
    to: opts.contactEmail,
    subject,
    html,
    text,
    orgId: null,
    // org_user 만 법인 고객, candidate/applicant 는 개인(비로그인 후보자/지원자).
    audience: opts.source === "org_user" ? "org" : "candidate",
  });
}

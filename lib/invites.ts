/**
 * 법인 합류 초대 헬퍼.
 *
 * 정책 (사용자 결정 2026-05-17):
 *  - 공고 공유 → 이메일별 토큰 1회용, 7일 만료
 *  - 미가입자: /signup?invite=token 으로 자동 가입 + 즉시 active 멤버 (합류 요청 X)
 *  - 가입자(법인 없음): 로그인 후 자동 합류
 *  - 가입자(이미 다른 법인): 거절
 *  - 가입자(같은 법인): 무시 (이미 멤버)
 *  - 이메일 매칭: 초대장 이메일과 로그인/가입 이메일 일치해야 consume
 */
import crypto from "node:crypto";
import { EMAIL_BRAND, wrapEmailCard } from "./mailer";

export const INVITE_EXPIRY_DAYS = 7;
export const INVITE_MAX_PER_REQUEST = 20;

export function generateInviteToken(): string {
  return "inv_" + crypto.randomBytes(20).toString("hex");
}

export function inviteExpiresAt(from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + INVITE_EXPIRY_DAYS);
  return d.toISOString();
}

/** 콤마·세미콜론 구분 입력에서 이메일 추출 + 검증 + 중복 제거. */
export function parseEmailList(raw: string): {
  valid: string[];
  invalid: string[];
} {
  const tokens = raw
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (re.test(t)) valid.push(t);
    else invalid.push(t);
  }
  return { valid, invalid };
}

/** 법인 멤버를 공고 면접관으로 추가 알림 메일. 합류 토큰이 아니라 바로 공고 페이지로 이동. */
export function buildInterviewerAssignedEmail(opts: {
  inviterName: string;
  orgName: string;
  jobTitle: string;
  url: string;
}): { subject: string; html: string; text: string } {
  const { inviterName, orgName, jobTitle, url } = opts;
  const subject = `[Intervia] 공고 면접관으로 추가 — ${jobTitle}`;
  const text = `${inviterName}님이 ${orgName}의 "${jobTitle}" 공고 면접관으로 회원님을 추가했습니다.

후보자 상세·평가·스코어카드 작성 권한이 부여됩니다.
아래 링크로 바로 이동하세요:

${url}

Intervia 채용팀`;
  const esc = (s: string) =>
    s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const html = wrapEmailCard({
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">🎯 공고 면접관 지정</h1>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 12px;">
        <strong style="color:#0f172a;">${esc(inviterName)}</strong>님이
        <strong style="color:#0f172a;">${esc(orgName)}</strong>의
        "<strong style="color:#0f172a;">${esc(jobTitle)}</strong>" 공고 면접관으로 회원님을 추가했습니다.
      </p>
      <p style="font-size:13px;color:#475569;line-height:1.7;margin:0 0 20px;">
        후보자 상세·평가·스코어카드 작성 권한이 부여됩니다.
      </p>
      <p style="text-align:center;margin:0 0 16px;">
        <a href="${url}" style="display:inline-block;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">공고 바로 가기</a>
      </p>
    `,
    footer: "본 메일은 Intervia 채용 플랫폼에서 발송되었습니다.",
  });
  return { subject, html, text };
}

/** 초대 메일 본문 생성. */
export function buildInviteEmail(opts: {
  inviterName: string;
  orgName: string;
  jobTitle: string;
  url: string;
  expiresAt: string;
}): { subject: string; html: string; text: string } {
  const { inviterName, orgName, jobTitle, url, expiresAt } = opts;
  const expDate = new Date(expiresAt).toLocaleDateString("ko-KR");
  const subject = `[Intervia] ${orgName} 채용 공고 공유 — ${jobTitle}`;
  const text = `${inviterName}님이 ${orgName}의 채용 공고 "${jobTitle}" 를 공유했습니다.

아래 링크로 접속하면 ${orgName} 채용 시스템에 자동으로 합류됩니다 (별도 승인 절차 없음).

${url}

· 링크 유효기간: ${expDate}
· 본 링크는 1회용이며, 초대받은 이메일 주소로만 사용 가능합니다.

Intervia 채용팀`;
  const escapedTitle = jobTitle.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const escapedOrg = orgName.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const escapedInviter = inviterName.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const html = wrapEmailCard({
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">📢 채용 공고 공유</h1>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 12px;">
        <strong style="color:#0f172a;">${escapedInviter}</strong>님이 <strong style="color:#0f172a;">${escapedOrg}</strong>의 채용 공고
        "<strong style="color:#0f172a;">${escapedTitle}</strong>" 를 공유했습니다.
      </p>
      <p style="font-size:13px;color:#475569;line-height:1.7;margin:0 0 20px;">
        아래 버튼을 클릭하면 <strong style="color:#0f172a;">${escapedOrg}</strong> 채용 시스템에 자동으로 합류됩니다 (별도 승인 절차 없음).
      </p>
      <p style="text-align:center;margin:0 0 16px;">
        <a href="${url}" style="display:inline-block;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">합류 + 공고 보기</a>
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;">
        <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">안내</div>
        • 링크 유효기간: <strong>${expDate}</strong><br>
        • 본 링크는 1회용이며, 초대받은 이메일 주소로만 사용 가능합니다.
      </div>
    `,
    footer: "본 메일은 Intervia 채용 플랫폼에서 발송되었습니다.",
  });
  return { subject, html, text };
}

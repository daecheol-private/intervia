/**
 * 법인 합류 초대 헬퍼.
 *
 * 정책 (2026-06-08 갱신 — 공유는 일반 멤버도 가능하므로 신규 합류는 승인 필수):
 *  - 공고 공유 → 이메일별 토큰 1회용, 7일 만료
 *  - 미가입자: 초대 링크로 가입 → 합류 요청(pending) → **법인담당자 승인 후** active
 *  - 가입자(법인 없음): 로그인 후 수락 → 합류 요청(pending) → **법인담당자 승인 후** active
 *  - 가입자(같은 법인): 즉시 그 공고 면접관으로 등록 (이미 검증된 멤버)
 *  - 가입자(이미 다른 법인): 거절
 *  - 승인 시 미사용 초대를 honor → 공유 공고 면접관 자동 등록(공고 PIN 없이 확인 가능)
 *  - 이메일 매칭: 초대장 이메일과 로그인/가입 이메일 일치해야 함
 */
import crypto from "node:crypto";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { orgInvites, jobInterviewers, users } from "./schema";
import { EMAIL_BRAND, wrapEmailCard } from "./mailer";

export const INVITE_EXPIRY_DAYS = 7;
export const INVITE_MAX_PER_REQUEST = 20;

/**
 * 공유 공고 초대 honor — 사용자가 어떤 경로로든 그 법인의 **활성 멤버가 되는 순간** 호출.
 *
 * 이 사용자 이메일로 그 법인에 발급된 미사용 공고 초대(jobId 보유)를 모두 찾아
 * jobInterviewers 에 멱등 등록(onConflictDoNothing) + 초대 consume 한다.
 * → 공고 PIN 없이 후보자·평가를 바로 열람 가능.
 *
 * **왜 한 곳에 모으나**: 신규 합류 승인뿐 아니라 "거절 후 멤버 상태 토글로 다시 active",
 * "관리자 대리 인증으로 active" 등 **활성화 경로가 여러 개**다. 예전엔 honor 가 합류요청
 * 승인 핸들러에만 있어, 다른 경로로 active 가 되면 면접관 등록이 누락됐다(2026-06-09 버그).
 * 이제 active 전환 지점마다 이 헬퍼를 호출해 경로 무관하게 보장한다.
 *
 * **만료는 보지 않는다** — 활성화 자체가 본인확인이고, 초대 만료는 '링크 자가가입' 보안용이지
 * 공유 의사 자체의 만료가 아니다(합류 승인이 7일보다 늦을 수 있음).
 *
 * fire-and-forget 아님 — 호출처에서 await 해야 등록 완료 후 응답한다. 멱등이라 중복 호출 안전.
 *
 * @returns honor 된 jobId 목록 (없으면 빈 배열)
 */
export async function honorJobShareInvites(
  userId: number,
  orgId: number | null | undefined
): Promise<number[]> {
  if (!orgId) return [];

  const [u] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!u) return [];

  const pending = await db
    .select()
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.orgId, orgId),
        sql`lower(${orgInvites.email}) = lower(${u.email})`,
        isNull(orgInvites.usedAt),
        isNotNull(orgInvites.jobId)
      )
    );

  const now = new Date().toISOString();
  const honored: number[] = [];
  for (const inv of pending) {
    await db
      .insert(jobInterviewers)
      .values({
        jobId: inv.jobId!,
        userId,
        assignedByUserId: inv.invitedByUserId,
      })
      .onConflictDoNothing();
    await db
      .update(orgInvites)
      .set({ usedAt: now, usedByUserId: userId })
      .where(eq(orgInvites.id, inv.id));
    honored.push(inv.jobId!);
  }
  return honored;
}

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

아래 링크로 가입을 신청하시면, ${orgName} 법인담당자 승인 후 이 공고에
면접관으로 자동 등록됩니다. (등록되면 공고 비밀번호 없이 후보자·평가를 확인하실 수 있습니다.)
이미 ${orgName} 소속이라면 로그인 시 바로 이 공고 면접관으로 등록됩니다.

${url}

· 링크 유효기간: ${expDate}
· 본 링크는 초대받은 이메일 주소로만 사용 가능합니다.

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
        아래 버튼으로 가입을 신청하시면 <strong style="color:#0f172a;">${escapedOrg}</strong> 법인담당자 승인 후
        이 공고에 면접관으로 자동 등록됩니다. (공고 비밀번호 없이 후보자·평가 확인 가능)
        이미 <strong style="color:#0f172a;">${escapedOrg}</strong> 소속이라면 로그인 시 바로 등록됩니다.
      </p>
      <p style="text-align:center;margin:0 0 16px;">
        <a href="${url}" style="display:inline-block;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">가입 신청 / 로그인</a>
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;">
        <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">안내</div>
        • 링크 유효기간: <strong>${expDate}</strong><br>
        • 본 링크는 초대받은 이메일 주소로만 사용 가능합니다.
      </div>
    `,
    footer: "본 메일은 Intervia 채용 플랫폼에서 발송되었습니다.",
  });
  return { subject, html, text };
}

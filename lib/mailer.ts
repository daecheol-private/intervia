import nodemailer from "nodemailer";
import { db } from "./db";
import { orgSmtpConfigs, organizations } from "./schema";
import { eq } from "drizzle-orm";
import { decrypt } from "./crypto";
import { SITE_INFO } from "./site-info";

type Transporter = ReturnType<typeof nodemailer.createTransport>;

// 환경변수 fallback transporter — 법인 SMTP 미설정 시
let envCached: Transporter | null = null;

function envTransporter(): Transporter {
  if (envCached) return envCached;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new SmtpNotConfiguredError();
  envCached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return envCached;
}

type ResolvedSmtp = {
  transporter: Transporter;
  from: string;
  source: "org" | "env";
};

/** SmtpNotConfiguredError — 법인 SMTP 도 환경변수 SMTP 도 없을 때. UI 가 안내문구를 띄울 수 있도록 마커 코드 포함. */
export class SmtpNotConfiguredError extends Error {
  code = "smtp_not_configured" as const;
  constructor() {
    super("SMTP가 설정되지 않았습니다. 법인 관리자에게 메일 서버 등록을 요청하세요.");
  }
}

/** 법인 / 환경변수 어느 쪽이든 SMTP 가 사용 가능한지 확인. 발송 직전 사전 체크용. */
export async function isSmtpAvailable(orgId: number | null | undefined): Promise<boolean> {
  if (orgId) {
    const [cfg] = await db
      .select({ host: orgSmtpConfigs.host })
      .from(orgSmtpConfigs)
      .where(eq(orgSmtpConfigs.orgId, orgId));
    if (cfg) return true;
  }
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function resolveSmtp(orgId: number | null | undefined): Promise<ResolvedSmtp> {
  if (orgId) {
    const [cfg] = await db
      .select()
      .from(orgSmtpConfigs)
      .where(eq(orgSmtpConfigs.orgId, orgId));
    if (cfg) {
      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.authUser, pass: decrypt(cfg.authPass) },
      });
      const from = cfg.fromName
        ? `"${cfg.fromName}" <${cfg.fromEmail}>`
        : cfg.fromEmail;
      return { transporter, from, source: "org" };
    }
  }
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!;
  return { transporter: envTransporter(), from, source: "env" };
}

/**
 * audience:
 *   "candidate" — 지원자에게 가는 메일. preview/staging 에서 안전 차단 대상.
 *   "org"       — HR/면접관/DPO 등 회사 측 메일. preview 에서도 실제 발송 (외부 테스터 협업).
 * 기본값 "candidate" (분류 누락 = 안전 쪽으로 fail-safe).
 */
export type MailAudience = "candidate" | "org";

export type SendMailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  orgId?: number | null;
  audience?: MailAudience;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
};

const LOCAL_DEV_FALLBACK = "daecheol1983@gmail.com";

/**
 * 메일 강제 리다이렉트 정책.
 *
 * - 로컬 dev (NODE_ENV != production): 모든 메일 → LOCAL_DEV_FALLBACK
 * - Vercel Preview/Staging (MAIL_OVERRIDE_TO 설정):
 *     - audience=candidate → MAIL_OVERRIDE_TO (지원자에게 사고 차단)
 *     - audience=org → 실제 발송 (외부 HR 테스터 협업 가능)
 * - Production (MAIL_OVERRIDE_TO 미설정): 모두 실제 발송
 */
function resolveMailOverride(audience: MailAudience): string | null {
  if (process.env.NODE_ENV !== "production") {
    return LOCAL_DEV_FALLBACK;
  }
  const previewOverride = process.env.MAIL_OVERRIDE_TO;
  if (previewOverride && audience === "candidate") {
    return previewOverride;
  }
  return null;
}

/** "이름 <addr@x>" 또는 "addr@x" 형태에서 이메일 주소만 추출. */
function extractEmailAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

export async function sendMail({
  to,
  subject,
  html,
  text,
  orgId,
  audience = "candidate",
  attachments,
}: SendMailParams) {
  const { transporter, from, source } = await resolveSmtp(orgId);
  // 시스템 기본(Resend 등 env) 발송이고 후보자 대상이면 발신 표시이름에 법인명을 노출
  // → 후보자가 받은편지함에서 어느 회사 채용인지 바로 식별 (도메인은 intervia.kr 유지).
  // 법인이 자체 SMTP 를 등록한 경우(source==="org")는 회사 도메인·표시이름을 그대로 둔다.
  let finalFrom: string | { name: string; address: string } = from;
  if (source === "env" && audience === "candidate" && orgId) {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (org?.name) {
      finalFrom = {
        name: `${org.name} 채용팀 (${SITE_INFO.serviceName})`,
        address: extractEmailAddress(from),
      };
    }
  }
  const override = resolveMailOverride(audience);
  const finalTo = override ?? to;
  const finalSubject = override ? `[DEV→${to}] ${subject}` : subject;
  await transporter.sendMail({
    from: finalFrom,
    to: finalTo,
    subject: finalSubject,
    html,
    text,
    attachments,
  });
}

/** SMTP 설정 헬스체크. verify() 가 성공하면 ok, 실패시 에러 메시지 반환. */
export async function verifySmtpConfig(cfg: {
  host: string;
  port: number;
  secure: boolean;
  authUser: string;
  authPass: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.authUser, pass: cfg.authPass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** 모든 발송 메일 공통 — 녹색 IV 배지 + Intervia 워드마크. 인라인 CSS만 사용 (메일 클라이언트 호환). */
export const EMAIL_BRAND = {
  primary: "#0d4f3c",
  primaryDeep: "#073529",
  ink: "#0f1a14",
};

/**
 * 메일 HTML 에 사용자 입력(후보자 이름·공고명·가입자 이름 등)을 보간하기 전 이스케이프.
 * 누락 시 이력서 파일명/이름에 심은 `<a href>` 등이 법인 SMTP 발신 메일로 렌더되어
 * 피싱(HTML/링크 인젝션)이 가능하다. 속성 컨텍스트까지 막기 위해 " ' 도 포함.
 */
export function escapeHtml(s: string): string {
  return String(s ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!
  );
}

export function emailBrandHeader(): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
    <td width="36" valign="middle" style="width:36px;padding:0;">
      <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,${EMAIL_BRAND.primary},${EMAIL_BRAND.primaryDeep});color:#fff;font-weight:700;text-align:center;line-height:36px;font-size:15px;letter-spacing:-1px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">IV</div>
    </td>
    <td valign="middle" style="padding:0 0 0 10px;font-weight:700;color:${EMAIL_BRAND.ink};font-size:18px;letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1;">Intervia</td>
  </tr></table>`;
}

/**
 * 공통 카드 레이아웃. 모든 발송 메일의 외곽 셸을 표준화.
 * 안에 들어갈 본문(헤더 다음 영역)을 innerHtml 로 넘기면 됨.
 *
 * - footer: 옵션. 카드 하단에 들어갈 보조 정보(만료/안내문). HTML 가능.
 */
export function wrapEmailCard(opts: {
  innerHtml: string;
  footer?: string;
}): string {
  const footerBlock = opts.footer
    ? `<tr><td style="padding:16px 32px 24px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8;line-height:1.6;">${opts.footer}</td></tr>`
    : "";
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Pretendard',sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">${emailBrandHeader()}</td></tr>
        <tr><td style="padding:0 32px 24px;">${opts.innerHtml}</td></tr>
        ${footerBlock}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildInterviewEmail(opts: {
  candidateName: string;
  jobTitle: string;
  url: string;
  expiresAt: string;
  /** 면접을 발송한 채용 법인명. 후보자가 발신 주체를 확인할 수 있게 본문에 노출 (피싱 식별). */
  orgName?: string | null;
}): { subject: string; html: string; text: string } {
  const { candidateName, jobTitle, url, expiresAt, orgName } = opts;
  const sender = orgName?.trim() || null;
  const subject = sender
    ? `[${sender}] AI 면접 안내 — ${jobTitle}`
    : `[Intervia 면접 안내] ${jobTitle}`;
  const senderLine = sender ? `${sender} 채용팀` : "채용 담당자";
  const text = `안녕하세요 ${candidateName}님,

${senderLine}의 ${jobTitle} 포지션에 지원해 주셔서 감사합니다.
아래 링크를 통해 AI 면접(제공: Intervia)을 진행해 주시기 바랍니다.

${url}

링크 만료: ${expiresAt}

* 본 면접은 채팅 방식으로 약 10~30분 소요됩니다.
* 면접 결과는 채용 담당자에게 전달되며 후속 안내드릴 예정입니다.
* 충분한 시간과 집중할 수 있는 환경에서 진행해 주세요.
* 답변에 외부 도구(ChatGPT 등)의 복사·붙여넣기를 다량 사용하면 평가 리포트에 표시될 수 있습니다.

[안전 안내]
* 본 면접은 비밀번호·결제·금융정보·주민등록번호·신분증 사본을 절대 요구하지 않습니다.
* 위 링크는 본인 전용이며, 타인에게 전달하지 마세요.
* 요청한 적이 없거나 의심스러우면 지원하신 회사에 직접 문의해 주세요.

내 정보 보기 / 평가 조회: ${url}/me

감사합니다.`;

  const html = wrapEmailCard({
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">${escapeHtml(candidateName)}님, 안녕하세요.</h1>
      <p style="color:#475569;line-height:1.6;margin:0 0 20px;">
        ${sender ? `<strong style="color:#0f172a;">${escapeHtml(sender)}</strong> 채용팀의 ` : ""}<strong style="color:#0f172a;">${escapeHtml(jobTitle)}</strong> 포지션에 지원해 주셔서 감사합니다.<br>
        아래 버튼을 통해 AI 면접을 진행해 주시기 바랍니다.
      </p>
      <p style="text-align:center;margin:0 0 16px;">
        <a href="${url}" style="display:inline-block;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">면접 시작하기</a>
      </p>
      <p style="font-size:12px;color:#64748b;margin:0 0 20px;text-align:center;">
        버튼이 동작하지 않으면 아래 링크를 복사해 주세요:<br>
        <a href="${url}" style="color:${EMAIL_BRAND.primary};word-break:break-all;">${url}</a>
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;">
        <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">면접 안내</div>
        • 채팅 방식으로 약 10~30분 소요됩니다.<br>
        • 평가 결과는 채용 담당자에게 직접 전달됩니다.<br>
        • <strong>충분한 시간과 집중할 수 있는 환경</strong>에서 진행해 주세요.<br>
        • 답변에 <strong>외부 도구(ChatGPT 등)의 복사·붙여넣기</strong>를 다량 사용하면 평가 리포트에 표시될 수 있습니다.<br>
        • 링크 만료: <strong>${expiresAt}</strong>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;font-size:12px;color:#92400e;line-height:1.6;margin-top:12px;">
        <div style="font-weight:700;margin-bottom:4px;">🔒 안전 안내</div>
        • 본 면접은 <strong>비밀번호·결제·금융정보·주민등록번호·신분증 사본</strong>을 절대 요구하지 않습니다.<br>
        • 위 링크는 <strong>본인 전용</strong>이며 타인에게 전달하지 마세요.<br>
        • 요청한 적이 없거나 의심스러우면 ${sender ? `<strong>${escapeHtml(sender)}</strong>에 ` : "지원하신 회사에 "}직접 문의해 주세요.
      </div>
    `,
    footer: `<a href="${url}/me" style="color:#64748b;text-decoration:underline;">내 정보 보기 / 평가 조회</a><br><br>본 메일은 ${sender ? `${escapeHtml(sender)}의 채용 절차를 위해 ` : ""}Intervia 시스템에서 자동 발송되었습니다.`,
  });

  return { subject, html, text };
}

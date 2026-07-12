import nodemailer from "nodemailer";
import type SMTPPool from "nodemailer/lib/smtp-pool";
import path from "node:path";
import { db } from "./db";
import { orgSmtpConfigs, organizations } from "./schema";
import { eq } from "drizzle-orm";
import { decrypt } from "./crypto";
import { SITE_INFO, APPEAL_CONTACT } from "./site-info";
import { readStoredFile, contentTypeFromName } from "./storage";
import { isValidBrandColor, textColorOn } from "./brand-color";
import { EMAIL_LOGO_PNG_BASE64 } from "./email-logo-data";

// 모든 발송 transporter 는 pooled (페이싱·연결 재사용) — verify 용 일회성 제외.
type Transporter = nodemailer.Transporter<SMTPPool.SentMessageInfo>;

// 발송 페이싱 — Resend 는 팀 단위 rate limit(기본 5rps, 구계정 2rps)이 있어 동시 발송이
// 몰리면 일부가 429 로 거부된다 (일괄 불합격 통보 6건 중 4건 누락 사고).
// nodemailer pooled transport 의 rateDelta/rateLimit 가 프로세스 내 발송 속도를 강제한다.
// Resend 한도 상향 후엔 MAIL_RATE_PER_SEC 만 올리면 됨.
const MAIL_RATE_PER_SEC = Number(process.env.MAIL_RATE_PER_SEC ?? 2);

function poolOpts() {
  return {
    pool: true as const,
    maxConnections: 2,
    rateDelta: 1000,
    rateLimit: MAIL_RATE_PER_SEC,
  };
}

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
    ...poolOpts(),
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

// 법인 SMTP transporter 캐시 — 발송마다 새 연결(TLS+AUTH ~1초)을 만들면 느리고
// 동시 발송 시 동시접속 제한에 걸린다. 설정 변경 시 fingerprint 불일치로 재생성.
const orgCached = new Map<number, { fp: string; t: Transporter }>();

async function resolveSmtp(orgId: number | null | undefined): Promise<ResolvedSmtp> {
  if (orgId) {
    const [cfg] = await db
      .select()
      .from(orgSmtpConfigs)
      .where(eq(orgSmtpConfigs.orgId, orgId));
    if (cfg) {
      const fp = [cfg.host, cfg.port, cfg.secure, cfg.authUser, cfg.authPass].join(" ");
      let entry = orgCached.get(orgId);
      if (!entry || entry.fp !== fp) {
        entry?.t.close();
        entry = {
          fp,
          t: nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: { user: cfg.authUser, pass: decrypt(cfg.authPass) },
            ...poolOpts(),
          }),
        };
        orgCached.set(orgId, entry);
      }
      const from = cfg.fromName
        ? `"${cfg.fromName}" <${cfg.fromEmail}>`
        : cfg.fromEmail;
      return { transporter: entry.t, from, source: "org" };
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
    /** 인라인 이미지용 Content-ID — HTML 에서 <img src="cid:..."> 로 참조. */
    cid?: string;
  }>;
};

const LOCAL_DEV_FALLBACK = "admin.intervia@gmail.com";

// env 발신 + 후보자 대상 발신 표시이름용 법인명 캐시 — 대량 발송 시 통마다 SELECT 방지.
const ORG_NAME_TTL_MS = 300_000;
const orgNameCache = new Map<number, { name: string | null; at: number }>();

async function orgDisplayName(orgId: number): Promise<string | null> {
  const hit = orgNameCache.get(orgId);
  if (hit && Date.now() - hit.at < ORG_NAME_TTL_MS) return hit.name;
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  const name = org?.name ?? null;
  orgNameCache.set(orgId, { name, at: Date.now() });
  return name;
}

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

// 재시도 대상 — provider rate limit(421/429/45x) 또는 일시적 소켓 오류.
// 페이싱은 프로세스 단위라 서버리스 다중 인스턴스 합산이 팀 한도를 넘길 수 있어 별도로 필요.
function isTransientMailError(e: unknown): boolean {
  const smtp = (e as { responseCode?: number } | null)?.responseCode;
  if (smtp === 421 || smtp === 429 || (smtp != null && smtp >= 450 && smtp <= 452)) return true;
  const errno = (e as { code?: string } | null)?.code;
  if (errno === "ETIMEDOUT" || errno === "ECONNRESET" || errno === "ECONNECTION" || errno === "ESOCKET") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /too many|rate ?limit|try again later/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_SEND_RETRIES = 3;

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
    const orgName = await orgDisplayName(orgId);
    if (orgName) {
      finalFrom = {
        name: `${orgName} 채용팀 (${SITE_INFO.serviceName})`,
        address: extractEmailAddress(from),
      };
    }
  }
  const override = resolveMailOverride(audience);
  const finalTo = override ?? to;
  const finalSubject = override ? `[DEV→${to}] ${subject}` : subject;
  // Intervia 로고를 CID 로 참조하는 메일(wrapEmailCard 사용분)엔 로고 첨부를 자동 병합
  // → 발송처마다 첨부를 넘길 필요 없이 헤더/푸터 마크가 항상 표시된다. cid 없는 메일
  //   (운영 알림 <pre> 등)엔 붙이지 않는다.
  const finalAttachments =
    html.includes(`cid:${INTERVIA_LOGO_CID}`)
      ? [...(attachments ?? []), interviaLogoAttachment()]
      : attachments;
  const message = {
    from: finalFrom,
    to: finalTo,
    subject: finalSubject,
    html,
    text,
    attachments: finalAttachments,
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await transporter.sendMail(message);
      return;
    } catch (e) {
      if (attempt >= MAX_SEND_RETRIES || !isTransientMailError(e)) throw e;
      const backoff = 1000 * 2 ** attempt + Math.random() * 300;
      console.warn(
        `[mailer] 일시 오류 — ${Math.round(backoff)}ms 후 재발송 (${attempt + 1}/${MAX_SEND_RETRIES}, to=${finalTo}):`,
        String(e)
      );
      await sleep(backoff);
    }
  }
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

/** 모든 발송 메일 공통 — 브랜드 로고(CID 인라인) + Intervia 워드마크. 인라인 CSS만 사용 (메일 클라이언트 호환). */
export const EMAIL_BRAND = {
  primary: "#1c3478",
  primaryDeep: "#13234f",
  ink: "#0c1116",
};

/**
 * Intervia 마크의 CID — 헤더/푸터에서 `<img src="cid:intervia-logo">` 로 참조.
 * 원격 URL 대신 메일에 동봉(sendMail 이 자동 첨부)해 수신함에서 즉시 표시된다.
 */
const INTERVIA_LOGO_CID = "intervia-logo";

/** Intervia 로고 CID 인라인 첨부 (base64 상수 → Buffer). sendMail 이 HTML 참조 감지 시 자동 병합. */
function interviaLogoAttachment(): NonNullable<SendMailParams["attachments"]>[number] {
  return {
    filename: "intervia-logo.png",
    content: Buffer.from(EMAIL_LOGO_PNG_BASE64, "base64"),
    contentType: "image/png",
    cid: INTERVIA_LOGO_CID,
  };
}

/**
 * 지원자 대상 메일의 법인 브랜딩 — 지원 페이지/AI 면접 화면의 헤더 밴드와 동일한 인상.
 * 로고는 private Blob 에 있어 공개 URL 이 없으므로 CID 인라인 첨부로 메일에 동봉한다.
 */
export type OrgEmailBranding = {
  orgName: string;
  /** 검증된 #rrggbb — 미설정 시 null (기본 네이비 밴드). */
  brandColor: string | null;
  /** CID 인라인 첨부용 로고 — 미설정 시 null (법인명 텍스트 밴드). */
  logo: {
    filename: string;
    content: Buffer;
    contentType: string;
    cid: string;
  } | null;
};

const ORG_LOGO_CID = "org-brand-logo";

// 일괄 발송에서 통마다 org 조회 + 로고 Blob fetch 를 반복하지 않도록 캐시 (orgNameCache 와 동일 TTL).
const brandingCache = new Map<
  number,
  { at: number; value: OrgEmailBranding | null }
>();

/**
 * 지원자 대상 메일의 법인 브랜딩 조회 — 로고·브랜드컬러 중 하나라도 설정된 법인만 값 반환.
 * 미설정/조회 실패 시 null → wrapEmailCard 가 기존 Intervia 헤더로 발송 (메일은 항상 나간다).
 */
export async function getOrgEmailBranding(
  orgId: number | null | undefined
): Promise<OrgEmailBranding | null> {
  if (!orgId) return null;
  const hit = brandingCache.get(orgId);
  if (hit && Date.now() - hit.at < ORG_NAME_TTL_MS) return hit.value;
  let value: OrgEmailBranding | null = null;
  try {
    const [org] = await db
      .select({
        name: organizations.name,
        logoFileKey: organizations.logoFileKey,
        brandColor: organizations.brandColor,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (org && (org.logoFileKey || org.brandColor)) {
      let logo: OrgEmailBranding["logo"] = null;
      if (org.logoFileKey) {
        const buf = await readStoredFile(org.logoFileKey).catch(() => null);
        if (buf)
          logo = {
            filename: `logo${path.extname(org.logoFileKey) || ".png"}`,
            content: buf,
            contentType: contentTypeFromName(org.logoFileKey),
            cid: ORG_LOGO_CID,
          };
      }
      const color =
        org.brandColor && isValidBrandColor(org.brandColor)
          ? org.brandColor
          : null;
      if (logo || color) value = { orgName: org.name, brandColor: color, logo };
    }
  } catch (e) {
    console.warn(
      `[mailer] 브랜딩 조회 실패 — 기본 헤더로 발송 (org=${orgId}):`,
      String(e)
    );
    return null; // 실패는 캐시하지 않음 — 다음 발송에서 재시도
  }
  brandingCache.set(orgId, { at: Date.now(), value });
  return value;
}

/** 브랜딩 로고 CID 첨부 — sendMail attachments 에 스프레드해 병합. */
export function brandingAttachments(
  b: OrgEmailBranding | null | undefined
): NonNullable<SendMailParams["attachments"]> {
  return b?.logo ? [b.logo] : [];
}

/** 메일 CTA 버튼 색 — 브랜드 컬러가 있으면 그 색(글자 대비 자동), 없으면 기본 네이비. */
export function emailCtaColors(b?: OrgEmailBranding | null): {
  bg: string;
  fg: string;
} {
  const bg = b?.brandColor ?? EMAIL_BRAND.primary;
  return { bg, fg: textColorOn(bg) };
}

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
      <img src="cid:${INTERVIA_LOGO_CID}" width="36" height="36" alt="Intervia" style="display:block;width:36px;height:36px;border-radius:8px;border:0;" />
    </td>
    <td valign="middle" style="padding:0 0 0 10px;font-weight:700;color:${EMAIL_BRAND.ink};font-size:18px;letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1;">Intervia</td>
  </tr></table>`;
}

/**
 * 카드 하단 Intervia 브랜드 서명 — 로고 마크 + 워드마크 + 서비스 설명.
 * 법인 브랜딩 밴드(헤더)에 가려 Intervia 식별이 약해지는 것을 하단에서 보강한다
 * (지원자에게 서비스 주체를 각인). 로고는 CID(sendMail 자동 첨부).
 */
function interviaFooterBrand(): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
      <td width="32" valign="middle" style="width:32px;padding:0;">
        <img src="cid:${INTERVIA_LOGO_CID}" width="32" height="32" alt="Intervia" style="display:block;width:32px;height:32px;border-radius:7px;border:0;" />
      </td>
      <td valign="middle" style="padding:0 0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="font-weight:700;color:${EMAIL_BRAND.ink};font-size:16px;letter-spacing:-0.3px;line-height:1.2;">${SITE_INFO.serviceName}</div>
        <div style="color:#94a3b8;font-size:11px;line-height:1.2;margin-top:2px;">${SITE_INFO.serviceDescription}</div>
      </td>
    </tr></table>`;
}

/**
 * 법인 브랜딩 헤더 밴드 — 지원 페이지 ApplyForm 밴드와 동일한 인상.
 * 로고(CID)가 있으면 로고 + 법인명 소문자 라벨, 없으면 법인명 텍스트만.
 * bgcolor 속성 병기는 Outlook(Word 렌더러) 배경색 호환용.
 */
function orgBrandBand(b: OrgEmailBranding): string {
  const bg = b.brandColor ?? EMAIL_BRAND.primary;
  const fg = textColorOn(bg);
  const name = escapeHtml(b.orgName);
  const inner = b.logo
    ? `<img src="cid:${b.logo.cid}" alt="${name}" height="40" style="display:block;height:40px;width:auto;max-width:100%;border:0;" />
      <div style="margin-top:10px;font-size:12px;font-weight:600;color:${fg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${name}</div>`
    : `<div style="font-size:19px;font-weight:700;color:${fg};letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${name}</div>`;
  return `<tr><td bgcolor="${bg}" style="background:${bg};padding:24px 32px;">${inner}</td></tr>`;
}

/**
 * 공통 카드 레이아웃. 모든 발송 메일의 외곽 셸을 표준화.
 * 안에 들어갈 본문(헤더 다음 영역)을 innerHtml 로 넘기면 됨.
 *
 * - footer: 옵션. 카드 하단에 들어갈 보조 정보(만료/안내문). HTML 가능.
 * - branding: 옵션. 지원자 대상 메일의 법인 브랜딩 — 헤더가 Intervia 대신 법인 밴드가 된다.
 *   로고를 CID 로 참조하므로 sendMail attachments 에 brandingAttachments() 를 함께 넘겨야 한다.
 */
export function wrapEmailCard(opts: {
  innerHtml: string;
  footer?: string;
  branding?: OrgEmailBranding | null;
}): string {
  // 하단 Intervia 브랜드 서명 — 항상 표시(footer 안내문은 있을 때만 그 아래에).
  const footerNote = opts.footer
    ? `<div style="margin-top:14px;font-size:11px;color:#94a3b8;line-height:1.6;">${opts.footer}</div>`
    : "";
  const footerBlock = `<tr><td style="padding:22px 32px 26px;border-top:1px solid #f1f5f9;">${interviaFooterBrand()}${footerNote}</td></tr>`;
  const headerRow = opts.branding
    ? orgBrandBand(opts.branding)
    : `<tr><td style="padding:32px 32px 8px;">${emailBrandHeader()}</td></tr>`;
  return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Pretendard',sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        ${headerRow}
        <tr><td style="padding:0 32px 24px;">${opts.innerHtml}</td></tr>
        ${footerBlock}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** 이의제기 검토 결과 통지 (PIPA §37의2 조치 결과 통지). resolved/rejected 전환 시 자동 발송. */
export function buildAppealResponseEmail(opts: {
  candidateName: string;
  jobTitle: string | null;
  status: "resolved" | "rejected";
  response: string | null;
  orgName?: string | null;
  /** 후보자 면접 언어. 후보자 대면 통지라 분기. 법조 근거(§37의2)는 한국어 정본 유지. 기본 'ko'. */
  lang?: "ko" | "en";
  branding?: OrgEmailBranding | null;
}): { subject: string; html: string; text: string } {
  const { candidateName, jobTitle, status, response, orgName } = opts;
  const en = opts.lang === "en";
  const sender = orgName?.trim() || null;
  const brand = sender ?? "Intervia";
  const resultLabel = en
    ? status === "resolved"
      ? "Resolved"
      : "Rejected (original evaluation upheld)"
    : status === "resolved"
      ? "처리 완료"
      : "기각 (원평가 유지)";
  const suffix = jobTitle ? ` — ${jobTitle}` : "";
  const subject = en
    ? `[${brand}] Objection review result${suffix}`
    : `[${brand}] 이의제기 검토 결과 안내${suffix}`;
  const answer =
    response?.trim() ||
    (en
      ? "The review has been completed. For details, please contact us at the address below."
      : "검토가 완료되었습니다. 자세한 내용은 아래 연락처로 문의해 주세요.");

  const text = en
    ? `Hello ${candidateName},

The review of the objection you submitted regarding the AI evaluation result has been completed.

Review result: ${resultLabel}

[Response]
${answer}

This is a notice of the result of measures under Article 37-2 of the Personal Information Protection Act (PIPA) of Korea. The Korean-language notice is the official version.
Contact: ${APPEAL_CONTACT.email}

Thank you.`
    : `안녕하세요 ${candidateName}님,

AI 평가 결과에 대해 제출해 주신 이의제기의 검토가 완료되어 결과를 안내드립니다.

검토 결과: ${resultLabel}

[답변 내용]
${answer}

본 메일은 개인정보 보호법 제37조의2에 따른 조치 결과 통지입니다.
추가 문의: ${APPEAL_CONTACT.email}

감사합니다.`;

  const introHtml = en
    ? `${jobTitle ? `The review of the objection you submitted regarding the AI evaluation result for the <strong style="color:#0f172a;">${escapeHtml(jobTitle)}</strong> position has been completed.` : "The review of the objection you submitted regarding the AI evaluation result has been completed."}`
    : `${jobTitle ? `<strong style="color:#0f172a;">${escapeHtml(jobTitle)}</strong> 포지션의 ` : ""}AI 평가 결과에 대해 제출해 주신 이의제기의 검토가 완료되어 결과를 안내드립니다.`;
  const html = wrapEmailCard({
    branding: opts.branding,
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">${en ? `Hello ${escapeHtml(candidateName)},` : `${escapeHtml(candidateName)}님, 안녕하세요.`}</h1>
      <p style="color:#475569;line-height:1.6;margin:0 0 20px;">
        ${introHtml}
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;margin-bottom:12px;">
        <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${en ? "Review result" : "검토 결과"}</div>
        <strong style="color:#0f172a;">${resultLabel}</strong>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap;">
        <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${en ? "Response" : "답변 내용"}</div>${escapeHtml(answer)}
      </div>
    `,
    footer: en
      ? `This is a notice of the result of measures under Article 37-2 of the Personal Information Protection Act (PIPA) of Korea${sender ? `, sent for ${escapeHtml(sender)}'s recruitment process` : ""} via Intervia. The Korean-language notice is the official version.<br>Contact: <a href="mailto:${APPEAL_CONTACT.email}" style="color:#64748b;">${APPEAL_CONTACT.email}</a>`
      : `본 메일은 개인정보 보호법 제37조의2에 따른 조치 결과 통지로, ${sender ? `${escapeHtml(sender)}의 채용 절차를 위해 ` : ""}Intervia 시스템에서 자동 발송되었습니다.<br>추가 문의: <a href="mailto:${APPEAL_CONTACT.email}" style="color:#64748b;">${APPEAL_CONTACT.email}</a>`,
  });

  return { subject, html, text };
}

/**
 * AI 면접 미응답 리마인더 메일 (후보자 대상).
 * 링크 발급 후 24h/48h 경과 + 미완료 시 cron 이 자동 발송. buildInterviewEmail 의 경량 버전 —
 * 새 안내가 아니라 "아직 면접을 완료하지 않으셨다"는 넛지이므로 본문을 짧게 유지한다.
 */
export function buildInterviewReminderEmail(opts: {
  candidateName: string;
  jobTitle: string;
  url: string;
  expiresAt: string;
  orgName?: string | null;
  branding?: OrgEmailBranding | null;
}): { subject: string; html: string; text: string } {
  const { candidateName, jobTitle, url, expiresAt, orgName } = opts;
  const cta = emailCtaColors(opts.branding);
  const sender = orgName?.trim() || null;
  // 리마인더는 발급 후 미완료(주로 pending) 세션에도 나가므로 지원자가 아직 면접 언어를
  // 고르기 전이다 — 세션 언어로 분기할 수 없어, 초대 메일과 동일하게 한/영 병기로 보낸다.
  const subject = sender
    ? `[${sender}] AI 면접 미완료 안내 / Interview reminder — ${jobTitle}`
    : `[Intervia] AI 면접 미완료 안내 / Interview reminder — ${jobTitle}`;
  const senderLine = sender ? `${sender} 채용팀` : "채용 담당자";
  const text = `안녕하세요 ${candidateName}님,

${senderLine}의 ${jobTitle} 포지션 AI 면접(제공: Intervia)이 아직 완료되지 않았습니다.
아래 링크로 이어서 진행해 주세요. (이미 완료하셨다면 본 안내는 무시하셔도 됩니다.)

${url}

링크 만료: ${expiresAt}

* 채팅 방식으로 약 10~30분 소요됩니다.
* 충분한 시간과 집중할 수 있는 환경에서 진행해 주세요.
* 원활한 진행을 위해 PC(데스크톱/노트북) 접속을 권장합니다.

[안전 안내]
* 본 면접은 비밀번호·결제·금융정보·주민등록번호·신분증 사본을 절대 요구하지 않습니다.
* 위 링크는 본인 전용이며, 타인에게 전달하지 마세요.

감사합니다.

— English —

Hello ${candidateName},

Your AI interview (powered by Intervia) for the ${jobTitle} position${sender ? ` at ${sender}` : ""} has not been completed yet.
Please continue using the link below. (If you have already finished, please ignore this message.)

${url}

Link expires: ${expiresAt}

* Chat-based, about 10-30 minutes.
* Please use a quiet environment with enough time.
* We recommend using a PC (desktop/laptop) for the best experience.

[Safety notice]
* This interview never asks for passwords, payment, financial information, your national ID, or ID copies.
* This link is for you only - please do not share it.

Thank you.`;

  const html = wrapEmailCard({
    branding: opts.branding,
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">${escapeHtml(candidateName)}님, 안녕하세요.</h1>
      <p style="color:#475569;line-height:1.6;margin:0 0 20px;">
        ${sender ? `<strong style="color:#0f172a;">${escapeHtml(sender)}</strong> 채용팀의 ` : ""}<strong style="color:#0f172a;">${escapeHtml(jobTitle)}</strong> 포지션 AI 면접이 <strong style="color:#0f172a;">아직 완료되지 않았습니다.</strong><br>
        아래 버튼으로 이어서 진행해 주세요. 이미 완료하셨다면 본 안내는 무시하셔도 됩니다.
      </p>
      <p style="text-align:center;margin:0 0 16px;">
        <a href="${url}" style="display:inline-block;background:${cta.bg};color:${cta.fg};text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">면접 이어서 진행하기</a>
      </p>
      <p style="font-size:12px;color:#64748b;margin:0 0 20px;text-align:center;">
        버튼이 동작하지 않으면 아래 링크를 복사해 주세요:<br>
        <a href="${url}" style="color:${EMAIL_BRAND.primary};word-break:break-all;">${url}</a>
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;">
        • 채팅 방식으로 약 10~30분 소요됩니다.<br>
        • <strong>충분한 시간과 집중할 수 있는 환경</strong>에서 진행해 주세요.<br>
        • 원활한 진행을 위해 <strong>PC(데스크톱/노트북)</strong> 접속을 권장합니다.<br>
        • 링크 만료: <strong>${expiresAt}</strong>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;font-size:12px;color:#92400e;line-height:1.6;margin-top:12px;">
        <div style="font-weight:700;margin-bottom:4px;">🔒 안전 안내</div>
        • 본 면접은 <strong>비밀번호·결제·금융정보·주민등록번호·신분증 사본</strong>을 절대 요구하지 않습니다.<br>
        • 위 링크는 <strong>본인 전용</strong>이며 타인에게 전달하지 마세요.
      </div>
      <div style="border-top:1px solid #e2e8f0;margin:28px 0 0;padding-top:20px;">
        <h2 style="font-size:18px;margin:4px 0 8px;color:#0f172a;">Hello ${escapeHtml(candidateName)},</h2>
        <p style="color:#475569;line-height:1.6;margin:0 0 20px;">
          Your AI interview (powered by Intervia) for the <strong style="color:#0f172a;">${escapeHtml(jobTitle)}</strong> position${sender ? ` at <strong style="color:#0f172a;">${escapeHtml(sender)}</strong>` : ""} has <strong style="color:#0f172a;">not been completed yet.</strong><br>
          Please continue using the button below. If you have already finished, please ignore this message.
        </p>
        <p style="text-align:center;margin:0 0 16px;">
          <a href="${url}" style="display:inline-block;background:${cta.bg};color:${cta.fg};text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">Continue interview</a>
        </p>
        <p style="font-size:12px;color:#64748b;margin:0 0 20px;text-align:center;">
          If the button does not work, copy this link:<br>
          <a href="${url}" style="color:${EMAIL_BRAND.primary};word-break:break-all;">${url}</a>
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;">
          • Chat-based, about 10–30 minutes.<br>
          • <strong>Use a quiet environment with enough time.</strong><br>
          • We recommend using a <strong>PC (desktop/laptop)</strong> for the best experience.<br>
          • Link expires: <strong>${expiresAt}</strong>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;font-size:12px;color:#92400e;line-height:1.6;margin-top:12px;">
          <div style="font-weight:700;margin-bottom:4px;">🔒 Safety notice</div>
          • This interview never asks for <strong>passwords, payment, financial information, your national ID, or ID copies</strong>.<br>
          • This link is <strong>for you only</strong> — please do not share it.
        </div>
      </div>
    `,
    footer: `본 메일은 ${sender ? `${escapeHtml(sender)}의 채용 절차를 위해 ` : ""}Intervia 시스템에서 자동 발송되었습니다.`,
  });

  return { subject, html, text };
}

export function buildInterviewEmail(opts: {
  candidateName: string;
  jobTitle: string;
  url: string;
  expiresAt: string;
  /** 면접을 발송한 채용 법인명. 후보자가 발신 주체를 확인할 수 있게 본문에 노출 (피싱 식별). */
  orgName?: string | null;
  branding?: OrgEmailBranding | null;
}): { subject: string; html: string; text: string } {
  const { candidateName, jobTitle, url, expiresAt, orgName } = opts;
  const cta = emailCtaColors(opts.branding);
  const sender = orgName?.trim() || null;
  const subject = sender
    ? `[${sender}] AI 면접 안내 / Interview Invitation — ${jobTitle}`
    : `[Intervia] AI 면접 안내 / Interview Invitation — ${jobTitle}`;
  const senderLine = sender ? `${sender} 채용팀` : "채용 담당자";
  const text = `안녕하세요 ${candidateName}님,

${senderLine}의 ${jobTitle} 포지션에 지원해 주셔서 감사합니다.
아래 링크를 통해 AI 면접(제공: Intervia)을 진행해 주시기 바랍니다.

${url}

링크 만료: ${expiresAt}

* 본 면접은 채팅 방식으로 약 10~30분 소요됩니다.
* 면접 결과는 채용 담당자에게 전달되며 후속 안내드릴 예정입니다.
* 충분한 시간과 집중할 수 있는 환경에서 진행해 주세요.
* 원활한 진행을 위해 PC(데스크톱/노트북) 접속을 권장합니다.
* 답변에 외부 도구(ChatGPT 등)의 복사·붙여넣기를 다량 사용하면 평가 리포트에 표시될 수 있습니다.

[안전 안내]
* 본 면접은 비밀번호·결제·금융정보·주민등록번호·신분증 사본을 절대 요구하지 않습니다.
* 위 링크는 본인 전용이며, 타인에게 전달하지 마세요.
* 요청한 적이 없거나 의심스러우면 지원하신 회사에 직접 문의해 주세요.

내 정보 보기 / 평가 조회: ${url}/me

감사합니다.

— English —

Hello ${candidateName},

Thank you for applying to the ${jobTitle} position${sender ? ` at ${sender}` : ""}. Please take your AI interview (powered by Intervia) via the link below.

${url}

Link expires: ${expiresAt}

* Chat-based, about 10-30 minutes.
* Your results are sent to the recruiter; you will be contacted with next steps.
* Please use a quiet environment with enough time.
* We recommend using a PC (desktop/laptop) for the best experience.
* Heavy copy-paste from external tools (e.g., ChatGPT) may be flagged in the evaluation report.

[Safety notice]
* This interview never asks for passwords, payment, financial information, your national ID, or ID copies.
* This link is for you only - please do not share it.
* If you did not expect this or it seems suspicious, contact the company directly.

View my info / results: ${url}/me

Thank you.`;

  const html = wrapEmailCard({
    branding: opts.branding,
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">${escapeHtml(candidateName)}님, 안녕하세요.</h1>
      <p style="color:#475569;line-height:1.6;margin:0 0 20px;">
        ${sender ? `<strong style="color:#0f172a;">${escapeHtml(sender)}</strong> 채용팀의 ` : ""}<strong style="color:#0f172a;">${escapeHtml(jobTitle)}</strong> 포지션에 지원해 주셔서 감사합니다.<br>
        아래 버튼을 통해 AI 면접을 진행해 주시기 바랍니다.
      </p>
      <p style="text-align:center;margin:0 0 16px;">
        <a href="${url}" style="display:inline-block;background:${cta.bg};color:${cta.fg};text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">면접 시작하기</a>
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
        • 원활한 진행을 위해 <strong>PC(데스크톱/노트북)</strong> 접속을 권장합니다.<br>
        • 답변에 <strong>외부 도구(ChatGPT 등)의 복사·붙여넣기</strong>를 다량 사용하면 평가 리포트에 표시될 수 있습니다.<br>
        • 링크 만료: <strong>${expiresAt}</strong>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;font-size:12px;color:#92400e;line-height:1.6;margin-top:12px;">
        <div style="font-weight:700;margin-bottom:4px;">🔒 안전 안내</div>
        • 본 면접은 <strong>비밀번호·결제·금융정보·주민등록번호·신분증 사본</strong>을 절대 요구하지 않습니다.<br>
        • 위 링크는 <strong>본인 전용</strong>이며 타인에게 전달하지 마세요.<br>
        • 요청한 적이 없거나 의심스러우면 ${sender ? `<strong>${escapeHtml(sender)}</strong>에 ` : "지원하신 회사에 "}직접 문의해 주세요.
      </div>
      <div style="border-top:1px solid #e2e8f0;margin:28px 0 0;padding-top:20px;">
        <h2 style="font-size:18px;margin:4px 0 8px;color:#0f172a;">Hello ${escapeHtml(candidateName)},</h2>
        <p style="color:#475569;line-height:1.6;margin:0 0 20px;">
          Thank you for applying to the <strong style="color:#0f172a;">${escapeHtml(jobTitle)}</strong> position${sender ? ` at <strong style="color:#0f172a;">${escapeHtml(sender)}</strong>` : ""}. Please take your AI interview (powered by Intervia) using the button below.
        </p>
        <p style="text-align:center;margin:0 0 16px;">
          <a href="${url}" style="display:inline-block;background:${cta.bg};color:${cta.fg};text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">Start interview</a>
        </p>
        <p style="font-size:12px;color:#64748b;margin:0 0 20px;text-align:center;">
          If the button does not work, copy this link:<br>
          <a href="${url}" style="color:${EMAIL_BRAND.primary};word-break:break-all;">${url}</a>
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;">
          <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Interview info</div>
          • Chat-based, about 10–30 minutes.<br>
          • Your results are sent directly to the recruiter.<br>
          • <strong>Use a quiet environment with enough time.</strong><br>
          • We recommend using a <strong>PC (desktop/laptop)</strong> for the best experience.<br>
          • <strong>Heavy copy-paste from external tools (e.g., ChatGPT)</strong> may be flagged in the report.<br>
          • Link expires: <strong>${expiresAt}</strong>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;font-size:12px;color:#92400e;line-height:1.6;margin-top:12px;">
          <div style="font-weight:700;margin-bottom:4px;">🔒 Safety notice</div>
          • This interview never asks for <strong>passwords, payment, financial information, your national ID, or ID copies</strong>.<br>
          • This link is <strong>for you only</strong> — please do not share it.<br>
          • If you did not expect this or it seems suspicious, contact ${sender ? `<strong>${escapeHtml(sender)}</strong>` : "the company"} directly.
        </div>
        <p style="font-size:12px;color:#64748b;margin:16px 0 0;text-align:center;">
          <a href="${url}/me" style="color:${EMAIL_BRAND.primary};">View my info / results</a>
        </p>
      </div>
    `,
    footer: `<a href="${url}/me" style="color:#64748b;text-decoration:underline;">내 정보 보기 / 평가 조회</a><br><br>본 메일은 ${sender ? `${escapeHtml(sender)}의 채용 절차를 위해 ` : ""}Intervia 시스템에서 자동 발송되었습니다.`,
  });

  return { subject, html, text };
}

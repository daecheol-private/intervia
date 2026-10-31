/**
 * 지원 링크 중복 지원·명의도용 신고 (보안 감사 M2 결정, 2026-10-31).
 *
 * 같은 공고 안에서 정규화한 휴대폰 번호가 같으면 중복이다. 번호 주인이 "본인이 제출하지 않았다"면
 * 그 번호로 받은 인증번호(lib/phone-otp.ts)로 확인한 뒤 새 지원서를 낼 수 있고, 먼저 접수된
 * 지원서는 "명의도용 신고됨"이 된다 — 자동 진행 중단 + 서류평가 차감 환불, 행은 그대로 남긴다.
 *
 * 인증번호 발송은 제출 시 중복으로 막힌 요청이 받은 dupToken(공고·번호 묶음, 30분)을 가진
 * 경우에만 열린다 — 이력서 업로드 없이 "이 번호가 지원했나"를 묻는 조회 경로가 생기지 않게.
 * 번호당 공고별 신고는 1회: 신고된 행이나 신고로 생긴 행이 있으면 더 이상 신고할 수 없다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { candidates, jobPostings, organizations, screeningJobs } from "./schema";
import { refundFeature } from "./tokens";
import { isOtpAlimtalkEnabled, normalizeMobile } from "./alimtalk";
import {
  sendMail,
  wrapEmailCard,
  escapeHtml,
  getOrgEmailBranding,
  brandingAttachments,
  type OrgEmailBranding,
} from "./mailer";
import { log } from "./logger";

export const DUPLICATE_MESSAGE_OTP =
  "이미 이 공고에 접수된 지원서가 있습니다. 본인이 지원한 적이 없다면 휴대폰 인증 후 새로 제출할 수 있습니다.";
export const DUPLICATE_MESSAGE_PLAIN =
  "이미 이 공고에 접수된 지원서가 있습니다. 지원서는 한 번만 제출할 수 있습니다. 문의는 채용 담당자에게 연락해 주세요.";

const DUP_TOKEN_TTL_SEC = 30 * 60;
const REPORT_STOP_ERROR = "명의도용 신고로 평가를 중단했습니다.";

/** 저장된 phone 의 구분자(-, 공백, 괄호, 점)를 지운 값 = 입력 숫자. 기존 중복 판정과 같은 규칙. */
export function phoneDigitsEquals(normPhone: string) {
  return sql`replace(replace(replace(replace(replace(${candidates.phone}, '-', ''), ' ', ''), '(', ''), ')', ''), '.', '') = ${normPhone}`;
}

export type PhoneMatch = {
  id: number;
  name: string;
  email: string | null;
  identityReportedAt: string | null;
  identityReportOf: number | null;
};

export async function findPhoneMatches(jobId: number, normPhone: string): Promise<PhoneMatch[]> {
  if (!normPhone) return [];
  return db
    .select({
      id: candidates.id,
      name: candidates.name,
      email: candidates.email,
      identityReportedAt: candidates.identityReportedAt,
      identityReportOf: candidates.identityReportOf,
    })
    .from(candidates)
    .where(and(eq(candidates.jobId, jobId), phoneDigitsEquals(normPhone)))
    .orderBy(candidates.id);
}

/** "동일인 의심" 판정 — 공백 무시 이름 일치. 이름을 못 뽑은 행("(이름 미상)")은 비교하지 않는다. */
export function isSameApplicantName(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "");
  const x = norm(a);
  if (!x || x === "(이름미상)") return false;
  return x === norm(b);
}

/** 신고 가능 =이 번호로 접수된 지원서가 있고, 이 번호로 신고한 적이 없음(신고된 행·신고로 생긴 행 모두 없음). */
export function reportEligible(matches: PhoneMatch[]): boolean {
  return matches.length > 0 && matches.every((m) => !m.identityReportedAt && m.identityReportOf == null);
}

/** 운영에선 알림톡 OTP 템플릿이 설정돼야 사용 가능. 로컬은 콘솔 출력으로 대체되므로 항상 가능. */
export function identityOtpAvailable(rawPhone: string): boolean {
  if (!normalizeMobile(rawPhone)) return false;
  return process.env.NODE_ENV !== "production" || isOtpAlimtalkEnabled();
}

function key(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex) throw new Error("MASTER_ENCRYPTION_KEY 미설정");
  return Buffer.from(hex, "hex");
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(`apply-dup:${payload}`).digest("base64url");
}

export function issueDupToken(jobId: number, normPhone: string): string {
  const exp = Math.floor(Date.now() / 1000) + DUP_TOKEN_TTL_SEC;
  const payload = `${jobId}.${normPhone}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyDupToken(token: unknown, jobId: number, normPhone: string): boolean {
  if (typeof token !== "string" || !normPhone) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [j, ph, expStr, sig] = parts;
  if (j !== String(jobId) || ph !== normPhone) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(`${j}.${ph}.${expStr}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Math.floor(Date.now() / 1000) <= Number(expStr);
}

/**
 * 신고 선점 — 아직 신고되지 않은 행만 원자적으로 표시. 동시에 두 신고가 와도 한쪽만 행을 얻는다.
 * 반환된 id 가 없으면 이미 다른 요청이 신고한 것.
 */
export async function claimIdentityReport(ids: number[]): Promise<{ ids: number[]; at: string }> {
  const at = new Date().toISOString();
  if (ids.length === 0) return { ids: [], at };
  const rows = await db
    .update(candidates)
    .set({ identityReportedAt: at })
    .where(and(inArray(candidates.id, ids), isNull(candidates.identityReportedAt)))
    .returning({ id: candidates.id });
  return { ids: rows.map((r) => r.id), at };
}

/** 새 지원서 저장이 실패했을 때 선점 되돌리기 (이 요청이 찍은 시각인 행만). */
export async function releaseIdentityReport(ids: number[], at: string): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(candidates)
    .set({ identityReportedAt: null })
    .where(
      and(
        inArray(candidates.id, ids),
        eq(candidates.identityReportedAt, at),
        isNull(candidates.identityReportNewCandidateId)
      )
    );
}

/**
 * 신고 마무리 — 새 지원서 연결 + 진행 중 평가 중단 + 서류평가 차감 환불(멱등).
 * 처리 중(processing)이던 평가는 lib/screening.ts 가 신고 표시를 보고 과금하지 않는다.
 */
export async function finalizeIdentityReport(opts: {
  orgId: number | null;
  reportedIds: number[];
  newCandidateId: number;
}): Promise<{ refunded: number }> {
  const { reportedIds } = opts;
  if (reportedIds.length === 0) return { refunded: 0 };
  await db
    .update(candidates)
    .set({ identityReportNewCandidateId: opts.newCandidateId })
    .where(inArray(candidates.id, reportedIds));

  await db
    .update(screeningJobs)
    .set({ status: "failed", lastError: REPORT_STOP_ERROR, lockedAt: null, lockedBy: null })
    .where(
      and(
        inArray(screeningJobs.candidateId, reportedIds),
        inArray(screeningJobs.status, ["queued", "paused"])
      )
    );

  const refunded = await refundReportedScreening(opts.orgId, reportedIds);
  return { refunded };
}

/** 신고된 지원서의 서류평가 차감 전부 환불. refundFeature 가 차감 없음·이미 환불을 걸러 멱등. */
export async function refundReportedScreening(
  orgId: number | null,
  candidateIds: number[]
): Promise<number> {
  if (!orgId || candidateIds.length === 0) return 0;
  const jobs = await db
    .select({ id: screeningJobs.id })
    .from(screeningJobs)
    .where(inArray(screeningJobs.candidateId, candidateIds));
  let total = 0;
  for (const j of jobs) {
    const r = await refundFeature({
      orgId,
      feature: "resume_upload",
      refType: "screening_job",
      refId: j.id,
      memo: "명의도용 신고 — 서류평가 환불",
    });
    total += r.refunded;
  }
  return total;
}

export function buildIdentityReportNoticeEmail(opts: {
  candidateName: string;
  jobTitle: string;
  orgName?: string | null;
  contactEmail?: string | null;
  branding?: OrgEmailBranding | null;
}): { subject: string; html: string; text: string } {
  const brand = opts.orgName?.trim() || "Intervia";
  const subject = `[${brand}] 지원서 관련 안내 — ${opts.jobTitle}`;
  const contactLine = opts.contactEmail
    ? `문의: ${opts.contactEmail}`
    : "문의는 채용 공고의 담당자 연락처로 해 주세요.";
  const text = `안녕하세요 ${opts.candidateName}님,

${opts.jobTitle} 공고에 이 메일 주소로 접수된 지원서에 대해, 지원서에 적힌 휴대폰 번호의 소유자가 휴대폰 인증을 거쳐 "본인이 제출하지 않았다"고 알려 왔습니다.
이에 따라 이 지원서는 자동 진행이 멈춘 상태로 채용 담당자가 확인하게 됩니다.

직접 지원하신 것이 맞다면 채용 담당자에게 연락해 주세요. 지원하신 적이 없다면 이 메일은 무시하셔도 됩니다.

${contactLine}`;
  const html = wrapEmailCard({
    branding: opts.branding,
    contactEmail: opts.contactEmail ?? null,
    contactLabel: "직접 지원하신 것이 맞다면 채용 담당자에게 연락해 주세요.",
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">${escapeHtml(opts.candidateName)}님, 안녕하세요.</h1>
      <p style="color:#475569;line-height:1.6;margin:0 0 12px;">
        <strong style="color:#0f172a;">${escapeHtml(opts.jobTitle)}</strong> 공고에 이 메일 주소로 접수된 지원서에 대해,
        지원서에 적힌 휴대폰 번호의 소유자가 휴대폰 인증을 거쳐 "본인이 제출하지 않았다"고 알려 왔습니다.
      </p>
      <p style="color:#475569;line-height:1.6;margin:0 0 12px;">
        이에 따라 이 지원서는 자동 진행이 멈춘 상태로 채용 담당자가 확인하게 됩니다.
      </p>
      <p style="color:#475569;line-height:1.6;margin:0;">
        지원하신 적이 없다면 이 메일은 무시하셔도 됩니다.
      </p>
    `,
  });
  return { subject, html, text };
}

/** 신고된 지원서의 이메일로 안내 (best-effort, 주소 중복 제거). 실패해도 신고는 유지. */
export async function sendIdentityReportNotices(opts: {
  jobId: number;
  orgId: number | null;
  reported: Array<{ name: string; email: string | null }>;
}): Promise<number> {
  const [job] = await db
    .select({
      title: jobPostings.title,
      contactEmail: jobPostings.recruitingContactEmail,
      orgName: organizations.name,
    })
    .from(jobPostings)
    .leftJoin(organizations, eq(organizations.id, jobPostings.orgId))
    .where(eq(jobPostings.id, opts.jobId));
  if (!job) return 0;
  const branding = await getOrgEmailBranding(opts.orgId);
  const seen = new Set<string>();
  let sent = 0;
  for (const r of opts.reported) {
    const to = r.email?.trim().toLowerCase();
    if (!to || seen.has(to)) continue;
    seen.add(to);
    const mail = buildIdentityReportNoticeEmail({
      candidateName: r.name || "지원자",
      jobTitle: job.title,
      orgName: job.orgName,
      contactEmail: job.contactEmail,
      branding,
    });
    try {
      await sendMail({
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        orgId: opts.orgId,
        audience: "candidate",
        kind: "identity_report_notice",
        attachments: brandingAttachments(branding),
      });
      sent++;
    } catch (e) {
      log.warn("identity_report_notice_failed", {
        jobId: opts.jobId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return sent;
}

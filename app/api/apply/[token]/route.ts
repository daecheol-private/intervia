import { db } from "@/lib/db";
import { jobPostings, candidates, candidateAttachments } from "@/lib/schema";
import { eq, and, lt, isNull, notInArray } from "drizzle-orm";
import { after } from "next/server";
import { createHash } from "node:crypto";
import { saveFile, fetchBlobFile } from "@/lib/storage";
import {
  ext,
  verifyMagic,
  RESUME_EXTS,
  ATTACHMENT_EXTS,
  MAX_ATTACHMENT_SIZE,
} from "@/lib/upload-validation";
import { classifyKind } from "@/lib/file-classify";
import { rateLimit } from "@/lib/rate-limit";
import { enqueueScreening } from "@/lib/screening-queue";
import { triggerWorker } from "@/lib/worker-trigger";
import { logAudit } from "@/lib/audit";
import { isJobExpired } from "@/lib/job-lifecycle";
import { CONSENT_VERSION } from "@/lib/consent";
import { normalizeReferrerHost } from "@/lib/apply-source";
import { extractKoreanNameFromFilename } from "@/lib/file-classify";
import { normalizePhone } from "@/lib/phone";
import { log } from "@/lib/logger";
import { blobScopePrefix, isScopedBlobUrl } from "@/lib/blob-scope";
import { verifyPhoneTicket } from "@/lib/phone-otp";
import {
  DUPLICATE_MESSAGE_OTP,
  DUPLICATE_MESSAGE_PLAIN,
  findPhoneMatches,
  reportEligible,
  identityOtpAvailable,
  issueDupToken,
  claimIdentityReport,
  releaseIdentityReport,
  finalizeIdentityReport,
  sendIdentityReportNotices,
} from "@/lib/apply-identity";

export const runtime = "nodejs";

function bad(
  message: string,
  status = 400,
  code?: string,
  extra?: Record<string, unknown>
) {
  return Response.json({ message, code, ...extra }, { status });
}

// 중복 안내 — 어느 항목(파일·번호·이메일)이 겹쳤는지 밝히지 않는다. 번호가 겹쳤고 인증이 가능하면
// 휴대폰 인증용 dupToken 을 함께 준다(이 응답을 받은 요청만 인증번호를 요청할 수 있음).
function duplicateResponse(dupToken: string | null) {
  return dupToken
    ? bad(DUPLICATE_MESSAGE_OTP, 409, "already_applied", { otp: { dupToken } })
    : bad(DUPLICATE_MESSAGE_PLAIN, 409, "already_applied");
}

// 지원 1건 전체 업로드 상한 — 개별 파일 10MB(MAX_ATTACHMENT_SIZE)에 더해, 이력서+첨부
// 합산도 10MB. 공개(비로그인) 엔드포인트라 Blob 저장 남용·함수 자원 고갈을 총량으로 캡.
const MAX_TOTAL_UPLOAD = 10 * 1024 * 1024;
// 첨부 개수 하드캡 — manifest 의 size 값을 위조해 총량 검증을 우회하고 fetchBlobFile 를
// 폭주시키는 것을 차단(size 위조와 무관하게 fetch 횟수 자체를 제한).
const MAX_APPLY_ATTACHMENTS = 10;

// 두 입력 경로(formData 직접 전송 / Blob manifest)를 하나로 합친 정규화 파일.
type IncomingFile = {
  buf: Buffer; // magic byte·해시·크기 검증용 (양쪽 경로 모두 바이트 확보)
  name: string;
  storedKey: string | null; // Blob 직접 업로드면 이미 저장된 URL, 서버 경유면 null(뒤에서 saveFile)
};

/**
 * 공개(비로그인) 지원 수신 — /apply/[token] 폼이 POST 한다.
 * 후보자가 직접 이력서를 올리고 동의하면, HR 의 수기 업로드와 동일하게
 * 후보자 "껍데기" 생성 → screening 큐 등록 → 워커가 파싱·마스킹·평가.
 *
 * 두 입력 경로 (Vercel 서버리스 함수 본문 4.5MB 한도 때문):
 *   (a) multipart/form-data     — 파일을 서버로 직접 전송 (dev·소형, NEXT_PUBLIC_BLOB_CLIENT_UPLOAD!=1).
 *   (b) application/json manifest — 브라우저가 Blob 에 직접 올린 뒤 URL 만 전달 (운영·최대 10MB).
 *
 * 보안: proxy.ts matcher 가 /api/apply/* 를 제외 → CSRF·인증 면제(토큰=인증). 공개이므로
 *   - IP rate limit 으로 봇·플러드 차단(식별 아님)
 *   - 동일인 중복은 파일 해시 + 휴대폰 번호(주 키) + 이메일로 차단. 번호 주인은 휴대폰 인증 후
 *     명의도용 신고와 함께 새로 제출할 수 있다 (lib/apply-identity.ts)
 *   - 잔액 0 이어도 업로드는 받는다(지원자 유실 방지) — 평가는 큐가 충전 후 재개.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // 봇·대량 업로드 차단 — IP 당 10분 8회. (동일인 식별이 아니라 어뷰즈 상한)
  const limited = await rateLimit(req, "apply", { limit: 8, windowSec: 600 });
  if (limited) return limited;

  const { token } = await params;
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.applyToken, token));
  if (!job) return bad("유효하지 않은 지원 링크입니다.", 404, "invalid_link");
  if (job.status === "closed" || isJobExpired(job))
    return bad("지원이 마감되었습니다.", 410, "job_closed");

  const isJsonManifest = (req.headers.get("content-type") || "").includes(
    "application/json"
  );

  let name = "";
  let email = "";
  let phone = "";
  let consentCollection = false;
  let consentAi = false;
  let referrerHost: string | null = null;
  // 명의도용 신고 증표 (휴대폰 인증 통과 후 재제출 시) — lib/phone-otp.ts verifyPhoneTicket.
  let identityTicket: string | null = null;
  let resume: IncomingFile;
  const attachments: IncomingFile[] = [];

  if (isJsonManifest) {
    // (b) 브라우저가 Vercel Blob 으로 직접 올린 뒤 URL manifest 만 전달.
    type Manifest = {
      name?: string;
      email?: string;
      phone?: string;
      consent_collection_use?: boolean;
      consent_ai_decision?: boolean;
      referrer?: string;
      identity_ticket?: string;
      resume?: { url?: string; name?: string; size?: number };
      attachments?: Array<{ url?: string; name?: string; size?: number }>;
    };
    let m: Manifest;
    try {
      m = (await req.json()) as Manifest;
    } catch {
      return bad("잘못된 요청 본문입니다.");
    }
    name = (m.name || "").trim();
    email = (m.email || "").trim().toLowerCase();
    phone = (m.phone || "").trim();
    consentCollection = m.consent_collection_use === true;
    consentAi = m.consent_ai_decision === true;
    referrerHost = normalizeReferrerHost(m.referrer ?? null);
    identityTicket = typeof m.identity_ticket === "string" ? m.identity_ticket.slice(0, 300) : null;

    if (!m.resume?.url || !m.resume.name)
      return bad("이력서 파일을 첨부해 주세요.");
    if ((m.resume.size ?? 0) > MAX_ATTACHMENT_SIZE)
      return bad(
        `이력서 파일은 최대 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB 까지 업로드할 수 있습니다.`,
        413
      );
    const rawAtts = (m.attachments ?? []).filter(
      (a): a is { url: string; name: string; size?: number } =>
        typeof a?.url === "string" && typeof a?.name === "string"
    );
    if (rawAtts.length > MAX_APPLY_ATTACHMENTS)
      return bad(`첨부 파일은 최대 ${MAX_APPLY_ATTACHMENTS}개까지 첨부할 수 있습니다.`);
    // 이 공고 토큰으로 올린 파일만 — 타 공고·법인 Blob URL 을 넣어 서버 권한으로 읽는 경로 차단.
    const scope = blobScopePrefix("apply", job.id);
    if (
      !isScopedBlobUrl(m.resume.url, scope) ||
      rawAtts.some((a) => !isScopedBlobUrl(a.url, scope))
    ) {
      log.warn("apply_manifest_scope_rejected", { jobId: job.id });
      return bad("업로드 파일 정보가 올바르지 않습니다. 다시 시도해 주세요.");
    }
    // Blob 에서 되읽어 magic byte·해시·텍스트에 사용.
    const fetched = await fetchBlobFile(m.resume.url);
    if (!fetched)
      return bad(
        "업로드한 이력서를 가져올 수 없습니다. 잠시 후 다시 시도해 주세요.",
        502
      );
    resume = { buf: fetched.data, name: m.resume.name, storedKey: m.resume.url };

    // 누적 총량 조기 중단 — 실제 바이트 기준(manifest size 위조 방어). 개수 하드캡이
    // fetch 횟수를, 이 누적 검증이 fetch 총량을 각각 상한한다.
    let totalBytes = resume.buf.length;
    for (const a of rawAtts) {
      if ((a.size ?? 0) > MAX_ATTACHMENT_SIZE) continue;
      const af = await fetchBlobFile(a.url);
      if (!af) continue; // 개별 실패는 건너뜀(지원 자체는 성공)
      if (totalBytes + af.data.length > MAX_TOTAL_UPLOAD)
        return bad(
          `이력서·첨부를 합쳐 최대 ${MAX_TOTAL_UPLOAD / 1024 / 1024}MB 까지 업로드할 수 있습니다.`,
          413
        );
      totalBytes += af.data.length;
      attachments.push({ buf: af.data, name: a.name, storedKey: a.url });
    }
  } else {
    // (a) multipart/form-data — 파일을 서버 함수가 직접 받음 (dev·소형).
    const form = await req.formData();
    name = ((form.get("name") as string) || "").trim();
    email = ((form.get("email") as string) || "").trim().toLowerCase();
    phone = ((form.get("phone") as string) || "").trim();
    consentCollection = form.get("consent_collection_use") === "true";
    consentAi = form.get("consent_ai_decision") === "true";
    // 유입 출처 — 폼이 보낸 document.referrer 에서 호스트만 (자기 도메인·비정상 값은 null).
    referrerHost = normalizeReferrerHost(form.get("referrer"));
    const tk = form.get("identity_ticket");
    identityTicket = typeof tk === "string" && tk ? tk.slice(0, 300) : null;

    const fileEntry = form.get("file");
    if (!(fileEntry instanceof File) || fileEntry.size === 0)
      return bad("이력서 파일을 첨부해 주세요.");
    if (fileEntry.size > MAX_ATTACHMENT_SIZE)
      return bad(
        `이력서 파일은 최대 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB 까지 업로드할 수 있습니다.`,
        413
      );
    resume = {
      buf: Buffer.from(await fileEntry.arrayBuffer()),
      name: fileEntry.name,
      storedKey: null,
    };

    const attEntries = form
      .getAll("attachment")
      .filter((x): x is File => x instanceof File && x.size > 0);
    if (attEntries.length > MAX_APPLY_ATTACHMENTS)
      return bad(`첨부 파일은 최대 ${MAX_APPLY_ATTACHMENTS}개까지 첨부할 수 있습니다.`);
    // 이력서+첨부 합산 총량 캡 — File.size 는 실제값이라 arrayBuffer 전에 누적 검증.
    let totalBytes = resume.buf.length;
    for (const att of attEntries) {
      if (att.size > MAX_ATTACHMENT_SIZE) continue;
      if (totalBytes + att.size > MAX_TOTAL_UPLOAD)
        return bad(
          `이력서·첨부를 합쳐 최대 ${MAX_TOTAL_UPLOAD / 1024 / 1024}MB 까지 업로드할 수 있습니다.`,
          413
        );
      totalBytes += att.size;
      attachments.push({
        buf: Buffer.from(await att.arrayBuffer()),
        name: att.name,
        storedKey: null,
      });
    }
  }

  // ── 공통 검증 (경로 무관) ──────────────────────────────────
  // 입력 길이 상한 — 공개 엔드포인트라 거대 페이로드 + 다운스트림(LLM·UI) 오염 방지.
  // 이름 100 / 이메일 254(RFC 5321) / 전화 40.
  if (name.length > 100 || email.length > 254 || phone.length > 40)
    return bad("이름·이메일·연락처 입력값이 너무 깁니다. 다시 확인해 주세요.");
  if (!email || !/\S+@\S+\.\S+/.test(email))
    return bad("올바른 이메일을 입력해 주세요.");
  // 동의 — 수집·이용은 항상 필수. AI 평가 동의는 AI 서류평가가 켜진 공고만 필수.
  if (!consentCollection)
    return bad("개인정보 수집·이용 동의가 필요합니다.", 400, "consent_required");
  if (!consentAi && !job.aiScreeningDisabled)
    return bad("AI 자동 평가 적용 동의가 필요합니다.", 400, "consent_required");
  // 이력서 확장자·매직바이트 — manifest 경로도 토큰 발급 때 확장자를 봤으나 URL 은
  // 클라이언트 제어값이라, 실제 바이트로 재검증(위조 방지).
  if (!RESUME_EXTS.has(ext(resume.name)))
    return bad("이력서는 PDF · DOCX · HWPX 파일만 업로드할 수 있습니다.");
  const magicErr = verifyMagic(resume.name, resume.buf);
  if (magicErr) return bad(magicErr);

  // 중복 판정 — 같은 파일(바이트 해시) / 휴대폰 번호(정규화, 주 키) / 이메일. 안내 문구는 어느 항목이
  // 겹쳤는지 밝히지 않는다. 번호가 겹치면 그 번호로 휴대폰 인증 후 명의도용 신고 + 새 지원이 가능하다.
  const resumeHash = createHash("sha256").update(resume.buf).digest("hex");
  const [dupFile] = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(
      and(eq(candidates.jobId, job.id), eq(candidates.resumeHash, resumeHash))
    );
  if (dupFile) return duplicateResponse(null);

  const normPhone = normalizePhone(phone);
  const phoneMatches = await findPhoneMatches(job.id, normPhone);
  const canReport = reportEligible(phoneMatches);
  // 명의도용 신고 모드 — 이 번호로 받은 인증 증표가 있고, 이 번호로 아직 신고한 적이 없을 때만.
  const reporting =
    !!identityTicket &&
    canReport &&
    verifyPhoneTicket(identityTicket, "apply_duplicate", phone);
  const reportTargets = reporting ? phoneMatches.map((m) => m.id) : [];
  const otpToken =
    canReport && identityOtpAvailable(phone) ? issueDupToken(job.id, normPhone) : null;

  if (phoneMatches.length > 0 && !reporting) {
    if (identityTicket && otpToken)
      return bad(
        "휴대폰 인증이 만료되었거나 올바르지 않습니다. 다시 인증해 주세요.",
        409,
        "already_applied",
        { otp: { dupToken: otpToken } }
      );
    return duplicateResponse(otpToken);
  }
  // 이메일 — 신고 대상 행(번호 주인이 아니라고 확인한 지원서)과의 일치는 중복으로 보지 않는다.
  const [dupEmail] = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(
      and(
        eq(candidates.jobId, job.id),
        eq(candidates.email, email),
        reportTargets.length ? notInArray(candidates.id, reportTargets) : undefined
      )
    );
  if (dupEmail) return duplicateResponse(null);

  const candidateName =
    name || extractKoreanNameFromFilename(resume.name) || "(이름 미상)";

  // 신고 선점 — 동시에 같은 번호로 두 번 신고해도 한 요청만 통과(번호당 공고별 1회).
  let claim: { ids: number[]; at: string } = { ids: [], at: "" };
  if (reporting) {
    claim = await claimIdentityReport(reportTargets);
    if (claim.ids.length === 0) return duplicateResponse(null);
  }

  let candidateId: number;
  let insertedId: number | null = null;
  try {
    // storedKey 있음(Blob 직접 업로드) → 재저장 안 함. 없음(서버 경유) → 지금 저장.
    const storedKey =
      resume.storedKey ?? (await saveFile(resume.name, resume.buf, undefined));
    const now = new Date().toISOString();
    const [inserted] = await db
      .insert(candidates)
      .values({
        orgId: job.orgId,
        jobId: job.id,
        uploadedByUserId: null,
        source: "apply_link",
        applyReferrerHost: referrerHost,
        resumeHash,
        name: candidateName,
        email,
        phone: phone || null,
        resumeFilePath: storedKey,
        resumeText: "",
        resumeMaskedText: null,
        // 후보자 본인 동의를 출처에서 직접 받음 → 평가 게이트 충족 (HR attest 불요).
        applicantConsentConfirmedAt: job.aiScreeningDisabled ? null : now,
        applicantConsentConfirmedByUserId: null,
        identityReportOf: claim.ids.length ? Math.min(...claim.ids) : null,
      })
      .returning();
    candidateId = inserted.id;
    insertedId = inserted.id;

    // 동시 제출 레이스 방어 — 위 이메일 dup 체크와 이 INSERT 사이에 같은 이메일의
    // 다른 동시 지원이 끼어들면(파일 바이트가 달라 resume_hash 유니크도 못 막음) 후보자
    // 2행 + 평가 2회 = 과금 2회가 된다. 삽입 후 같은 (jobId,email)의 더 작은 id 가 있으면
    // 이 행이 레이스 패자이므로 자기 행을 지우고 already_applied 응답(승자=최소 id 1명만 유지).
    if (email) {
      const [earlier] = await db
        .select({ id: candidates.id })
        .from(candidates)
        .where(
          and(
            eq(candidates.jobId, job.id),
            eq(candidates.email, email),
            lt(candidates.id, candidateId),
            isNull(candidates.identityReportedAt)
          )
        )
        .limit(1);
      if (earlier) {
        await db.delete(candidates).where(eq(candidates.id, candidateId));
        await releaseIdentityReport(claim.ids, claim.at);
        return duplicateResponse(null);
      }
    }

    await db.insert(candidateAttachments).values({
      candidateId,
      kind: "resume",
      filePath: storedKey,
      originalName: resume.name,
      mime: null,
      sizeBytes: resume.buf.length,
    });
  } catch (err) {
    log.error("apply_upload_failed", err, { jobId: job.id });
    if (insertedId == null) await releaseIdentityReport(claim.ids, claim.at).catch(() => {});
    else if (claim.ids.length)
      await finalizeIdentityReport({ orgId: job.orgId, reportedIds: claim.ids, newCandidateId: insertedId }).catch(() => {});
    return bad(
      "지원서 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      500
    );
  }

  // 첨부파일 (선택, 다수) — 한 지원자의 이력서 외 경력기술서·포트폴리오·자소서 등.
  // 개별 실패는 건너뜀(지원 자체는 이미 성공). 워커가 마스킹 후 평가에 함께 반영.
  for (const att of attachments) {
    try {
      if (!ATTACHMENT_EXTS.has(ext(att.name))) continue;
      if (verifyMagic(att.name, att.buf)) continue;
      // storedKey 있음(Blob 직접 업로드) → 재저장 안 함. 없음(서버 경유) → 지금 저장.
      const akey =
        att.storedKey ?? (await saveFile(att.name, att.buf, undefined));
      const kind = classifyKind(att.name);
      await db.insert(candidateAttachments).values({
        candidateId,
        kind: kind === "resume" ? "other" : kind,
        filePath: akey,
        originalName: att.name,
        mime: null,
        sizeBytes: att.buf.length,
        maskedText: null,
      });
    } catch (e) {
      log.warn("apply_attachment_failed", {
        candidateId,
        name: att.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 동의 기록 — 비로그인 후보자. 분쟁 시 입증용(버전·항목·IP·UA). PII(email)는 폐기 시 redact 대상.
  logAudit(req, {
    actorRole: "candidate",
    action: "consent.submit",
    resourceType: "candidate",
    resourceId: candidateId,
    orgId: job.orgId,
    jobId: job.id,
    metadata: {
      version: CONSENT_VERSION,
      source: "apply_link",
      email,
      consents: { collection_use: consentCollection, ai_decision: consentAi },
    },
  });

  if (claim.ids.length) {
    const reported = phoneMatches.filter((m) => claim.ids.includes(m.id));
    let refunded = 0;
    try {
      ({ refunded } = await finalizeIdentityReport({
        orgId: job.orgId,
        reportedIds: claim.ids,
        newCandidateId: candidateId,
      }));
    } catch (e) {
      log.error("identity_report_finalize_failed", e, { jobId: job.id, candidateId });
    }
    logAudit(req, {
      actorRole: "candidate",
      action: "candidate.identity_report",
      resourceType: "candidate",
      resourceId: candidateId,
      orgId: job.orgId,
      jobId: job.id,
      metadata: { reportedCandidateIds: claim.ids, refunded },
    });
    after(() =>
      sendIdentityReportNotices({ jobId: job.id, orgId: job.orgId, reported }).catch((e) =>
        log.warn("identity_report_notice_failed", {
          jobId: job.id,
          error: e instanceof Error ? e.message : String(e),
        })
      )
    );
  }

  // 서류평가 큐 등록 — 워커가 파싱·마스킹·LLM 평가 수행(aiScreeningDisabled 면 평가는 건너뜀).
  // 잔액 0 이면 큐가 paused 로 보류했다가 충전 후 자동 재개(reconcileBalanceHolds).
  try {
    await enqueueScreening(candidateId, null);
    triggerWorker(req);
  } catch (err) {
    log.warn("apply_enqueue_failed", {
      candidateId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return Response.json({ ok: true });
}

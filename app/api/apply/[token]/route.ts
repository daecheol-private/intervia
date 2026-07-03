import { db } from "@/lib/db";
import { jobPostings, candidates, candidateAttachments } from "@/lib/schema";
import { eq, and, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { saveFile } from "@/lib/storage";
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
import { extractKoreanNameFromFilename } from "@/lib/file-classify";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

function bad(message: string, status = 400, code?: string) {
  return Response.json({ message, code }, { status });
}

/**
 * 공개(비로그인) 지원 수신 — /apply/[token] 폼이 POST 한다.
 * 후보자가 직접 이력서를 올리고 동의하면, HR 의 수기 업로드와 동일하게
 * 후보자 "껍데기" 생성 → screening 큐 등록 → 워커가 파싱·마스킹·평가.
 *
 * 보안: proxy.ts 에서 /api/apply/* 는 인증·CSRF 면제(토큰=인증). 공개이므로
 *   - IP rate limit 으로 봇·플러드 차단(식별 아님)
 *   - 동일인 중복은 이메일 + 파일 해시로 차단
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

  const form = await req.formData();
  const name = ((form.get("name") as string) || "").trim();
  const email = ((form.get("email") as string) || "").trim().toLowerCase();
  const phone = ((form.get("phone") as string) || "").trim();
  const consentCollection = form.get("consent_collection_use") === "true";
  const consentAi = form.get("consent_ai_decision") === "true";

  if (!email || !/\S+@\S+\.\S+/.test(email))
    return bad("올바른 이메일을 입력해 주세요.");

  // 동의 — 수집·이용은 항상 필수. AI 평가 동의는 AI 서류평가가 켜진 공고만 필수.
  if (!consentCollection) return bad("개인정보 수집·이용 동의가 필요합니다.", 400, "consent_required");
  if (!consentAi && !job.aiScreeningDisabled)
    return bad("AI 자동 평가 적용 동의가 필요합니다.", 400, "consent_required");

  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File) || fileEntry.size === 0)
    return bad("이력서 파일을 첨부해 주세요.");
  const fileName = fileEntry.name;
  const e = ext(fileName);
  if (!RESUME_EXTS.has(e))
    return bad("이력서는 PDF · DOCX · HWPX 파일만 업로드할 수 있습니다.");
  if (fileEntry.size > MAX_ATTACHMENT_SIZE)
    return bad(`이력서 파일은 최대 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB 까지 업로드할 수 있습니다.`, 413);

  const buf = Buffer.from(await fileEntry.arrayBuffer());
  const magicErr = verifyMagic(fileName, buf);
  if (magicErr) return bad(magicErr);

  // 동일인 중복 — 이메일(공고당 1회) + 파일 해시(같은 파일 재업로드).
  const resumeHash = createHash("sha256").update(buf).digest("hex");
  const [dupEmail] = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(eq(candidates.jobId, job.id), eq(candidates.email, email)));
  if (dupEmail)
    return bad("이미 이 공고에 지원하셨습니다. 지원서는 한 번만 제출할 수 있습니다.", 409, "already_applied");
  const [dupFile] = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(eq(candidates.jobId, job.id), eq(candidates.resumeHash, resumeHash)));
  if (dupFile)
    return bad("이미 동일한 이력서가 제출되어 있습니다.", 409, "duplicate_resume");

  const candidateName =
    name || extractKoreanNameFromFilename(fileName) || "(이름 미상)";

  let candidateId: number;
  try {
    const storedKey = await saveFile(fileName, buf, undefined);
    const now = new Date().toISOString();
    const [inserted] = await db
      .insert(candidates)
      .values({
        orgId: job.orgId,
        jobId: job.id,
        uploadedByUserId: null,
        source: "apply_link",
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
      })
      .returning();
    candidateId = inserted.id;

    // 동시 제출 레이스 방어 — 위 이메일 dup 체크(:87)와 이 INSERT 사이에 같은 이메일의
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
            lt(candidates.id, candidateId)
          )
        )
        .limit(1);
      if (earlier) {
        await db.delete(candidates).where(eq(candidates.id, candidateId));
        return bad(
          "이미 이 공고에 지원하셨습니다. 지원서는 한 번만 제출할 수 있습니다.",
          409,
          "already_applied"
        );
      }
    }

    await db.insert(candidateAttachments).values({
      candidateId,
      kind: "resume",
      filePath: storedKey,
      originalName: fileName,
      mime: null,
      sizeBytes: buf.length,
    });
  } catch (err) {
    log.error("apply_upload_failed", err, { jobId: job.id });
    return bad("지원서 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }

  // 첨부파일 (선택, 다수) — 한 지원자의 이력서 외 경력기술서·포트폴리오·자소서 등.
  // 개별 실패는 건너뜀(지원 자체는 이미 성공). 워커가 마스킹 후 평가에 함께 반영.
  const attachmentEntries = form
    .getAll("attachment")
    .filter((x): x is File => x instanceof File && x.size > 0);
  for (const att of attachmentEntries) {
    try {
      if (!ATTACHMENT_EXTS.has(ext(att.name))) continue;
      if (att.size > MAX_ATTACHMENT_SIZE) continue;
      const abuf = Buffer.from(await att.arrayBuffer());
      if (verifyMagic(att.name, abuf)) continue;
      const akey = await saveFile(att.name, abuf, undefined);
      const kind = classifyKind(att.name);
      await db.insert(candidateAttachments).values({
        candidateId,
        kind: kind === "resume" ? "other" : kind,
        filePath: akey,
        originalName: att.name,
        mime: null,
        sizeBytes: abuf.length,
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

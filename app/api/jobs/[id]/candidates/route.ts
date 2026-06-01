import { db } from "@/lib/db";
import {
  jobPostings,
  candidates,
  interviewSessions,
  screeningJobs,
  candidateAttachments,
  userCandidateFavorites,
} from "@/lib/schema";
import { eq, desc, inArray, and, sql } from "drizzle-orm";
import { isJobUnlocked } from "@/lib/job-lock";
import { isJobExpired } from "@/lib/job-lifecycle";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { saveFile } from "@/lib/storage";
import { log } from "@/lib/logger";
import { createHash } from "node:crypto";
import type { CurrentUser } from "@/lib/auth";
import {
  groupFiles,
  mergeGroupsByName,
  extractKoreanNameFromFilename,
  type AcceptedFile,
  type FileGroup,
} from "@/lib/file-classify";
import { extractZip, ZipExtractError } from "@/lib/zip-extract";
import {
  requirePositiveBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";
import { logAudit } from "@/lib/audit";
import { chargeFeature } from "@/lib/tokens";
import { enqueueScreening } from "@/lib/screening-queue";
import { triggerWorker } from "@/lib/worker-trigger";

export const runtime = "nodejs";

async function loadJob(jobId: number) {
  const [row] = await db.select().from(jobPostings).where(eq(jobPostings.id, jobId));
  return row;
}

async function guardJob(me: CurrentUser, jobId: number) {
  const job = await loadJob(jobId);
  if (!job) return { error: new Response("Not found", { status: 404 }), job: null };
  if (!ownsOrg(me, job.orgId))
    return { error: new Response("Not found", { status: 404 }), job: null };
  if (me.role !== "system_admin" && job.passwordHash && !(await isJobUnlocked(jobId))) {
    return { error: new Response("잠긴 공고입니다.", { status: 403 }), job: null };
  }
  return { error: null, job };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const guard = await guardJob(me!, Number(id));
  if (guard.error) return guard.error;

  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      email: candidates.email,
      phone: candidates.phone,
      age: candidates.age,
      careerYears: candidates.careerYears,
      careerSummary: candidates.careerSummary,
      educationLevel: candidates.educationLevel,
      educationSchool: candidates.educationSchool,
      educationMajor: candidates.educationMajor,
      resumeFilePath: candidates.resumeFilePath,
      // 파싱 완료 여부 판별용 — 마스킹 텍스트 길이 (본문은 전송 안 함).
      maskedLen: sql<number>`COALESCE(LENGTH(${candidates.resumeMaskedText}), 0)`,
      screeningScore: candidates.screeningScore,
      screeningReport: candidates.screeningReport,
      stage: candidates.stage,
      outcome: candidates.outcome,
      outcomeReason: candidates.outcomeReason,
      createdAt: candidates.createdAt,
      interviewEmailCount: candidates.interviewEmailCount,
      lastInterviewEmailSentAt: candidates.lastInterviewEmailSentAt,
      decisionEmailCount: candidates.decisionEmailCount,
    })
    .from(candidates)
    .where(eq(candidates.jobId, Number(id)))
    .orderBy(desc(candidates.createdAt));

  const ids = rows.map((r) => r.id);
  const sessions = ids.length
    ? await db
        .select()
        .from(interviewSessions)
        .where(inArray(interviewSessions.candidateId, ids))
        .orderBy(desc(interviewSessions.createdAt))
    : [];

  const latestByCandidate = new Map<number, typeof sessions[number]>();
  for (const s of sessions) {
    if (!latestByCandidate.has(s.candidateId)) {
      latestByCandidate.set(s.candidateId, s);
    }
  }

  // 큐 정보 — UI 진행상황 + 실패 사유 표시용. 후보자별 최신 job 1건씩.
  const allJobs = ids.length
    ? await db
        .select({
          candidateId: screeningJobs.candidateId,
          jobId: screeningJobs.id,
          status: screeningJobs.status,
          attempts: screeningJobs.attempts,
          notBefore: screeningJobs.notBefore,
          lastError: screeningJobs.lastError,
        })
        .from(screeningJobs)
        .where(inArray(screeningJobs.candidateId, ids))
        .orderBy(desc(screeningJobs.id))
    : [];
  const jobByCandidate = new Map<number, typeof allJobs[number]>();
  for (const j of allJobs) {
    // desc 정렬이므로 가장 최신 한 건만 보존
    if (!jobByCandidate.has(j.candidateId)) jobByCandidate.set(j.candidateId, j);
  }
  // 활성(queued/processing) job 만 큐 위치 계산용으로 분리
  const activeJobs = allJobs.filter((j) =>
    j.status === "queued" || j.status === "processing"
  );
  // 큐 위치 — queued 만, 가장 작은 id 부터 1번
  const queuedJobIds = activeJobs
    .filter((j) => j.status === "queued")
    .map((j) => j.jobId)
    .sort((a, b) => a - b);
  // 글로벌 큐에서 본인 앞에 있는 queued 개수
  // 본인 jobId 보다 작은 queued 만 카운트 (다른 법인 포함 — 시스템 부담 고려)
  const positions = new Map<number, number>();
  if (queuedJobIds.length > 0) {
    const minId = Math.min(...queuedJobIds);
    const [r] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(screeningJobs)
      .where(
        and(eq(screeningJobs.status, "queued"), sql`${screeningJobs.id} < ${minId}`)
      );
    const beforeMine = Number(r?.count ?? 0);
    queuedJobIds.forEach((jid, idx) => positions.set(jid, beforeMine + idx + 1));
  }

  // 현재 사용자의 후보자 즐겨찾기 ID 셋
  const favRows = ids.length
    ? await db
        .select({ candidateId: userCandidateFavorites.candidateId })
        .from(userCandidateFavorites)
        .where(
          and(
            eq(userCandidateFavorites.userId, me!.id),
            inArray(userCandidateFavorites.candidateId, ids)
          )
        )
    : [];
  const favoritedSet = new Set(favRows.map((r) => r.candidateId));

  const result = rows.map((r) => {
    const s = latestByCandidate.get(r.id);
    const j = jobByCandidate.get(r.id);
    const isActive = j?.status === "queued" || j?.status === "processing";
    const { maskedLen, ...rest } = r;
    return {
      ...rest,
      // 파싱(텍스트 추출+마스킹) 완료 여부 — UI 가 '분석 중' vs '평가 중' 구분.
      parsed: (maskedLen ?? 0) >= 30,
      favorited: favoritedSet.has(r.id),
      latestInterviewStatus: s?.status ?? null,
      latestInterviewScore:
        s?.status === "completed" ? (s.evaluation?.overall_score ?? null) : null,
      latestInterviewRecommendation:
        s?.status === "completed" ? (s.evaluation?.recommendation ?? null) : null,
      // 활성 큐 정보 — 진행 중 표시
      queueStatus: isActive ? (j?.status ?? null) : null,
      queuePosition: isActive && j ? positions.get(j.jobId) ?? null : null,
      queueAttempts: j?.attempts ?? 0,
      // 최근 평가 시도의 오류 — failed 또는 backoff 중인 queued 에서 노출
      lastError: j?.lastError ?? null,
      lastJobStatus: j?.status ?? null,
    };
  });

  return Response.json(result);
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file
const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100MB for ZIP
const RESUME_EXTS = new Set(["pdf", "docx"]);
const ATTACHMENT_EXTS = new Set([
  "pdf",
  "docx",
  "doc",
  "hwp",
  "hwpx",
  "png",
  "jpg",
  "jpeg",
  "pptx",
  "xlsx",
  "txt",
  "md",
]);

function ext(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

function verifyMagic(name: string, buf: Buffer): string | null {
  const e = ext(name);
  if (e === "pdf") {
    if (
      buf.length < 5 ||
      buf[0] !== 0x25 ||
      buf[1] !== 0x50 ||
      buf[2] !== 0x44 ||
      buf[3] !== 0x46 ||
      buf[4] !== 0x2d
    )
      return "유효한 PDF 파일이 아닙니다.";
  } else if (e === "docx" || e === "pptx" || e === "xlsx") {
    if (buf.length < 2 || buf[0] !== 0x50 || buf[1] !== 0x4b)
      return `유효한 ${e.toUpperCase()} 파일이 아닙니다.`;
  }
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const jobId = Number(id);
  const guard = await guardJob(me!, jobId);
  if (guard.error) return guard.error;
  const job = guard.job!;

  // 종결 공고는 신규 업로드 차단
  if (job.status === "closed") {
    return Response.json(
      {
        code: "job_closed",
        message:
          "이미 종결된 공고입니다. 추가 이력서를 받으려면 공고를 연장해 주세요.",
      },
      { status: 409 }
    );
  }
  if (isJobExpired(job)) {
    return Response.json(
      {
        code: "job_expired",
        message:
          "공고 종결 예정일이 지났습니다. 공고를 연장하거나 종결한 후 다시 시도해 주세요.",
      },
      { status: 409 }
    );
  }

  // 잔액 가드 — 0 이하면 차단
  const balanceGuard = await requirePositiveBalance(job.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  // 지원자 동의 확인 게이트 — 채용기업이 "지원자가 AI 평가에 동의했음"을 확인해야 업로드 허용.
  // PIPA §15·§26·§28의8·§37의2 책임을 고객사로 전가하는 핵심 메커니즘.
  // (계약상으론 이용약관 §5에서 의무화. 여기는 그 의무 이행을 강제하는 기술적 게이트.)
  // 동의 자체는 채용기업이 사람인/잡코리아 추가 동의 항목 또는 별도 절차로 받아둠.

  // 두 가지 입력 경로:
  //  (a) multipart/form-data — 기존 서버 경유 업로드 (dev, 소형 파일)
  //  (b) application/json — 클라이언트가 Vercel Blob 으로 직접 올린 뒤 manifest 전달 (100MB 까지)
  const contentType = req.headers.get("content-type") || "";
  const isJsonManifest = contentType.includes("application/json");

  type RawItem = {
    name: string; // path 포함 가능 (예: "홍길동/이력서.pdf", "subdir/file.zip")
    buf: Buffer;
    size: number;
    storedKey?: string; // 클라이언트 직접 업로드 경로에서 이미 Blob 에 있는 경우 URL
  };

  let formName = "";
  let formEmail = "";
  // 채용기업이 "지원자가 AI 평가 적용에 동의했음" 을 확인했는지.
  // 미확인 시 업로드 거부 (PIPA §15·§26·§28의8·§37의2 책임 전가 + 분쟁 시 입증).
  let consentConfirmed = false;
  const rawItems: RawItem[] = [];

  // (consentConfirmed 검증은 body 파싱 후 — 양쪽 경로 공통)
  if (isJsonManifest) {
    type Manifest = {
      name?: string;
      email?: string;
      applicantConsentConfirmed?: boolean;
      blobs: Array<{ url: string; pathname: string; size: number }>;
    };
    let manifest: Manifest;
    try {
      manifest = (await req.json()) as Manifest;
    } catch {
      return new Response("잘못된 요청 본문(JSON)", { status: 400 });
    }
    formName = (manifest.name || "").trim();
    formEmail = (manifest.email || "").trim();
    consentConfirmed = manifest.applicantConsentConfirmed === true;
    // 동의 게이트는 blob fetch (외부 URL) 보다 먼저 수행 — SSRF 위험 + UX 지연 방지
    if (!consentConfirmed) {
      return Response.json(
        {
          code: "applicant_consent_required",
          message:
            "이력서 업로드 전 지원자에게 'AI 평가 적용 + 거부 시 일반 절차 가능' 을 안내하셨는지 확인이 필요합니다 (PIPA §37의2 고지 의무). 표준 안내 문구는 /legal/applicant-consent-template 에서 확인하세요.",
        },
        { status: 400 }
      );
    }
    if (!Array.isArray(manifest.blobs) || manifest.blobs.length === 0)
      return new Response("파일 없음", { status: 400 });

    // 각 blob 을 다운로드 — ZIP 처리·magic byte 검증·텍스트 추출 위해 Buffer 필요.
    // 단, 비-ZIP 파일은 storedKey 를 유지하여 서버에서 재업로드하지 않음.
    for (const b of manifest.blobs) {
      if (!b.url || !b.pathname) continue;
      if (b.size > MAX_FILE_SIZE) {
        // pathname 끝 leaf 만 추출해서 메시지에 표시
        const leaf = b.pathname.split(/[/\\]/).pop() ?? b.pathname;
        return new Response(
          `파일이 너무 큽니다: ${leaf} (${(b.size / 1024 / 1024).toFixed(1)}MB, 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
          { status: 413 }
        );
      }
      const res = await fetch(b.url);
      if (!res.ok) {
        log.warn("blob_fetch_failed", { url: b.url, status: res.status });
        return new Response(
          `업로드한 파일을 가져올 수 없습니다 (HTTP ${res.status}).`,
          { status: 502 }
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      rawItems.push({
        name: b.pathname,
        buf,
        size: buf.length,
        storedKey: b.url,
      });
    }
  } else {
    const formData = await req.formData();
    formName = ((formData.get("name") as string) || "").trim();
    formEmail = ((formData.get("email") as string) || "").trim();
    const rawConsent = formData.get("applicantConsentConfirmed");
    consentConfirmed =
      rawConsent === "true" || rawConsent === "1" || rawConsent === "on";
    const rawFiles = formData.getAll("file").filter((f) => f instanceof File) as File[];
    if (rawFiles.length === 0) return new Response("파일 없음", { status: 400 });
    for (const f of rawFiles) {
      if (f.size === 0) continue;
      rawItems.push({
        name: f.name,
        buf: Buffer.from(await f.arrayBuffer()),
        size: f.size,
      });
    }
  }

  // 지원자 동의 확인 미체크 시 거부 — body 파싱 후 공통 게이트
  if (!consentConfirmed) {
    return Response.json(
      {
        code: "applicant_consent_required",
        message:
          "이력서 업로드 전 지원자에게 'AI 평가 적용 + 거부 시 일반 절차 가능' 을 안내하셨는지 확인이 필요합니다 (PIPA §37의2 고지 의무). 표준 안내 문구는 /legal/applicant-consent-template 에서 확인하세요.",
      },
      { status: 400 }
    );
  }

  // 2) ZIP 자동 추출 — 안에 있는 각 파일을 별도 항목으로.
  //    지원 안 되는 파일/너무 큰 파일은 silent skip (응답에 안내)
  const collected: AcceptedFile[] = [];
  const skippedUnsupported: string[] = [];
  const skippedTooLarge: string[] = [];
  // 클라이언트 직접 업로드된 ZIP — 추출 끝나면 삭제
  const zipKeysToCleanup: string[] = [];
  for (const f of rawItems) {
    if (f.size === 0) continue;
    const leafName = f.name.split(/[/\\]/).pop() ?? f.name;
    const e = ext(leafName);
    if (e === "zip") {
      if (f.size > MAX_ZIP_SIZE)
        return new Response(`압축 파일이 너무 큽니다. 최대 ${MAX_ZIP_SIZE / 1024 / 1024}MB`, {
          status: 413,
        });
      log.info("zip_upload_start", { jobId, filename: f.name, size: f.size });
      try {
        const entries = extractZip(f.buf);
        log.info("zip_extracted", {
          jobId,
          filename: f.name,
          entryCount: entries.length,
          sample: entries.slice(0, 5).map((x) => x.path),
        });
        for (const en of entries)
          collected.push({ name: en.name, buf: en.buf, path: en.path });
        if (f.storedKey) zipKeysToCleanup.push(f.storedKey);
      } catch (err) {
        if (err instanceof ZipExtractError) {
          log.warn("zip_extract_failed", {
            jobId,
            filename: f.name,
            code: err.code,
            message: err.message,
          });
          return new Response(err.message, { status: 400 });
        }
        throw err;
      }
    } else {
      const rawName = f.name;
      const hasPath = /[/\\]/.test(rawName);
      const parts = rawName.split(/[/\\]/).filter(Boolean);
      const leaf = parts[parts.length - 1] ?? rawName;
      const leafExt = ext(leaf);
      if (!ATTACHMENT_EXTS.has(leafExt)) {
        skippedUnsupported.push(leaf);
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        skippedTooLarge.push(`${leaf} (${(f.size / 1024 / 1024).toFixed(1)} MB)`);
        continue;
      }
      collected.push({
        name: leaf,
        buf: f.buf,
        path: hasPath ? parts.join("/") : undefined,
        storedKey: f.storedKey,
      });
    }
  }

  if (collected.length === 0)
    return new Response("처리 가능한 파일이 없습니다.", { status: 400 });

  // 3) 응시자별 그룹화 (파일명 prefix·키워드 기반) + 같은 이름 그룹 병합.
  //    한 번의 업로드 안에서는 동명이인 없다고 가정 → 이름 같으면 1명으로.
  const groups = mergeGroupsByName(groupFiles(collected));

  // 4) 각 그룹마다 후보자 1명 생성 + 첨부 저장
  type GroupResult =
    | {
        ok: true;
        candidateId: number;
        name: string;
        attachments: number;
        enqueued: boolean;
      }
    | { ok: false; group: string; reason: string }
    | { skipped: true; group: string; reason: string };
  const results: GroupResult[] = [];

  for (const g of groups) {
    // 그룹 안에 PDF/DOCX 가 하나도 없으면 silent skip — 실패가 아니라 "이력서 아닌 자료"
    const hasResumeFile =
      (g.resume && RESUME_EXTS.has(ext(g.resume.name))) ||
      g.attachments.some((a) => RESUME_EXTS.has(ext(a.file.name)));
    if (!hasResumeFile) {
      results.push({
        skipped: true,
        group: g.candidateName,
        reason: "PDF/DOCX 이력서 파일이 없어 건너뜀",
      });
      continue;
    }
    const r = await processGroup({
      group: g,
      jobId,
      job,
      me: me!,
      // ZIP 안에서는 폼 입력값 무시 (다수 응시자). 단건이면 적용.
      providedName: groups.length === 1 ? formName : "",
      providedEmail: groups.length === 1 ? formEmail : "",
    });
    results.push(r);
    if ("ok" in r && r.ok) {
      logAudit(req, {
        actor: me!,
        action: "candidate.upload_with_consent",
        resourceType: "candidate",
        resourceId: r.candidateId,
        orgId: job.orgId,
        metadata: { name: r.name, attachments: r.attachments },
      });
    }
  }

  const ok = results.filter((r) => "ok" in r && r.ok);
  const failed = results.filter((r) => "ok" in r && !r.ok);
  const skipped = results.filter((r) => "skipped" in r);

  // 큐에 enqueue 된 작업이 1개라도 있으면 워커 즉시 깨우기 (fire-and-forget).
  // 워커 60초 안에 처리 못한 잔여 작업은 cron(또는 수동 트리거)이 따라잡음.
  const anyEnqueued = results.some(
    (r) => "ok" in r && r.ok && "enqueued" in r && r.enqueued
  );
  if (anyEnqueued) {
    triggerWorker(req);
  }

  // 클라이언트가 직접 올린 ZIP — 추출 끝나 더 이상 필요 없음. 정리.
  if (zipKeysToCleanup.length > 0) {
    const { del } = await import("@vercel/blob");
    for (const url of zipKeysToCleanup) {
      try {
        await del(url);
      } catch (err) {
        log.warn("zip_blob_cleanup_failed", {
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return Response.json({
    created: ok.length,
    failed: failed.length,
    skipped: skipped.length,
    results,
    // 전체 처리에서 제외된 파일들 — UI 가 안내용으로 사용
    skippedFiles: {
      unsupported: skippedUnsupported,
      tooLarge: skippedTooLarge,
    },
  });
}

async function processGroup(args: {
  group: FileGroup;
  jobId: number;
  job: NonNullable<Awaited<ReturnType<typeof guardJob>>["job"]>;
  me: CurrentUser;
  providedName: string;
  providedEmail: string;
}): Promise<
  | {
      ok: true;
      candidateId: number;
      name: string;
      attachments: number;
      enqueued: boolean;
    }
  | { ok: false; group: string; reason: string }
> {
  const { group, jobId, job, me, providedName, providedEmail } = args;
  if (!group.resume)
    return { ok: false, group: group.candidateName, reason: "메인 이력서 파일이 없습니다." };

  const resumeFile = group.resume;
  const e = ext(resumeFile.name);
  if (!RESUME_EXTS.has(e))
    return {
      ok: false,
      group: group.candidateName,
      reason: `이력서로 사용 가능한 형식이 아닙니다 (${resumeFile.name}). PDF/DOCX 필요.`,
    };

  // magic byte 검증
  const magicErr = verifyMagic(resumeFile.name, resumeFile.buf);
  if (magicErr) return { ok: false, group: group.candidateName, reason: magicErr };

  // SHA-256 중복 체크 — 같은 공고 안에서 동일 파일은 1건만 허용 (업로더 무관).
  // 파싱 전에 버퍼 해시로 즉시 판정 → 중복 업로드는 카드 생성 없이 바로 거부.
  const resumeHash = createHash("sha256").update(resumeFile.buf).digest("hex");
  const [dup] = await db
    .select({ id: candidates.id, name: candidates.name })
    .from(candidates)
    .where(
      and(eq(candidates.jobId, jobId), eq(candidates.resumeHash, resumeHash))
    );
  if (dup)
    return {
      ok: false,
      group: group.candidateName,
      reason: `동일한 이력서 파일이 이미 등록되어 있습니다 (${dup.name}, id=${dup.id}). 다른 파일이면 내용을 수정 후 다시 업로드해 주세요.`,
    };
  // NOTE: 같은 이름이지만 hash 가 다르면 — 동명이인으로 보고 별도 후보자로 생성한다.
  // 한 번의 업로드 안에서는 mergeGroupsByName 으로 이미 합쳐졌고,
  // 이후 추가 업로드에서 같은 이름·다른 파일이 들어오면 새 사람으로 등록되는 게 의도.

  // 이름 — 파싱 없이 수동입력/그룹분석/파일명만으로 결정 (즉시 카드 표시용).
  //   1) 수동 입력 (providedName)
  //   2) 그룹 분석 결과 (group.candidateName) — groupFiles 가 배치 공통 직무 토큰을
  //      걸러 사람 이름을 골라낸 값. 제네릭(resume/이력서 등) 이면 건너뜀.
  //   3) 파일명 한국어 이름 / 파일명 stem
  // LLM/정규식 추출 이름(extractPII)은 워커가 파싱 후, 이름이 "(이름 미상)" 일 때만 승격.
  const filenameStem = resumeFile.name
    .replace(/\.[^/.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .trim();
  const isGeneric = (s: string) =>
    !s ||
    /^(resume|cv|이력서|sample|test|untitled|file|noname|document|doc)\b/i.test(s);
  const groupName = isGeneric(group.candidateName) ? null : group.candidateName;
  const candidateName =
    providedName ||
    groupName ||
    extractKoreanNameFromFilename(resumeFile.name) ||
    (isGeneric(filenameStem) ? "(이름 미상)" : filenameStem);

  // 메인 이력서 파일 저장 — 클라이언트가 이미 Blob 에 올린 경우 그대로 사용
  const storedResumeKey =
    resumeFile.storedKey ?? (await saveFile(resumeFile.name, resumeFile.buf, undefined));

  // 후보자 "껍데기" 생성 — 파싱·PII·학력·마스킹은 워커가 평가 직전에 채운다.
  // resumeMaskedText=null = "아직 파싱 안 됨" 표식 (UI 가 '분석 중' 으로 표시).
  const [inserted] = await db
    .insert(candidates)
    .values({
      orgId: job.orgId,
      jobId,
      uploadedByUserId: me.id,
      resumeHash,
      name: candidateName,
      email: providedEmail || null,
      phone: null,
      age: null,
      educationLevel: null,
      educationSchool: null,
      educationMajor: null,
      resumeFilePath: storedResumeKey,
      resumeText: "",
      resumeMaskedText: null,
      applicantConsentConfirmedAt: new Date().toISOString(),
      applicantConsentConfirmedByUserId: me.id,
    })
    .returning();

  // 메인 이력서 자체도 attachments 에 kind=resume 으로 기록 (다운로드 통일 + 워커 재파싱용)
  await db.insert(candidateAttachments).values({
    candidateId: inserted.id,
    kind: "resume",
    filePath: storedResumeKey,
    originalName: resumeFile.name,
    mime: null,
    sizeBytes: resumeFile.buf.length,
  });

  // 첨부 (포트폴리오/자소서/기타) 저장 — 파싱·마스킹은 워커가 수행 (maskedText=null).
  let attachmentCount = 0;
  for (const att of group.attachments) {
    if (att.file.buf.length === 0) continue;
    const ae = ext(att.file.name);
    if (!ATTACHMENT_EXTS.has(ae)) continue;
    try {
      const key =
        att.file.storedKey ?? (await saveFile(att.file.name, att.file.buf, undefined));
      await db.insert(candidateAttachments).values({
        candidateId: inserted.id,
        kind: att.kind === "resume" ? "other" : att.kind,
        filePath: key,
        originalName: att.file.name,
        mime: null,
        sizeBytes: att.file.buf.length,
        maskedText: null,
      });
      attachmentCount++;
    } catch (err) {
      log.warn("attachment_save_failed", {
        candidateId: inserted.id,
        filename: att.file.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 서류평가 큐 자동 등록 — 워커가 [파싱+마스킹 → LLM 평가] 를 한 job 으로 처리.
  //   1) resume_upload 토큰 차감 (멱등). 실패(파싱 실패 포함) 시 큐 final fail 에서 자동환불.
  //   2) screening_jobs 에 enqueue.
  //   3) POST 응답 후 triggerWorker 가 즉시 워커를 깨움 (+ cron 안전망).
  //
  // 차감/enqueue 단계가 실패해도 업로드 자체는 성공 처리 — 후보자 상세에서 "평가" 재시도 가능.
  let enqueued = false;
  try {
    if (job.orgId) {
      await chargeFeature({
        orgId: job.orgId,
        feature: "resume_upload",
        refType: "candidate",
        refId: inserted.id,
        userId: me.id,
        memo: candidateName,
      });
    }
    await enqueueScreening(inserted.id, me.id);
    enqueued = true;
  } catch (err) {
    log.warn("auto_enqueue_after_upload_failed", {
      candidateId: inserted.id,
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    ok: true,
    candidateId: inserted.id,
    name: candidateName,
    attachments: attachmentCount,
    enqueued,
  };
}

/**
 * Blob 고아 파일 스위퍼 — 주 1회, 명확한 고아는 자동 삭제 + 결과 통지.
 *
 * deleteFile() 의 Blob 삭제 실패는 조용히 무시되므로(폐기 흐름 중단 방지 우선),
 * DB 에서는 파기 완료인데 Blob 스토어에는 PII 파일이 남는 케이스가 생길 수 있다.
 * 업로드 2단계(blob 선업로드→manifest) 중간 실패·ZIP 원본 정리 실패도 같은 결과.
 *
 * 오판(참조 중 파일 삭제) 방어 — 대조 목록에 새 컬럼 등록을 깜빡한 경우가 최악 시나리오:
 *  - 30일 이상 미참조인 것만 삭제 (신규 파일·업로드 진행 중 오탐 배제)
 *  - 서킷 브레이커: 고아가 max(50개, 전체의 10%) 초과면 삭제하지 않고 경보만
 *    (정상 파일 무더기가 고아로 보인다 = 컬럼 누락·버그 신호)
 * Slack 통지에는 개수·용량만(파일명 = 지원자 이름 포함 가능 PII), 상세는 인증된 응답에만.
 */
import { db } from "@/lib/db";
import {
  candidates,
  candidateAttachments,
  recordedInterviews,
  organizations,
} from "@/lib/schema";
import { like } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { secretEquals } from "@/lib/secret-compare";
import { notifyOps } from "@/lib/error-reporter";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import { COMPANY_INFO } from "@/lib/site-info";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

// 업로드 직후 ~ DB 행 생성(manifest 처리·평가 큐) 사이의 정상 미참조를 오탐하지 않도록
// 최근 업로드는 대조에서 제외.
const GRACE_HOURS = 48;
// 이보다 오래 미참조여야 자동 삭제 대상 (48h~30일 사이는 "관찰 중"으로 집계만).
const DELETE_AFTER_DAYS = 30;

// Slack(SLACK_WEBHOOK_URL) + 운영 메일 양쪽 통지 — Slack 미설정 운영에서도 리포트가 도달해야 함.
async function notifyOpsAndMail(subject: string, text: string): Promise<void> {
  await notifyOps(text);
  const to = process.env.OPS_ALERT_EMAIL ?? COMPANY_INFO.email;
  if (to && (await isSmtpAvailable(null))) {
    try {
      await sendMail({
        to,
        subject,
        text,
        html: `<pre style="font-family:monospace;font-size:13px;white-space:pre-wrap;line-height:1.6;">${text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</pre>`,
        orgId: null,
        audience: "org",
      });
    } catch (e) {
      log.error("blob_orphans_mail_failed", e);
    }
  }
}

async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && secretEquals(header, `Bearer ${secret}`)) return null;
  if (req.headers.get("x-vercel-cron") === "1" && !secret) return null;
  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
}

/** DB 에서 Blob URL 을 저장하는 컬럼 전수 — 새 파일 컬럼 추가 시 여기도 추가할 것. */
async function collectKnownKeys(): Promise<Set<string>> {
  const [resumes, photos, atts, audios, logos] = await Promise.all([
    db
      .select({ k: candidates.resumeFilePath })
      .from(candidates)
      .where(like(candidates.resumeFilePath, "http%")),
    db
      .select({ k: candidates.photoFilePath })
      .from(candidates)
      .where(like(candidates.photoFilePath, "http%")),
    db
      .select({ k: candidateAttachments.filePath })
      .from(candidateAttachments)
      .where(like(candidateAttachments.filePath, "http%")),
    db
      .select({ k: recordedInterviews.audioBlobKey })
      .from(recordedInterviews)
      .where(like(recordedInterviews.audioBlobKey, "http%")),
    db
      .select({ k: organizations.logoFileKey })
      .from(organizations)
      .where(like(organizations.logoFileKey, "http%")),
  ]);
  const known = new Set<string>();
  for (const rows of [resumes, photos, atts, audios, logos]) {
    for (const r of rows) if (r.k) known.add(r.k);
  }
  return known;
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ ok: true, skipped: "BLOB_READ_WRITE_TOKEN 미설정" });
  }

  const known = await collectKnownKeys();

  const { list, del } = await import("@vercel/blob");
  const graceCutoff = Date.now() - GRACE_HOURS * 3_600_000;
  const deleteCutoff = Date.now() - DELETE_AFTER_DAYS * 86_400_000;
  type Orphan = { url: string; pathname: string; size: number; uploadedAt: string };
  const deletable: Orphan[] = [];
  const observing: Orphan[] = []; // 48h~30일 미참조 — 다음 실행에서 삭제 대상이 됨
  let totalBlobs = 0;
  let recentSkipped = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ cursor, limit: 1000 });
    for (const b of page.blobs) {
      totalBlobs++;
      const uploadedMs = new Date(b.uploadedAt).getTime();
      if (uploadedMs > graceCutoff) {
        recentSkipped++;
        continue;
      }
      if (known.has(b.url)) continue;
      const o: Orphan = {
        url: b.url,
        pathname: b.pathname,
        size: b.size,
        uploadedAt: new Date(b.uploadedAt).toISOString(),
      };
      (uploadedMs <= deleteCutoff ? deletable : observing).push(o);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  // 서킷 브레이커 — 삭제 대상이 비정상적으로 많으면 대조 로직/컬럼 누락 의심. 삭제 중단.
  const breakerLimit = Math.max(50, Math.ceil(totalBlobs * 0.1));
  const breakerTripped = deletable.length > breakerLimit;

  let deleted = 0;
  let deletedBytes = 0;
  const failed: { pathname: string; error: string }[] = [];
  if (!breakerTripped && deletable.length > 0) {
    for (const o of deletable) {
      try {
        await del(o.url);
        deleted++;
        deletedBytes += o.size;
      } catch (e) {
        failed.push({
          pathname: o.pathname,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  log.info("blob_orphans_sweep", {
    totalBlobs,
    knownKeys: known.size,
    recentSkipped,
    observing: observing.length,
    deletable: deletable.length,
    deleted,
    deletedBytes,
    failedCount: failed.length,
    breakerTripped,
  });

  if (breakerTripped) {
    await notifyOpsAndMail(
      "[Intervia 🔴] Blob 고아 스위퍼 중단 — 수동 확인 필요",
      `⚠️ Blob 고아 스위퍼 중단: 삭제 대상 ${deletable.length}개가 임계(${breakerLimit})를 초과. ` +
        `정상 파일이 고아로 오판되고 있을 수 있음(새 파일 컬럼의 대조 목록 누락 의심) — 자동 삭제 안 함, 수동 확인 필요.`
    );
  } else if (deleted > 0 || failed.length > 0) {
    await notifyOpsAndMail(
      failed.length > 0
        ? `[Intervia 🟠] Blob 고아 정리 — 삭제 실패 ${failed.length}건 확인 필요`
        : "[Intervia] Blob 고아 정리 완료",
      `Blob 고아 정리: ${deleted}개 삭제 (${(deletedBytes / 1e6).toFixed(1)}MB)` +
        (failed.length > 0
          ? ` / ⚠️ 삭제 실패 ${failed.length}개 — GET /api/cron/blob-orphans (CRON_SECRET) 응답에서 확인 필요.`
          : "") +
        (observing.length > 0 ? ` (관찰 중 ${observing.length}개 — 30일 경과 시 다음 정리 대상)` : "")
    );
  }

  return Response.json({
    ok: true,
    totalBlobs,
    knownKeys: known.size,
    recentSkipped,
    breakerTripped,
    deleted,
    deletedBytes,
    failed,
    // 응답은 인증된 호출자 한정 — 목록은 상한을 두고 노출
    observing: observing.slice(0, 100),
    skippedByBreaker: breakerTripped ? deletable.slice(0, 100) : [],
  });
}

export async function POST(req: Request) {
  return GET(req);
}

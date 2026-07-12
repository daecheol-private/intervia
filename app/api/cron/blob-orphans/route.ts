/**
 * Blob 고아 파일 리포트 — report-only, 월 1회.
 *
 * deleteFile() 의 Blob 삭제 실패는 조용히 무시되므로(폐기 흐름 중단 방지 우선),
 * DB 에서는 파기 완료인데 Blob 스토어에는 PII 파일이 남는 케이스가 생길 수 있다.
 * 이 cron 이 Blob 전체 목록과 DB 의 파일 키 컬럼 전수를 대조해 고아를 집계·통지한다.
 *
 * **절대 삭제하지 않는다** — 대조 로직이 컬럼 하나를 놓치면 참조 중인 파일을 지우는
 * 사고가 되므로, 삭제는 리포트를 보고 운영자가 수동으로 한다.
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
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

// 업로드 직후 ~ DB 행 생성(manifest 처리·평가 큐) 사이의 정상 미참조를 오탐하지 않도록
// 최근 업로드는 대조에서 제외.
const GRACE_HOURS = 48;

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

  const { list } = await import("@vercel/blob");
  const graceCutoff = Date.now() - GRACE_HOURS * 3_600_000;
  const orphans: { pathname: string; size: number; uploadedAt: string }[] = [];
  let totalBlobs = 0;
  let recentSkipped = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ cursor, limit: 1000 });
    for (const b of page.blobs) {
      totalBlobs++;
      if (new Date(b.uploadedAt).getTime() > graceCutoff) {
        recentSkipped++;
        continue;
      }
      if (!known.has(b.url)) {
        orphans.push({
          pathname: b.pathname,
          size: b.size,
          uploadedAt: new Date(b.uploadedAt).toISOString(),
        });
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const orphanBytes = orphans.reduce((s, o) => s + o.size, 0);
  log.info("blob_orphans_report", {
    totalBlobs,
    knownKeys: known.size,
    recentSkipped,
    orphanCount: orphans.length,
    orphanBytes,
  });

  if (orphans.length > 0) {
    await notifyOps(
      `Blob 고아 파일 ${orphans.length}개 (${(orphanBytes / 1e6).toFixed(1)}MB) — DB 미참조 파일이 스토어에 잔존(파기 실패 가능성). ` +
        `상세 목록은 GET /api/cron/blob-orphans (CRON_SECRET) 응답으로 확인 후 수동 삭제.`
    );
  }

  return Response.json({
    ok: true,
    totalBlobs,
    knownKeys: known.size,
    recentSkipped,
    orphanCount: orphans.length,
    orphanBytes,
    // 응답은 인증된 호출자 한정 — 목록은 상한을 두고 노출
    orphans: orphans.slice(0, 100),
  });
}

export async function POST(req: Request) {
  return GET(req);
}

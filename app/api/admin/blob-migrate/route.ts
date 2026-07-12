/**
 * Legacy public Blob → private 스토어 마이그레이션 (일회성 운영 도구).
 *
 * 파일 단위 절차: public URL fetch → private 스토어 put(saveFile) → get() 크기 검증
 * → DB 키 UPDATE. 검증 실패 시 DB 는 건드리지 않고 새 blob 만 정리.
 *
 * 원본 public blob 은 여기서 삭제하지 않는다 — 전체 마이그레이션 완료를 확인한 뒤
 * 옛 스토어를 대시보드에서 통째로 삭제하는 것으로 정리(개별 삭제보다 실수 여지가 적음).
 *
 * 멱등: 마이그레이션된 행은 legacy 스캔(LIKE '%.public.blob%')에 다시 안 잡힌다.
 * GET ?dryRun=1 — 대상 집계만. POST ?limit=N — 배치 실행(기본 30).
 */
import { db } from "@/lib/db";
import {
  candidates,
  candidateAttachments,
  recordedInterviews,
  organizations,
} from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { secretEquals } from "@/lib/secret-compare";
import {
  saveFile,
  fetchBlobFile,
  deleteFile,
  contentTypeFromName,
} from "@/lib/storage";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

const LEGACY_LIKE = "%.public.blob.vercel-storage.com%";

async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && secretEquals(header, `Bearer ${secret}`)) return null;
  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
}

type Target = {
  label: string;
  selectLegacy: () => Promise<string[]>;
  update: (oldKey: string, newKey: string) => Promise<void>;
};

const TARGETS: Target[] = [
  {
    label: "candidates.resume_file_path",
    selectLegacy: async () =>
      (
        await db
          .select({ k: candidates.resumeFilePath })
          .from(candidates)
          .where(sql`${candidates.resumeFilePath} LIKE ${LEGACY_LIKE}`)
      ).map((r) => r.k),
    update: async (oldKey, newKey) => {
      await db
        .update(candidates)
        .set({ resumeFilePath: newKey })
        .where(eq(candidates.resumeFilePath, oldKey));
    },
  },
  {
    label: "candidates.photo_file_path",
    selectLegacy: async () =>
      (
        await db
          .select({ k: candidates.photoFilePath })
          .from(candidates)
          .where(sql`${candidates.photoFilePath} LIKE ${LEGACY_LIKE}`)
      ).map((r) => r.k!),
    update: async (oldKey, newKey) => {
      await db
        .update(candidates)
        .set({ photoFilePath: newKey })
        .where(eq(candidates.photoFilePath, oldKey));
    },
  },
  {
    label: "candidate_attachments.file_path",
    selectLegacy: async () =>
      (
        await db
          .select({ k: candidateAttachments.filePath })
          .from(candidateAttachments)
          .where(sql`${candidateAttachments.filePath} LIKE ${LEGACY_LIKE}`)
      ).map((r) => r.k),
    update: async (oldKey, newKey) => {
      await db
        .update(candidateAttachments)
        .set({ filePath: newKey })
        .where(eq(candidateAttachments.filePath, oldKey));
    },
  },
  {
    label: "recorded_interviews.audio_blob_key",
    selectLegacy: async () =>
      (
        await db
          .select({ k: recordedInterviews.audioBlobKey })
          .from(recordedInterviews)
          .where(sql`${recordedInterviews.audioBlobKey} LIKE ${LEGACY_LIKE}`)
      ).map((r) => r.k!),
    update: async (oldKey, newKey) => {
      await db
        .update(recordedInterviews)
        .set({ audioBlobKey: newKey })
        .where(eq(recordedInterviews.audioBlobKey, oldKey));
    },
  },
  {
    label: "organizations.logo_file_key",
    selectLegacy: async () =>
      (
        await db
          .select({ k: organizations.logoFileKey })
          .from(organizations)
          .where(sql`${organizations.logoFileKey} LIKE ${LEGACY_LIKE}`)
      ).map((r) => r.k!),
    update: async (oldKey, newKey) => {
      await db
        .update(organizations)
        .set({ logoFileKey: newKey })
        .where(eq(organizations.logoFileKey, oldKey));
    },
  },
];

function basenameOf(url: string): string {
  try {
    return decodeURIComponent(
      new URL(url).pathname.split("/").pop() || "file.bin"
    );
  } catch {
    return "file.bin";
  }
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  const counts: Record<string, number> = {};
  let total = 0;
  for (const t of TARGETS) {
    const keys = await t.selectLegacy();
    counts[t.label] = keys.length;
    total += keys.length;
  }
  return Response.json({ ok: true, dryRun: true, total, counts });
}

export async function POST(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 30)));
  // 함수 시간 상한 안에서 안전하게 끝내기 위한 벽시계 예산
  const deadline = Date.now() + 240_000;

  let migrated = 0;
  let remaining = 0;
  const failed: { target: string; file: string; error: string }[] = [];

  for (const t of TARGETS) {
    const keys = [...new Set(await t.selectLegacy())];
    for (const oldKey of keys) {
      if (migrated >= limit || Date.now() > deadline) {
        remaining++;
        continue;
      }
      const file = basenameOf(oldKey);
      try {
        // 1) legacy public 스토어에서 읽기 (public — 인증 불요)
        const r = await fetch(oldKey);
        if (!r.ok) throw new Error(`legacy fetch ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());

        // 2) private 스토어에 저장 (파일명은 익명 랜덤으로 재생성 — 원본명 PII 제거 효과)
        const newKey = await saveFile(
          file,
          buf,
          r.headers.get("content-type") ?? contentTypeFromName(file)
        );

        // 3) 읽기 검증 — 실패하면 DB 는 그대로 두고 새 blob 만 정리
        const chk = await fetchBlobFile(newKey);
        if (!chk || chk.data.length !== buf.length) {
          await deleteFile(newKey).catch(() => {});
          throw new Error(
            `verify failed (got ${chk ? chk.data.length : "null"}, want ${buf.length})`
          );
        }

        // 4) DB 키 교체 (같은 키를 참조하는 모든 행)
        await t.update(oldKey, newKey);
        migrated++;
      } catch (e) {
        failed.push({
          target: t.label,
          file,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  log.info("blob_migrate_batch", {
    migrated,
    failedCount: failed.length,
    remaining,
  });
  return Response.json({ ok: true, migrated, failed, remaining });
}

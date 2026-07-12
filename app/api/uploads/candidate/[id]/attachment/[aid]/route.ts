/**
 * 후보자 첨부 파일 다운로드 — /api/uploads/candidate/[id] 와 동일한 가드.
 *
 *  - 세션 + ownsOrg + 잠긴 공고 PIN 체크
 *  - Blob URL 이면 SSRF 화이트리스트 검증 후 server-side fetch + stream proxy
 *  - 감사 로그 (candidate.download_attachment)
 */
import { db } from "@/lib/db";
import { candidates, candidateAttachments, jobPostings } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import {
  readLocalFile,
  safeDownloadContentType,
  downloadDisposition,
} from "@/lib/storage";
import path from "node:path";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

function contentTypeFromPath(p: string): string {
  const e = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".hwp": "application/x-hwp",
    ".hwpx": "application/vnd.hancom.hwpx",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".md": "text/plain",
  };
  return map[e] ?? "application/octet-stream";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; aid: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  // 대량 유출 억제 — 이력서 라우트와 같은 scope 로 합산 카운트.
  const limited = await rateLimit(
    req,
    "download",
    { limit: 120, windowSec: 600 },
    me!.id
  );
  if (limited) return limited;

  const { id, aid } = await params;
  const cid = Number(id);
  const attId = Number(aid);
  if (!Number.isInteger(cid) || !Number.isInteger(attId))
    return new Response("Bad request", { status: 400 });

  const [candidate] = await db
    .select({
      orgId: candidates.orgId,
      jobId: candidates.jobId,
      name: candidates.name,
    })
    .from(candidates)
    .where(eq(candidates.id, cid));
  if (!candidate) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, candidate.orgId))
    return new Response("Not found", { status: 404 });

  const [job] = await db
    .select({ id: jobPostings.id, passwordHash: jobPostings.passwordHash })
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (
    job &&
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(job.id))
  ) {
    return new Response("잠긴 공고입니다.", { status: 403 });
  }

  const [att] = await db
    .select()
    .from(candidateAttachments)
    .where(
      and(
        eq(candidateAttachments.id, attId),
        eq(candidateAttachments.candidateId, cid)
      )
    );
  if (!att) return new Response("Not found", { status: 404 });

  logAudit(req, {
    actor: me!,
    action: "candidate.download_resume",
    resourceType: "candidate_attachment",
    resourceId: attId,
    orgId: candidate.orgId,
    metadata: {
      name: candidate.name,
      kind: att.kind,
      originalName: att.originalName,
    },
  });

  const safeName = (att.originalName || `attachment_${attId}`)
    .replace(/[\r\n"]/g, "");
  // 위험 타입은 octet-stream 강등 + 안전 타입만 inline, 그 외 강제 다운로드 (저장형 XSS 차단)
  const dispFor = (ct: string) =>
    `${downloadDisposition(ct)}; filename*=UTF-8''${encodeURIComponent(safeName)}`;

  const key = att.filePath;
  if (/^https?:\/\//i.test(key)) {
    // SSRF — Blob 호스트 화이트리스트만 허용
    const allowedHosts = new Set<string>([
      "blob.vercel-storage.com",
      ...(process.env.BLOB_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ]);
    let host = "";
    try {
      const u = new URL(key);
      if (u.protocol !== "https:") throw new Error("not https");
      host = u.host.toLowerCase();
    } catch {
      return new Response("invalid file url", { status: 400 });
    }
    const ok = [...allowedHosts].some(
      (h) => host === h || host.endsWith("." + h)
    );
    if (!ok) return new Response("file location blocked", { status: 502 });
    const upstream = await fetch(key);
    if (!upstream.ok)
      return new Response("upstream fetch failed", { status: 502 });
    // 스트림 pass-through 대신 버퍼링 — fetch 자동 압축해제 시 upstream 의
    // Content-Length 가 본문과 어긋나 Vercel 함수가 500 난다 (이력서 라우트와 동일).
    const buf = Buffer.from(await upstream.arrayBuffer());
    const ct = safeDownloadContentType(
      upstream.headers.get("content-type") ?? contentTypeFromPath(key)
    );
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": ct,
        "Content-Length": String(buf.byteLength),
        "Content-Disposition": dispFor(ct),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  // 로컬 디스크
  const found = await readLocalFile(key);
  if (!found) return new Response("Not found", { status: 404 });
  const ct = safeDownloadContentType(found.contentType);
  return new Response(new Uint8Array(found.data), {
    headers: {
      "Content-Type": ct,
      "Content-Disposition": dispFor(ct),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

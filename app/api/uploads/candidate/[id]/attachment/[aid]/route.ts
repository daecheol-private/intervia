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
import { readLocalFile } from "@/lib/storage";
import path from "node:path";
import { logAudit } from "@/lib/audit";

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
  const disposition = `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`;

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
    if (!upstream.ok || !upstream.body)
      return new Response("upstream fetch failed", { status: 502 });
    return new Response(upstream.body, {
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? contentTypeFromPath(key),
        "Content-Length": upstream.headers.get("content-length") ?? "",
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // 로컬 디스크
  const found = await readLocalFile(key);
  if (!found) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(found.data), {
    headers: {
      "Content-Type": found.contentType,
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
    },
  });
}

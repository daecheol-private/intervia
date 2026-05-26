/**
 * 후보자 이력서 파일 다운로드 — 인증 + 권한 검증 후 stream proxy.
 *
 * 보안:
 *  - 세션 필수
 *  - ownsOrg (system_admin 우회)
 *  - 부모 공고 PIN 잠금 체크
 *  - resumeFilePath 가 Blob URL 이어도 redirect 대신 server-side fetch + stream
 *    → Blob 의 public URL 이 외부에 노출되지 않도록 함
 *
 * 이전 `/api/uploads/[file]` 는 deprecate (인증 가드만 추가).
 */
import { db } from "@/lib/db";
import { candidates, jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { readLocalFile } from "@/lib/storage";
import path from "node:path";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

function contentTypeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".html":
    case ".htm":
      return "text/html";
    case ".txt":
    case ".md":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid))
    return new Response("Bad request", { status: 400 });

  const [candidate] = await db
    .select({
      orgId: candidates.orgId,
      jobId: candidates.jobId,
      resumeFilePath: candidates.resumeFilePath,
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

  const key = candidate.resumeFilePath;
  if (!key) return new Response("파일 없음", { status: 404 });

  logAudit(req, {
    actor: me!,
    action: "candidate.download_resume",
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
    metadata: { name: candidate.name },
  });

  // 다운로드 시 보여줄 안전한 파일명 (사용자 이름 + 확장자)
  const ext = path.extname(key) || ".pdf";
  const safeName = `${candidate.name}_resume${ext}`.replace(/[\r\n"]/g, "");
  const disposition = `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`;

  // Blob URL 모드: 우리 함수가 fetch 해서 stream proxy. Blob URL 외부 노출 X.
  if (/^https?:\/\//i.test(key)) {
    // SSRF 방어 — Vercel Blob 도메인만 허용. 다른 호스트는 차단.
    // (운영자가 추가 호스트 필요 시 BLOB_ALLOWED_HOSTS 콤마 구분으로 지정)
    const allowedHosts = new Set<string>([
      "blob.vercel-storage.com",
      ...(process.env.BLOB_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ]);
    let upstreamHost = "";
    try {
      const u = new URL(key);
      if (u.protocol !== "https:") throw new Error("not https");
      upstreamHost = u.host.toLowerCase();
    } catch {
      return new Response("invalid file url", { status: 400 });
    }
    // 정확히 일치하거나, 허용 호스트의 서브도메인(.<host>)인 경우만 통과
    const ok = [...allowedHosts].some(
      (h) => upstreamHost === h || upstreamHost.endsWith("." + h)
    );
    if (!ok) {
      console.error("[uploads] blocked SSRF target:", upstreamHost);
      return new Response("file location blocked", { status: 502 });
    }
    const upstream = await fetch(key);
    if (!upstream.ok || !upstream.body) {
      return new Response("upstream fetch failed", { status: 502 });
    }
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

  // 로컬 디스크 모드
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

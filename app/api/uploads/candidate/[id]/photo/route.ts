/**
 * 후보자 증명사진 표시 — 인증 + 권한 검증 후 stream proxy (inline 이미지).
 *
 * 이력서 다운로드 라우트(../route.ts)와 동일한 보안 모델:
 *  - 세션 필수 + ownsOrg(system_admin 우회) + 부모 공고 PIN 잠금 체크
 *  - Blob URL 이어도 redirect 대신 server-side fetch + stream → Blob public URL 비노출
 *  - SSRF 방어(Blob 도메인 화이트리스트)
 *
 * 사진은 표시 전용이며 image/jpeg·image/png 만 다룬다(저장 시 우리가 생성한 키).
 */
import { db } from "@/lib/db";
import { candidates, jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { readLocalFile } from "@/lib/storage";
import path from "node:path";

export const runtime = "nodejs";

function imageContentType(p: string): string {
  return path.extname(p).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
}

export async function GET(
  _req: Request,
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
      photoFilePath: candidates.photoFilePath,
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

  const key = candidate.photoFilePath;
  if (!key) return new Response("사진 없음", { status: 404 });

  // Blob URL 모드: 우리 함수가 fetch 해서 stream proxy. Blob URL 외부 노출 X.
  if (/^https?:\/\//i.test(key)) {
    // SSRF 방어 — Vercel Blob 도메인만 허용(이력서 라우트와 동일 화이트리스트).
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
    const ok = [...allowedHosts].some(
      (h) => upstreamHost === h || upstreamHost.endsWith("." + h)
    );
    if (!ok) {
      console.error("[uploads/photo] blocked SSRF target:", upstreamHost);
      return new Response("file location blocked", { status: 502 });
    }
    const upstream = await fetch(key);
    if (!upstream.ok) {
      return new Response("upstream fetch failed", { status: 502 });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": imageContentType(key),
        "Content-Length": String(buf.byteLength),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  // 로컬 디스크 모드
  const found = await readLocalFile(key);
  if (!found) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(found.data), {
    headers: {
      "Content-Type": imageContentType(key),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

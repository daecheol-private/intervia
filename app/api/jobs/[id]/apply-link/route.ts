import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { generateApplyToken } from "@/lib/apply-link";
import { subdomainApplyEnabled, applyUrlFor } from "@/lib/subdomain";
import { ensureOrgSubdomain } from "@/lib/org-subdomain";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * 공고의 공개 지원 링크 발급/조회.
 *  - GET  : 현재 토큰 반환 (없으면 null)
 *  - POST : 토큰이 없으면 생성, 있으면 그대로 반환 (멱등 — 재호출해도 같은 토큰)
 *
 * 응답 url 은 법인 서브도메인({sub}.intervia.kr) 정본 URL — 서브도메인 기능 OFF 면
 * null 이고 클라이언트가 origin + path 로 구성한다(기존 동작).
 */
async function loadOwnedJob(jobId: number, orgGuard: (orgId: number | null) => boolean) {
  const [job] = await db.select().from(jobPostings).where(eq(jobPostings.id, jobId));
  if (!job || !orgGuard(job.orgId)) return null;
  return job;
}

async function brandedUrl(orgId: number | null, token: string): Promise<string | null> {
  if (!subdomainApplyEnabled()) return null;
  const sub = await ensureOrgSubdomain(orgId);
  return sub ? applyUrlFor(sub, token) : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const job = await loadOwnedJob(Number(id), (orgId) => ownsOrg(me!, orgId));
  if (!job) return new Response("Not found", { status: 404 });

  return Response.json({
    token: job.applyToken,
    path: job.applyToken ? `/apply/${job.applyToken}` : null,
    url: job.applyToken ? await brandedUrl(job.orgId, job.applyToken) : null,
  });
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
  const job = await loadOwnedJob(jobId, (orgId) => ownsOrg(me!, orgId));
  if (!job) return new Response("Not found", { status: 404 });

  let token = job.applyToken;
  if (!token) {
    token = generateApplyToken();
    await db
      .update(jobPostings)
      .set({ applyToken: token })
      .where(eq(jobPostings.id, jobId));
    logAudit(req, {
      actor: me!,
      action: "job.apply_link_create",
      resourceType: "job",
      resourceId: jobId,
      orgId: job.orgId,
    });
  }

  return Response.json({
    token,
    path: `/apply/${token}`,
    url: await brandedUrl(job.orgId, token),
  });
}

import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { setJobUnlocked } from "@/lib/job-lock";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);

  // 4자리 PIN 무차별 대입 차단 — (사용자, 공고)별 5회/5분.
  const limited = await rateLimit(req, "job-unlock", {
    limit: 5,
    windowSec: 300,
    identifier: `unlock:${me!.id}:${jobId}`,
  });
  if (limited) return limited;

  const { password } = (await req.json()) as { password?: string };
  if (!password) return new Response("비밀번호 필수", { status: 400 });

  const [row] = await db
    .select({ passwordHash: jobPostings.passwordHash, orgId: jobPostings.orgId })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!row) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, row.orgId)) return new Response("Not found", { status: 404 });
  if (!row.passwordHash) return new Response("비밀번호가 없는 공고", { status: 400 });

  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return new Response("비밀번호가 일치하지 않습니다.", { status: 401 });

  await setJobUnlocked(jobId);
  return new Response(null, { status: 204 });
}

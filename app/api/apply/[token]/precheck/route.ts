import { db } from "@/lib/db";
import { jobPostings, candidates } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { DUPLICATE_MESSAGE_PLAIN } from "@/lib/apply-identity";

export const runtime = "nodejs";

/**
 * 지원 사전 중복체크 — 업로드 전에 "같은 이력서 파일이 이미 접수됐는지"만 확인한다.
 *
 * 보안 감사 M3: 예전엔 이메일·전화번호만으로 기존 지원 여부를 답해 "이 사람이 이 회사에
 * 지원했나" 조회기가 됐다. 이제 브라우저가 계산한 이력서 파일의 SHA-256 이 일치할 때만
 * 중복이라고 답한다 — 파일 바이트를 가진 사람(본인)만 알 수 있는 값이라 제3자 조회가 안 된다.
 * 번호·이메일 중복은 이력서를 실제로 제출했을 때만(/api/apply/[token]) 판정·안내한다.
 * 옛 클라이언트가 email·phone 을 보내도 무시하고 duplicate:false.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await rateLimit(req, "apply-precheck", { limit: 20, windowSec: 600 });
  if (limited) return limited;

  const { token } = await params;
  let body: { resume_sha256?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ duplicate: false });
  }
  const hash =
    typeof body.resume_sha256 === "string" ? body.resume_sha256.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return Response.json({ duplicate: false });

  const [job] = await db
    .select({ id: jobPostings.id })
    .from(jobPostings)
    .where(eq(jobPostings.applyToken, token));
  if (!job) return Response.json({ duplicate: false });

  const [dup] = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(eq(candidates.jobId, job.id), eq(candidates.resumeHash, hash)));
  if (dup)
    return Response.json({
      duplicate: true,
      code: "already_applied",
      message: DUPLICATE_MESSAGE_PLAIN,
    });
  return Response.json({ duplicate: false });
}

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { isJobExpired } from "@/lib/job-lifecycle";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

// 브라우저 → Vercel Blob 직접 업로드를 위한 토큰 발급 라우트.
// Vercel 서버리스 함수 본문 한도(4.5MB)를 우회해 100MB 파일을 받기 위함.
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayloadRaw) => {
        // clientPayload 로 jobId 전달 — 권한 검증
        let jobId = 0;
        try {
          const p = JSON.parse(clientPayloadRaw ?? "{}") as { jobId?: number };
          jobId = Number(p.jobId);
        } catch {
          /* malformed */
        }
        if (!jobId) throw new Error("jobId 누락");

        const [job] = await db
          .select()
          .from(jobPostings)
          .where(eq(jobPostings.id, jobId));
        if (!job) throw new Error("공고를 찾을 수 없습니다.");
        if (!ownsOrg(me!, job.orgId)) throw new Error("권한 없음");
        if (job.status === "closed") throw new Error("종결된 공고입니다.");
        if (isJobExpired(job))
          throw new Error(
            "공고 종결 예정일이 지났습니다. 공고를 연장하거나 종결한 후 다시 시도해 주세요."
          );
        if (
          me!.role !== "system_admin" &&
          job.passwordHash &&
          !(await isJobUnlocked(jobId))
        ) {
          throw new Error("잠긴 공고입니다.");
        }

        return {
          allowedContentTypes: undefined,
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ jobId, userId: me!.id, pathname }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // 로컬 dev 에서는 Vercel 이 콜백 못 옴 — 프로덕션 로그용
        log.info("blob_client_upload_completed", {
          url: blob.url,
          pathname: blob.pathname,
          tokenPayload,
        });
      },
    });

    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("blob_client_upload_token_failed", { error: msg });
    return new Response(msg, { status: 400 });
  }
}

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { isJobExpired } from "@/lib/job-lifecycle";
import { guardCandidate } from "@/lib/candidate-guard";
import { MAX_ATTACHMENT_SIZE, MAX_AUDIO_BYTES } from "@/lib/upload-validation";
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
        let payload: { jobId?: number; candidateId?: number; kind?: string } = {};
        try {
          payload = JSON.parse(clientPayloadRaw ?? "{}") as typeof payload;
        } catch {
          /* malformed */
        }

        // 후보자 하위 파일 경로 — 로그인 HR. kind:"audio"=대면 녹음(18MB), 그 외=첨부(10MB).
        const candidateId = Number(payload.candidateId);
        if (candidateId) {
          const g = await guardCandidate(me!, candidateId);
          if (!g.ok) throw new Error("업로드 권한이 없습니다.");
          const isAudio = payload.kind === "audio";
          if (!isAudio) {
            // 첨부는 결정·폐기된 후보자에 추가 불가(대면 녹음은 결정 후에도 허용).
            if (g.candidate.outcome)
              throw new Error("이미 합·불이 결정된 후보자에는 첨부를 추가할 수 없습니다.");
            if (!g.candidate.resumeFilePath && !g.candidate.resumeMaskedText)
              throw new Error("원본이 폐기된 후보자에는 첨부를 추가할 수 없습니다.");
          }
          return {
            allowedContentTypes: undefined,
            maximumSizeInBytes: isAudio ? MAX_AUDIO_BYTES : MAX_ATTACHMENT_SIZE,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ candidateId, userId: me!.id }),
          };
        }

        // 공고 일괄 업로드 경로 (기존) — clientPayload 의 jobId 로 권한 검증.
        const jobId = Number(payload.jobId);
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
        // 로컬 dev 에서는 Vercel 이 콜백 못 옴 — 프로덕션 로그용.
        // blob.url 은 public 접근 가능한 이력서 URL — 로그에 남기면 로그 열람 = 파일 접근이
        // 되므로 url/pathname(원본 파일명에 지원자 이름 포함 가능)은 기록하지 않는다.
        let meta: { jobId?: number; candidateId?: number; userId?: number } = {};
        try {
          meta = JSON.parse(tokenPayload ?? "{}") as typeof meta;
        } catch {
          /* malformed */
        }
        log.info("blob_client_upload_completed", {
          jobId: meta.jobId,
          candidateId: meta.candidateId,
          userId: meta.userId,
          ext: (blob.pathname.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "").toLowerCase(),
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

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { isJobExpired } from "@/lib/job-lifecycle";
import { rateLimit } from "@/lib/rate-limit";
import {
  ext,
  RESUME_EXTS,
  ATTACHMENT_EXTS,
  MAX_ATTACHMENT_SIZE,
} from "@/lib/upload-validation";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * 공개(비로그인) 지원자용 Vercel Blob 직접 업로드 토큰 발급.
 * 브라우저가 Blob 으로 직접 올려 Vercel 서버리스 함수 본문 한도(4.5MB)를 우회 —
 * 4.5~10MB 이력서/첨부가 함수 도달 전 413 으로 잘리던 문제 해결.
 * (관리자 /api/blob/upload 와 같은 방식이나, 로그인 대신 지원 토큰(applyToken)으로 인가.)
 * proxy.ts matcher 가 /api/apply/* 를 제외하므로 CSRF·인증 면제 — 토큰이 곧 인증.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // 봇·플러드 차단 — 파일당 토큰 1회 발급이라 최종 제출(scope "apply", 8회)보다 관대하되,
  // 공개 엔드포인트이므로 남용 대역을 제한. 정상 지원(이력서1+첨부 최대 10)엔 여유.
  const limited = await rateLimit(req, "apply-blob", { limit: 20, windowSec: 600 });
  if (limited) return limited;

  const { token } = await params;
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.applyToken, token));

  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayloadRaw) => {
        if (!job) throw new Error("유효하지 않은 지원 링크입니다.");
        if (job.status === "closed" || isJobExpired(job))
          throw new Error("지원이 마감되었습니다.");
        // 파일 종류별 확장자 제한 — resume=이력서(pdf·docx·hwpx), attachment=첨부 허용목록.
        let kind = "attachment";
        try {
          const p = JSON.parse(clientPayloadRaw ?? "{}") as { kind?: string };
          if (p.kind === "resume") kind = "resume";
        } catch {
          /* malformed payload — attachment 규칙 적용 */
        }
        const allowed = kind === "resume" ? RESUME_EXTS : ATTACHMENT_EXTS;
        if (!allowed.has(ext(pathname)))
          throw new Error(
            kind === "resume"
              ? "이력서는 PDF · DOCX · HWPX 파일만 업로드할 수 있습니다."
              : "허용되지 않는 첨부 형식입니다."
          );
        return {
          allowedContentTypes: undefined,
          maximumSizeInBytes: MAX_ATTACHMENT_SIZE,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ jobId: job.id }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        // 로컬 dev 는 Vercel 콜백 미수신 — 실제 후보자 등록은 manifest POST(/api/apply/[token])가 수행.
        // url·pathname 은 지원자 PII(파일명에 이름 포함 가능)라 로그에 남기지 않고 확장자만.
        log.info("apply_blob_upload_completed", {
          ext: (blob.pathname.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "").toLowerCase(),
        });
      },
    });
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("apply_blob_token_failed", { error: msg });
    return new Response(msg, { status: 400 });
  }
}

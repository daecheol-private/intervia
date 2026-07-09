/**
 * 공개 지원 페이지 로고 — 지원 토큰으로 공고→법인 로고를 스트리밍.
 * 공개 URL = 사실상의 인증(지원 페이지와 동일 모델). Blob URL 은 노출하지 않고
 * 서버가 fetch 해서 프록시한다 (후보자 사진 라우트와 동일 패턴).
 */
import { db } from "@/lib/db";
import { jobPostings, organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { readStoredFile, contentTypeFromName } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const [row] = await db
    .select({ logoFileKey: organizations.logoFileKey })
    .from(jobPostings)
    .leftJoin(organizations, eq(organizations.id, jobPostings.orgId))
    .where(eq(jobPostings.applyToken, token));
  if (!row?.logoFileKey) return new Response("Not found", { status: 404 });

  const buf = await readStoredFile(row.logoFileKey);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentTypeFromName(row.logoFileKey),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      // 로고는 공개 브랜드 자산 — 짧게 캐시해 지원 페이지 로딩 부담을 줄인다
      "Cache-Control": "public, max-age=300",
    },
  });
}

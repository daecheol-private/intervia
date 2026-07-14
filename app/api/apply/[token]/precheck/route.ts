import { db } from "@/lib/db";
import { jobPostings, candidates } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

/**
 * 지원 사전 중복체크 — 파일 업로드 전에 email·전화번호로 기존 지원 여부를 확인한다.
 * 이미 지원한 지원자가 큰 파일을 Blob 에 올린 뒤에야 거부돼 고아가 남는 것을 방지(조기 UX 게이트).
 * 최종 판정은 제출 시 /api/apply/[token] 이 다시 수행하므로, 여기 통과 = 최종 통과 보장은 아니다.
 * proxy.ts matcher 가 /api/apply/* 를 제외하므로 CSRF·인증 면제 — 토큰이 곧 인증.
 *
 * 주의(enumeration): 공개 엔드포인트라 임의 email 의 지원 여부 조회가 이론상 가능 —
 *   rate limit 으로 대량 조회를 억제한다(원래도 최종 제출로 확인 가능한 정보라 신규 노출은 아님).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await rateLimit(req, "apply-precheck", { limit: 20, windowSec: 600 });
  if (limited) return limited;

  const { token } = await params;
  let body: { email?: string; phone?: string };
  try {
    body = (await req.json()) as { email?: string; phone?: string };
  } catch {
    return Response.json({ duplicate: false });
  }
  const email = (body.email || "").trim().toLowerCase();
  const normPhone = normalizePhone(body.phone);

  const [job] = await db
    .select({ id: jobPostings.id })
    .from(jobPostings)
    .where(eq(jobPostings.applyToken, token));
  if (!job) return Response.json({ duplicate: false });

  // 이메일 중복 (공고당 1회)
  if (email && /\S+@\S+\.\S+/.test(email)) {
    const [dup] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(and(eq(candidates.jobId, job.id), eq(candidates.email, email)));
    if (dup)
      return Response.json({
        duplicate: true,
        code: "already_applied",
        message:
          "이미 이 공고에 지원하셨습니다. 지원서는 한 번만 제출할 수 있습니다.",
      });
  }

  // 연락처 중복 — 입력된 경우만. 저장값의 구분자(-, 공백, 괄호, 점)를 제거해 숫자만 비교.
  if (normPhone) {
    const [dup] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(
          eq(candidates.jobId, job.id),
          sql`replace(replace(replace(replace(replace(${candidates.phone}, '-', ''), ' ', ''), '(', ''), ')', ''), '.', '') = ${normPhone}`
        )
      );
    if (dup)
      return Response.json({
        duplicate: true,
        code: "already_applied",
        message:
          "이미 이 연락처로 지원하신 내역이 있습니다. 지원서는 한 번만 제출할 수 있습니다.",
      });
  }

  return Response.json({ duplicate: false });
}

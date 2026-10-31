import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/phone";
import { isJobExpired } from "@/lib/job-lifecycle";
import { sendPhoneOtp, verifyPhoneOtp } from "@/lib/phone-otp";
import { findPhoneMatches, reportEligible, verifyDupToken } from "@/lib/apply-identity";

export const runtime = "nodejs";

/**
 * 중복 지원 본인 확인 — 휴대폰 인증번호 발송(send) / 확인(verify).
 *
 * 제출이 중복으로 막히면서 받은 dupToken(공고·번호 묶음)이 있어야만 쓸 수 있다 — 이력서 제출 없이
 * 임의 번호로 카톡을 보내거나 "이 번호가 지원했나"를 묻는 경로가 되지 않게 한다.
 * 확인에 성공하면 ticket 을 돌려주고, 지원 제출(/api/apply/[token])이 identity_ticket 으로 다시 검증한다.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await rateLimit(req, "apply-identity-otp", { limit: 20, windowSec: 600 });
  if (limited) return limited;

  const { token } = await params;
  let body: { action?: string; phone?: string; dupToken?: string; code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, message: "잘못된 요청입니다." }, { status: 400 });
  }
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const normPhone = normalizePhone(phone);

  const [job] = await db
    .select({
      id: jobPostings.id,
      status: jobPostings.status,
      closesAt: jobPostings.closesAt,
      closedAt: jobPostings.closedAt,
    })
    .from(jobPostings)
    .where(eq(jobPostings.applyToken, token));
  if (!job) return Response.json({ ok: false, message: "유효하지 않은 지원 링크입니다." }, { status: 404 });
  if (job.status === "closed" || isJobExpired(job))
    return Response.json({ ok: false, message: "지원이 마감되었습니다." }, { status: 410 });

  if (!verifyDupToken(body.dupToken, job.id, normPhone))
    return Response.json(
      { ok: false, reason: "expired_request", message: "인증 요청이 만료되었습니다. 지원서를 다시 제출해 주세요." },
      { status: 400 }
    );
  // 발송 직전 재확인 — 그사이 신고가 끝났으면(번호당 1회) 더 보내지 않는다.
  if (!reportEligible(await findPhoneMatches(job.id, normPhone)))
    return Response.json(
      { ok: false, reason: "not_eligible", message: "이 번호로는 인증을 진행할 수 없습니다. 채용 담당자에게 문의해 주세요." },
      { status: 409 }
    );

  if (body.action === "send") {
    const r = await sendPhoneOtp(req, { purpose: "apply_duplicate", phone });
    if (r.ok) return Response.json(r);
    const status =
      r.reason === "unavailable" ? 503 : r.reason === "invalid_phone" ? 400 : r.reason === "send_failed" ? 502 : 429;
    return Response.json(r, { status });
  }
  if (body.action === "verify") {
    const r = await verifyPhoneOtp({
      purpose: "apply_duplicate",
      phone,
      code: typeof body.code === "string" ? body.code : "",
    });
    return Response.json(r, { status: r.ok ? 200 : 400 });
  }
  return Response.json({ ok: false, message: "잘못된 요청입니다." }, { status: 400 });
}

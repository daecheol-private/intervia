/**
 * 지원자 지원 링크 페이지 문제 신고 / 서비스 불편사항 접수.
 *
 * 인증: 공고 지원 토큰(applyToken)만 — 비로그인 지원자가 이력서 업로드 중 막혔을 때 쓰는 채널.
 *       아직 candidate/세션 레코드가 없으므로 회신용 이메일(필수)·전화번호(선택)만 입력받는다.
 * Rate limit: IP 분당 3회 (스팸 방지).
 *
 * 공고가 마감·만료됐어도 신고는 받는다(막힌 사람을 더 막지 않음). 토큰이 유효(공고 존재)하기만
 * 하면 접수한다. 접수 시 지원 이메일 통지 — 실패해도 DB 저장은 성공 응답.
 */
import { after } from "next/server";
import { db } from "@/lib/db";
import { jobPostings, organizations, inquiries } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { extractIp } from "@/lib/auth-attempts";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { notifyNewInquiry } from "@/lib/inquiry-notify";
import {
  isValidCategory,
  MESSAGE_MIN,
  MESSAGE_MAX,
  PHONE_MAX,
} from "@/lib/inquiry";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await rateLimit(req, "inquiry", { limit: 3, windowSec: 60 });
  if (limited) return limited;

  const { token } = await params;
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    phone?: string;
    category?: string;
    message?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase();
  const phone = body?.phone?.trim() || null;
  const category = body?.category?.trim();
  const message = body?.message?.trim();

  if (!email || !category || !message)
    return new Response("이메일·분류·내용을 모두 입력해 주세요.", { status: 400 });
  if (!isValidCategory("applicant", category))
    return new Response("분류 값이 올바르지 않습니다.", { status: 400 });
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX)
    return new Response(
      `내용은 ${MESSAGE_MIN}자 이상, ${MESSAGE_MAX}자 이하로 작성해 주세요.`,
      { status: 400 }
    );
  if (phone && phone.length > PHONE_MAX)
    return new Response("전화번호가 너무 깁니다.", { status: 400 });

  const [job] = await db
    .select({
      id: jobPostings.id,
      orgId: jobPostings.orgId,
      orgName: organizations.name,
    })
    .from(jobPostings)
    .leftJoin(organizations, eq(organizations.id, jobPostings.orgId))
    .where(eq(jobPostings.applyToken, token));
  if (!job) return new Response("지원 링크 없음", { status: 404 });

  const orgId = job.orgId ?? null;

  await db.insert(inquiries).values({
    source: "applicant",
    category,
    message,
    contactEmail: email,
    contactPhone: phone,
    orgId,
    jobId: job.id,
    ip: extractIp(req),
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  });

  logAudit(req, {
    actorRole: "applicant",
    action: "inquiry.submit",
    resourceType: "job_posting",
    resourceId: job.id,
    orgId,
    metadata: { category, message_length: message.length },
  });

  // after() — 응답 반환 후 실행 보장. void fire-and-forget 은 서버리스 suspend 로 유실됨.
  after(() =>
    notifyNewInquiry({
      source: "applicant",
      category,
      message,
      contactEmail: email,
      contactPhone: phone,
      orgName: job.orgName,
      orgId,
    }).catch((e) => console.error("[inquiry] 지원 문의 통지 실패:", e))
  );

  return Response.json({ ok: true });
}

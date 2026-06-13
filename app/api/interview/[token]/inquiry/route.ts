/**
 * 후보자 면접 중 문제 신고 / 서비스 불편사항 접수.
 *
 * 인증: 면접 토큰만 — 비로그인 후보자가 진행 중 막혔을 때 쓰는 채널이므로
 *       이의제기(appeal)와 달리 본인 이메일 매칭을 요구하지 않는다(막힌 사람을 더 막지 않음).
 *       회신용 연락 이메일만 입력받는다.
 * Rate limit: IP 분당 3회 (스팸 방지).
 *
 * 접수 시 지원 이메일 통지 — 실패해도 DB 저장은 성공 응답.
 */
import { after } from "next/server";
import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  organizations,
  inquiries,
} from "@/lib/schema";
import { eq } from "drizzle-orm";
import { extractIp } from "@/lib/auth-attempts";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { notifyNewInquiry } from "@/lib/inquiry-notify";
import {
  isValidCategory,
  MESSAGE_MIN,
  MESSAGE_MAX,
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
    category?: string;
    message?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase();
  const category = body?.category?.trim();
  const message = body?.message?.trim();

  if (!email || !category || !message)
    return new Response("이메일·분류·내용을 모두 입력해 주세요.", { status: 400 });
  if (!isValidCategory("candidate", category))
    return new Response("분류 값이 올바르지 않습니다.", { status: 400 });
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX)
    return new Response(
      `내용은 ${MESSAGE_MIN}자 이상, ${MESSAGE_MAX}자 이하로 작성해 주세요.`,
      { status: 400 }
    );

  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("세션 없음", { status: 404 });

  const [candidate] = await db
    .select({ id: candidates.id, orgId: candidates.orgId })
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  // 후보자/법인 컨텍스트는 best-effort — 폐기됐어도 신고는 받는다.
  const orgId = candidate?.orgId ?? null;

  let orgName: string | null = null;
  if (orgId) {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    orgName = org?.name ?? null;
  }

  await db.insert(inquiries).values({
    source: "candidate",
    category,
    message,
    contactEmail: email,
    orgId,
    interviewSessionId: session.id,
    candidateId: candidate?.id ?? null,
    ip: extractIp(req),
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  });

  logAudit(req, {
    actorRole: "candidate",
    action: "inquiry.submit",
    resourceType: "interview_session",
    resourceId: session.id,
    orgId,
    metadata: { category, message_length: message.length },
  });

  // after() — 응답 반환 후 실행 보장. void fire-and-forget 은 서버리스 suspend 로 유실됨.
  after(() =>
    notifyNewInquiry({
      source: "candidate",
      category,
      message,
      contactEmail: email,
      orgName,
      orgId,
    }).catch((e) => console.error("[inquiry] 접수 통지 실패:", e))
  );

  return Response.json({ ok: true });
}

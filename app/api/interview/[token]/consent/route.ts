/**
 * 후보자 동의 기록. 면접 시작 전 호출.
 *
 * POST body: { consents: { collection_use: true, ai_decision: true, ... } }
 *
 * 모든 필수 항목 true 여야 200. 부족하면 400 + missing[].
 * 인증: 토큰만 (후보자는 비로그인). 토큰 자체가 인증 수단.
 */
import { db } from "@/lib/db";
import { interviewSessions, consentLogs } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import {
  CONSENT_VERSION,
  validateConsents,
} from "@/lib/consent";
import { extractIp } from "@/lib/auth-attempts";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // 동의 spam 방지 — IP 분당 10회
  const limited = await rateLimit(req, "consent", {
    limit: 10,
    windowSec: 60,
  });
  if (limited) return limited;

  const { token } = await params;
  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("세션 없음", { status: 404 });
  if (new Date(session.expiresAt) < new Date())
    return new Response("만료된 세션입니다.", { status: 410 });
  if (session.status === "completed" || session.status === "expired")
    return new Response("이미 종료된 세션입니다.", { status: 409 });

  const body = (await req.json().catch(() => null)) as {
    consents?: Record<string, unknown>;
  } | null;
  if (!body?.consents)
    return new Response("동의 항목이 누락되었습니다.", { status: 400 });

  const v = validateConsents(body.consents);
  if (!v.ok) {
    return Response.json(
      {
        error: "필수 동의 항목이 누락되었습니다.",
        code: "consent_missing",
        missing: v.missing,
      },
      { status: 400 }
    );
  }

  // boolean 으로 정제 (다른 타입 거름)
  const cleaned: Record<string, boolean> = {};
  for (const [k, v2] of Object.entries(body.consents)) {
    cleaned[k] = v2 === true;
  }

  // M11 — 같은 세션·동의버전의 동의 로그가 이미 있으면 중복 INSERT 방지 (멱등).
  // 후보자가 새로고침·재시도해도 감사 로그는 1행만 유지. 재제출도 차단된 결과로 표시.
  const [existing] = await db
    .select({ id: consentLogs.id })
    .from(consentLogs)
    .where(
      and(
        eq(consentLogs.interviewSessionId, session.id),
        eq(consentLogs.consentVersion, CONSENT_VERSION)
      )
    )
    .limit(1);
  if (existing) {
    return Response.json({
      ok: true,
      consentVersion: CONSENT_VERSION,
      alreadyRecorded: true,
    });
  }

  await db.insert(consentLogs).values({
    interviewSessionId: session.id,
    candidateId: session.candidateId,
    consentVersion: CONSENT_VERSION,
    consents: cleaned,
    ip: extractIp(req),
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  });

  return Response.json({ ok: true, consentVersion: CONSENT_VERSION });
}

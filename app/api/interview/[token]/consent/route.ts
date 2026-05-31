/**
 * 후보자 동의 기록. 면접 시작 전 호출.
 *
 * POST body: { consents: { collection_use: true, ai_decision: true, ... } }
 *
 * 모든 필수 항목 true 여야 200. 부족하면 400 + missing[].
 * 인증: 토큰만 (후보자는 비로그인). 토큰 자체가 인증 수단.
 *
 * 토큰 차감: 지원자가 동의하고 면접을 실제 시작하는 이 시점에 interview 1건 과금.
 *   (면접 링크 생성·발송 시점이 아님 — 보내고도 응하지 않은 링크는 무료.)
 *   refType/refId = interview_session/session.id → complete 의 평가실패 자동환불과 짝.
 *   chargeFeature 는 (orgId,feature,refType,refId) 멱등 — 새로고침·재동의 시 중복 차감 X.
 */
import { db } from "@/lib/db";
import { interviewSessions, consentLogs, candidates } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import {
  CONSENT_VERSION,
  validateConsents,
} from "@/lib/consent";
import { extractIp } from "@/lib/auth-attempts";
import { rateLimit } from "@/lib/rate-limit";
import { chargeFeature } from "@/lib/tokens";

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
    email?: string;
  } | null;
  if (!body?.consents)
    return new Response("동의 항목이 누락되었습니다.", { status: 400 });

  // H5 — 토큰 URL 만 알고 있는 제3자 차단: 본인 이메일 입력 검증.
  // 후보자 컬럼에 email 이 등록된 경우만 적용 (legacy 후보자 면제).
  const [candidate] = await db
    .select({
      email: candidates.email,
      outcome: candidates.outcome,
      orgId: candidates.orgId,
    })
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  // 지원취소·종결된 후보는 동의 제출 불가 (스케쥴 지원취소는 세션을 expired 로
  // 바꾸지 않으므로 outcome 으로 별도 차단).
  if (candidate?.outcome)
    return new Response("이미 종결된 지원입니다.", { status: 410 });
  if (candidate?.email) {
    const provided = (body.email ?? "").trim().toLowerCase();
    const expected = candidate.email.trim().toLowerCase();
    if (!provided) {
      return Response.json(
        {
          error: "본인 확인을 위해 지원 시 등록한 이메일을 입력해 주세요.",
          code: "email_required",
        },
        { status: 400 }
      );
    }
    if (provided !== expected) {
      return Response.json(
        {
          error:
            "입력하신 이메일이 지원 시 등록한 이메일과 일치하지 않습니다. 이메일을 확인하거나 채용 담당자에게 문의해 주세요.",
          code: "email_mismatch",
        },
        { status: 403 }
      );
    }
  }

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

  // 토큰 차감 — 지원자가 동의하고 면접을 실제 시작하는 시점에 과금 (링크 생성 시 아님).
  // 멱등 (orgId,interview,interview_session,session.id) — 재동의·새로고침 시 중복 차감 X.
  // 후불제: 잔액 부족해도 차감(음수 허용) 후 진행 — 지원자를 막지 않고 법인에 부족 알림.
  if (candidate?.orgId) {
    await chargeFeature({
      orgId: candidate.orgId,
      feature: "interview",
      refType: "interview_session",
      refId: session.id,
      memo: "AI 면접 시작 (지원자 동의)",
    });
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

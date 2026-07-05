/**
 * 후보자 동의 기록. 면접 시작 전 호출.
 *
 * POST body: { consents: { collection_use: true, ai_decision: true, ... } }
 *
 * 모든 필수 항목 true 여야 200. 부족하면 400 + missing[].
 * 인증: 토큰만 (후보자는 비로그인). 토큰 자체가 인증 수단.
 *
 * 토큰 과금: 면접은 후차감(서류평가와 동일 모델). 동의·시작 시점엔 과금하지 않고,
 *   complete(또는 reevaluate)에서 면접 진행+평가가 성공적으로 끝난 시점에만 interview 1건 차감.
 *   (평가 실패·면접 미응답·미시작 만료는 과금 없음 → 별도 환불 로직 불필요.)
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
  // 본인확인 게이트(D-1 백스톱) — 등록 이메일이 없으면 토큰만으로 본인을 확인할 수 없으므로 거부.
  // (정상 흐름에선 interview-link 발급 단계에서 이미 이메일을 요구하지만, legacy/직접 발급 등으로
  //  무이메일 후보가 도달할 수 있어 동의 시점에도 fail-safe 로 막는다 — me/withdraw/appeal 과 일관.)
  // 후보자는 스스로 이메일을 고칠 수 없으므로 메시지는 "채용 담당자 문의" 로 안내한다.
  if (!candidate?.email) {
    return Response.json(
      {
        error:
          "본인 확인을 진행할 수 없습니다 (등록된 이메일이 없습니다). 채용 담당자에게 문의해 주세요.",
        code: "email_required",
      },
      { status: 403 }
    );
  }
  {
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

  // 면접 과금은 후차감 — 여기(동의/시작)서는 과금하지 않는다. complete 에서 평가 성공 시 1건 차감.

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
        eq(consentLogs.candidateId, session.candidateId),
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

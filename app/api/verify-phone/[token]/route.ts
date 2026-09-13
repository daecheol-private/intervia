/**
 * 면접 일정 알림톡 번호 확인 — 공개(토큰 인증). 확인 페이지(/verify/phone/[token])의 버튼이 호출.
 * action: "confirm" → verified(확인 시각·IP·UA 기록) / "decline" → 번호 삭제.
 */
import { rateLimit } from "@/lib/rate-limit";
import { extractIp } from "@/lib/auth-attempts";
import { logAudit } from "@/lib/audit";
import { confirmPhoneByToken, declinePhoneByToken } from "@/lib/notify-phone";

export const runtime = "nodejs";

const notFound = () =>
  Response.json(
    { code: "not_found", message: "유효하지 않은 링크입니다." },
    { status: 404 }
  );

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await rateLimit(req, "verify-phone", { limit: 10, windowSec: 60 });
  if (limited) return limited;

  const { token } = await params;
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;

  if (body?.action === "decline") {
    if (!(await declinePhoneByToken(token))) return notFound();
    logAudit(req, {
      actorRole: "anonymous",
      action: "notify_phone.decline",
      resourceType: "notify_phone",
    });
    return Response.json({ ok: true, declined: true });
  }
  if (body?.action !== "confirm")
    return new Response("action 은 confirm 또는 decline 이어야 합니다.", { status: 400 });

  const r = await confirmPhoneByToken(token, {
    ip: extractIp(req),
    ua: req.headers.get("user-agent"),
  });
  if (!r.ok)
    return r.code === "expired"
      ? Response.json(
          {
            code: "expired",
            message: "확인 기한이 지났습니다. 채용 담당자에게 다시 요청해 주세요.",
          },
          { status: 410 }
        )
      : notFound();

  logAudit(req, {
    actorRole: "anonymous",
    action: "notify_phone.verify",
    resourceType: "notify_phone",
    metadata: { alreadyVerified: r.alreadyVerified },
  });
  return Response.json({ ok: true, alreadyVerified: r.alreadyVerified });
}

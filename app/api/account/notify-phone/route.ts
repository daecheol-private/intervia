/**
 * 내 면접 일정 알림톡 번호 — 조회·등록(변경)·확인 카톡 재발송·삭제.
 * 등록하면 그 번호로 "번호 확인" 알림톡이 가고, 본인이 확인해야 알림이 켜진다(lib/notify-phone).
 * 템플릿 코드가 들어오기 전(isStaffAlimtalkEnabled false)에는 등록을 받지 않고 화면도 숨긴다.
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { isStaffAlimtalkEnabled } from "@/lib/alimtalk";
import {
  STAFF_ALIMTALK_NOT_READY,
  getPhoneStatus,
  removePhone,
  requestPhoneVerification,
  resendPhoneVerification,
} from "@/lib/notify-phone";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;
  return Response.json({
    enabled: isStaffAlimtalkEnabled(),
    notifyPhone: await getPhoneStatus({ userId: me!.id }),
  });
}

/** body: { phone } 등록·변경 / { resend: true } 등록된 번호로 확인 카톡 재발송 */
export async function PUT(req: Request) {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;
  if (!me!.orgId)
    return new Response("법인에 소속된 계정만 등록할 수 있습니다.", { status: 400 });
  if (!isStaffAlimtalkEnabled())
    return new Response(STAFF_ALIMTALK_NOT_READY, { status: 409 });

  // 확인 알림톡은 건당 과금 + 잘못 적은 남의 번호로 반복 발송될 수 있어 사용자당 10분 5회.
  const limited = await rateLimit(
    req,
    "notify-phone",
    { limit: 5, windowSec: 600 },
    me!.id
  );
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    phone?: unknown;
    resend?: unknown;
  } | null;

  let r;
  if (body?.resend === true) {
    r = await resendPhoneVerification({ userId: me!.id }, me!.id);
  } else {
    if (typeof body?.phone !== "string")
      return new Response("휴대폰 번호를 입력해 주세요.", { status: 400 });
    r = await requestPhoneVerification({
      owner: { userId: me!.id },
      orgId: me!.orgId,
      name: me!.name,
      phone: body.phone,
      requestedByUserId: me!.id,
      force: true,
    });
  }
  if (!r.ok) return new Response(r.error, { status: 400 });

  logAudit(req, {
    actor: me!,
    action: "notify_phone.set",
    resourceType: "user",
    resourceId: me!.id,
    orgId: me!.orgId,
    metadata: { status: r.status, sent: r.sent, resend: body?.resend === true },
  });
  return Response.json({
    ok: true,
    sent: r.sent,
    reason: r.reason ?? null,
    notifyPhone: await getPhoneStatus({ userId: me!.id }),
  });
}

export async function DELETE(req: Request) {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;
  await removePhone({ userId: me!.id });
  logAudit(req, {
    actor: me!,
    action: "notify_phone.remove",
    resourceType: "user",
    resourceId: me!.id,
    orgId: me!.orgId,
  });
  return Response.json({ ok: true });
}

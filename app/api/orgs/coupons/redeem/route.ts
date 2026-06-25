import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { redeemCoupon, REDEEM_ERROR_MESSAGE } from "@/lib/coupons";

export const runtime = "nodejs";

/** 쿠폰 등록 — 법인 관리자 전용. 무차별 대입 방지 위해 rate-limit. */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  // 법인 관리자만 — 멤버는 등록 불가.
  if (me!.role !== "org_admin")
    return new Response("법인 관리자만 쿠폰을 등록할 수 있습니다.", {
      status: 403,
    });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;
  if (!me!.orgId) return new Response("소속 법인이 없습니다.", { status: 400 });

  // 코드 추측 방지 — 10분당 10회.
  const limited = await rateLimit(
    req,
    "coupon_redeem",
    { limit: 10, windowSec: 600 },
    me!.id
  );
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { code?: string };
  if (typeof body.code !== "string" || !body.code.trim())
    return new Response("쿠폰 코드를 입력해 주세요.", { status: 400 });

  const result = await redeemCoupon({
    orgId: me!.orgId,
    code: body.code,
    userId: me!.id,
  });

  if (!result.ok) {
    return Response.json(
      { error: REDEEM_ERROR_MESSAGE[result.code], code: result.code },
      { status: 400 }
    );
  }

  logAudit(req, {
    actor: me,
    action: "coupon.redeem",
    resourceType: "organization",
    resourceId: me!.orgId,
    orgId: me!.orgId,
    metadata: { groupName: result.groupName, granted: result.granted },
  });

  return Response.json({
    granted: result.granted,
    balance: result.balance,
    groupName: result.groupName,
  });
}

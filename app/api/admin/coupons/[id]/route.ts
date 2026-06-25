import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import {
  getCouponGroupDetail,
  disableCouponGroup,
  formatCouponCode,
} from "@/lib/coupons";

export const runtime = "nodejs";

/** 쿠폰 그룹 상세 — 코드 목록 + 사용 법인 (시스템 관리자). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });

  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId))
    return new Response("잘못된 ID", { status: 400 });

  const { group, codes } = await getCouponGroupDetail(groupId);
  if (!group) return new Response("그룹 없음", { status: 404 });

  return Response.json({
    group,
    codes: codes.map((c) => ({ ...c, display: formatCouponCode(c.code) })),
  });
}

/** 그룹 비활성화 (시스템 관리자). 이미 등록된 코드·지급 토큰엔 영향 없음. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });

  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId))
    return new Response("잘못된 ID", { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "disable")
    return new Response("지원하지 않는 작업입니다.", { status: 400 });

  const ok = await disableCouponGroup(groupId);
  if (!ok) return new Response("그룹 없음", { status: 404 });

  logAudit(req, {
    actor: me,
    action: "coupon.disable",
    resourceType: "coupon_group",
    resourceId: groupId,
  });

  return Response.json({ ok: true });
}

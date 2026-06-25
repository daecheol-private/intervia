import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { logAudit } from "@/lib/audit";
import {
  createCouponGroup,
  listCouponGroups,
  MAX_COUPON_COUNT,
  MAX_COUPON_TOKENS,
} from "@/lib/coupons";

export const runtime = "nodejs";

/** 쿠폰 그룹 목록 + 사용 통계 (시스템 관리자). */
export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });

  const groups = await listCouponGroups();
  return Response.json({ groups });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 쿠폰 그룹 + 코드 일괄 생성 (시스템 관리자 + step-up). */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  // 토큰 가치를 발행하는 행위 — grant-tokens 와 동일하게 재인증 요구.
  const stepUpGuard = await requireStepUp();
  if (stepUpGuard) return stepUpGuard;

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    tokenAmount?: number;
    count?: number;
    validFrom?: string | null;
    validUntil?: string | null;
  };

  const name = (body.name ?? "").trim();
  if (!name) return new Response("그룹 이름이 필요합니다.", { status: 400 });
  if (name.length > 100)
    return new Response("그룹 이름이 너무 깁니다.", { status: 400 });

  if (
    !Number.isSafeInteger(body.tokenAmount) ||
    body.tokenAmount! <= 0 ||
    body.tokenAmount! > MAX_COUPON_TOKENS
  )
    return new Response(
      `토큰 수는 1 이상 ${MAX_COUPON_TOKENS.toLocaleString()} 이하의 정수여야 합니다.`,
      { status: 400 }
    );

  if (
    !Number.isSafeInteger(body.count) ||
    body.count! <= 0 ||
    body.count! > MAX_COUPON_COUNT
  )
    return new Response(
      `생성 개수는 1 이상 ${MAX_COUPON_COUNT.toLocaleString()} 이하의 정수여야 합니다.`,
      { status: 400 }
    );

  const validFrom = body.validFrom?.trim() || null;
  const validUntil = body.validUntil?.trim() || null;
  if (validFrom && !DATE_RE.test(validFrom))
    return new Response("시작일 형식이 올바르지 않습니다 (YYYY-MM-DD).", {
      status: 400,
    });
  if (validUntil && !DATE_RE.test(validUntil))
    return new Response("종료일 형식이 올바르지 않습니다 (YYYY-MM-DD).", {
      status: 400,
    });
  if (validFrom && validUntil && validFrom > validUntil)
    return new Response("종료일이 시작일보다 빠릅니다.", { status: 400 });

  const { groupId, created } = await createCouponGroup({
    name,
    tokenAmount: body.tokenAmount!,
    count: body.count!,
    validFrom,
    validUntil,
    createdByUserId: me!.id,
  });

  logAudit(req, {
    actor: me,
    action: "coupon.create",
    resourceType: "coupon_group",
    resourceId: groupId,
    metadata: {
      name,
      tokenAmount: body.tokenAmount,
      count: created,
      validFrom,
      validUntil,
    },
  });

  return Response.json({ groupId, created });
}

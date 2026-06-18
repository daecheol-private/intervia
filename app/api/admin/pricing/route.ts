import { db } from "@/lib/db";
import { tokenPricing } from "@/lib/schema";
import { sql, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { getAllPricing } from "@/lib/tokens";

export const runtime = "nodejs";

const ALLOWED = [
  "job_post",
  "resume_upload",
  "interview",
  "interview_question_gen",
  "offline_interview",
] as const;
type Key = (typeof ALLOWED)[number];

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  // 단가 조회는 모든 로그인 사용자 허용 (가격 표시용)
  return Response.json(await getAllPricing());
}

export async function PATCH(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const body = (await req.json().catch(() => ({}))) as Partial<Record<Key, number>>;

  // 상한 — 거대값으로 전 법인 지갑을 일괄 음수화하는 입력(내부자/계정 탈취) 차단.
  const MAX_COST = 1_000_000;
  for (const k of ALLOWED) {
    const v = body[k];
    if (v == null) continue;
    if (!Number.isSafeInteger(v) || v < 0 || v > MAX_COST)
      return new Response(`${k}: 0~${MAX_COST.toLocaleString()} 정수 필요`, {
        status: 400,
      });
    await db
      .insert(tokenPricing)
      .values({
        featureKey: k,
        cost: v,
        updatedByUserId: me!.id,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: tokenPricing.featureKey,
        set: {
          cost: v,
          updatedByUserId: me!.id,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  }

  return Response.json(await getAllPricing());
}

void eq;

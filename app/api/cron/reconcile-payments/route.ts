import { reconcilePendingPayments } from "@/lib/payment-reconcile";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
// 주문당 토스 조회 1회 — 배치 50건 상한이라도 외부호출 대기 여유.
export const maxDuration = 120;

/**
 * 결제 미아(stale pending) 자가치유. Vercel Cron(15분) 또는 system_admin 수동 호출.
 * 인증: Authorization: Bearer ${CRON_SECRET} 헤더 또는 로그인된 system_admin.
 * TOSS_SECRET_KEY 미설정(결제 미연동)이면 reconcile 가 즉시 configured:false 로 빠진다.
 */
async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return null;
  if (req.headers.get("x-vercel-cron") === "1" && !secret) return null;

  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  const result = await reconcilePendingPayments();
  return Response.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  return GET(req);
}

import { reconcilePendingPayments } from "@/lib/payment-reconcile";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
// 주문당 토스 조회 1회 — 배치 50건 상한이라도 외부호출 대기 여유.
export const maxDuration = 120;

/**
 * 결제 미아(stale pending) 자가치유. Vercel Cron(15분) 또는 system_admin 수동 호출.
 * 인증: Authorization: Bearer ${CRON_SECRET} 헤더 또는 로그인된 system_admin.
 * TOSS_SECRET_KEY 미설정(결제 미연동)이면 reconcile 가 즉시 configured:false 로 빠진다.
 */
function authorize(req: Request): Promise<Response | null> {
  return authorizeCron(req, "cron");
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

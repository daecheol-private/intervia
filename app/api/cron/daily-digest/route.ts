import { sendDailyDigests } from "@/lib/daily-digest";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
// 면접관 수만큼 순차 발송(페이싱 ~2/s) — 대상이 몰려도 여유 있게.
export const maxDuration = 120;

/**
 * 매일 KST 09:00(UTC 00:00) 호출. Vercel Cron 또는 system_admin 수동 호출.
 * 인증: Authorization: Bearer ${CRON_SECRET} 헤더 또는 로그인된 system_admin.
 */
function authorize(req: Request): Promise<Response | null> {
  return authorizeCron(req, "cron");
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  const result = await sendDailyDigests();
  return Response.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  return GET(req);
}

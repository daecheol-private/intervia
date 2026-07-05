import { sendDailyDigests } from "@/lib/daily-digest";
import { getCurrentUser } from "@/lib/auth";
import { secretEquals } from "@/lib/secret-compare";

export const runtime = "nodejs";
// 면접관 수만큼 순차 발송(페이싱 ~2/s) — 대상이 몰려도 여유 있게.
export const maxDuration = 120;

/**
 * 매일 KST 09:00(UTC 00:00) 호출. Vercel Cron 또는 system_admin 수동 호출.
 * 인증: Authorization: Bearer ${CRON_SECRET} 헤더 또는 로그인된 system_admin.
 */
async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && secretEquals(header, `Bearer ${secret}`)) return null;
  if (req.headers.get("x-vercel-cron") === "1" && !secret) return null;

  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
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

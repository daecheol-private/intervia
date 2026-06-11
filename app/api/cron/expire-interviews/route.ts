import { expireInterviewSessions } from "@/lib/expire-sessions";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
// 만료 처리 + 자동불합격 통보 메일(페이싱 2/s) — 공고 일괄 만료처럼 대상이 몰린 시간대 대비.
export const maxDuration = 120;

/**
 * 매 시간 호출. Vercel Cron 또는 system_admin 수동 호출.
 * 인증: Authorization: Bearer ${CRON_SECRET} 헤더 또는 로그인된 system_admin.
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
  const result = await expireInterviewSessions();
  return Response.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  return GET(req);
}

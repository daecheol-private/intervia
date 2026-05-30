import { sendInterviewerReminders } from "@/lib/interview-reminders";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * 매 시간 호출. Vercel Cron 또는 system_admin 수동 호출.
 * 확정 면접 24시간 전 면접관에게 리마인더 메일을 1회 발송.
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
  const result = await sendInterviewerReminders();
  return Response.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  return GET(req);
}

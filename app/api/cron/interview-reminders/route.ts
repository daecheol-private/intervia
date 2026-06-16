import {
  sendScheduleReminders,
  sendAiInterviewReminders,
} from "@/lib/interview-reminders";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
// 리마인더 메일 발송(페이싱 2/s) — 같은 시간대 면접이 몰린 날 대비.
export const maxDuration = 120;

/**
 * 매 시간 호출. Vercel Cron 또는 system_admin 수동 호출.
 *  - 확정 대면 면접 D-1(24h 전): 면접관 + 후보자에게 1회씩
 *  - AI 면접 미응답: 링크 발급 후 24h / 48h 경과 시 후보자에게 넛지
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
  const schedule = await sendScheduleReminders();
  const ai = await sendAiInterviewReminders();
  return Response.json({ ok: true, schedule, ai });
}

export async function POST(req: Request) {
  return GET(req);
}

import {
  sendScheduleReminders,
  sendAiInterviewReminders,
} from "@/lib/interview-reminders";
import { authorizeCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
// 리마인더 메일 발송(페이싱 2/s) — 같은 시간대 면접이 몰린 날 대비.
export const maxDuration = 120;

/**
 * KST 09~20시 매시간 호출(vercel.json). Vercel Cron 또는 system_admin 수동 호출.
 *  - 확정 대면 면접 D-1(24h 전): 면접관 + 후보자에게 1회씩
 *  - AI 면접 미응답: 링크 발급 후 48h 경과 시 후보자에게 1회 넛지
 * 인증: Authorization: Bearer ${CRON_SECRET} 헤더 또는 로그인된 system_admin.
 */
function authorize(req: Request): Promise<Response | null> {
  return authorizeCron(req, "cron");
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

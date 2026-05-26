import { purgeExpiredOriginals } from "@/lib/purge-original";
import { cleanupOldAttempts } from "@/lib/auth-attempts";
import { cleanupOldRateLog } from "@/lib/rate-limit";
import { runLifecycleSweep } from "@/lib/job-lifecycle";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

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
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const days = daysParam ? Number(daysParam) : undefined;
  // 같은 일일 cron 에 끼워서 처리 — Vercel Hobby 2 cron 한도 대응
  const result = await purgeExpiredOriginals(days);
  const purgedAttempts = await cleanupOldAttempts();
  const purgedRateLog = await cleanupOldRateLog();
  const lifecycle = await runLifecycleSweep();
  return Response.json({
    ok: true,
    ...result,
    purgedAttempts,
    purgedRateLog,
    lifecycle,
  });
}

export async function POST(req: Request) {
  return GET(req);
}

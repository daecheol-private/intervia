import { purgeExpiredOriginals } from "@/lib/purge-original";
import { cleanupOldAttempts } from "@/lib/auth-attempts";
import { cleanupOldRateLog } from "@/lib/rate-limit";
import { runLifecycleSweep } from "@/lib/job-lifecycle";
import { expireInterviewSessions } from "@/lib/expire-sessions";
import { cleanupExpiredSessions, getCurrentUser } from "@/lib/auth";
import { secretEquals } from "@/lib/secret-compare";

export const runtime = "nodejs";

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
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const days = daysParam ? Number(daysParam) : undefined;
  // 같은 일일 cron 에 끼워서 처리 — Vercel Hobby 2 cron 한도 대응
  const result = await purgeExpiredOriginals(days);
  const purgedAttempts = await cleanupOldAttempts();
  const purgedRateLog = await cleanupOldRateLog();
  const purgedSessions = await cleanupExpiredSessions();
  const lifecycle = await runLifecycleSweep();
  // 만료 처리 안전망 — expire-interviews 는 외부 cron(cron-job.org, 매시간)에 의존한다.
  // 그 등록이 누락/실패하면 만료 세션 자동불합격·만료 PII 폐기가 영원히 안 돈다. 멱등(이미
  // expired/outcome 설정분은 스킵)이라 일일 cron 에도 끼워 단일 실패점을 제거한다.
  const expiry = await expireInterviewSessions();
  return Response.json({
    ok: true,
    ...result,
    purgedAttempts,
    purgedRateLog,
    purgedSessions,
    lifecycle,
    expiry,
  });
}

export async function POST(req: Request) {
  return GET(req);
}

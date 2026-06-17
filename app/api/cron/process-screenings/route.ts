import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 분당 한 번 워커를 깨우는 안전망.
 * 평소엔 enqueue 직후 self-chain 으로 워커가 돌지만, Vercel 함수가 죽으면 끊김.
 * cron 이 1분마다 트리거해서 stuck job 복구 + 남은 queued 처리.
 */
async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return null;
  // 시크릿 미설정 시에만 Vercel cron 헤더 허용. 운영(시크릿 설정)에선 헤더 위조 우회 차단.
  if (req.headers.get("x-vercel-cron") === "1" && !secret) return null;
  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  // 대면 면접 녹음(업로드 모드) 워커 안전망 — 별도 cron 추가 없이 같은 매분 틱에 끼워
  // 트리거(fire-and-forget). stuck 복구 + 남은 queued 처리. self-chain 으로 이어짐.
  void fetch(`${base}/api/internal/process-recorded-interviews`, {
    method: "POST",
    headers: { "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "" },
  }).catch(() => {});

  const res = await fetch(`${base}/api/internal/process-screenings`, {
    method: "POST",
    headers: {
      "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "",
    },
  });
  const data = await res.json().catch(() => ({}));
  return Response.json({ ok: res.ok, ...data });
}

export async function POST(req: Request) {
  return GET(req);
}

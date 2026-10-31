import { authorizeCron } from "@/lib/cron-auth";
import { drainQueuedDecisions } from "@/lib/decision-drain";

export const runtime = "nodejs";

/**
 * 불합격 통보 저녁 드레인 cron. 권장 주기: 매일 18:00 KST (vercel.json `0 9 * * *` = 09:00 UTC).
 *
 * 대량 종결(closeJob)이 낮 소프트캡을 넘겨 즉시 못 보낸 불합격 통보를 일일 발송 예산 범위에서
 * 발송한다. 예산 초과분은 큐에 남아 다음 날 재처리 — 발신 서버 일일 한도를 넘지 않게 며칠에
 * 걸쳐 자동 분산. 예산·소프트캡은 env 로 조정. 상세: lib/decision-drain.ts.
 */
function authorize(req: Request): Promise<Response | null> {
  return authorizeCron(req, "cron");
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  const result = await drainQueuedDecisions();
  return Response.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  return GET(req);
}

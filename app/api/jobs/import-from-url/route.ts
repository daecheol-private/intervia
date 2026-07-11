import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { importJobFromUrl } from "@/lib/job-url-import";
import { newErrorRef } from "@/lib/error-ref";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const limited = await rateLimit(
    req,
    "job-url-import",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const url = body?.url?.trim();
  if (!url) return new Response("url 필수", { status: 400 });
  if (!/^https?:\/\//i.test(url))
    return new Response("올바른 URL이 아닙니다.", { status: 400 });

  try {
    const result = await importJobFromUrl(url);
    return Response.json(result);
  } catch (e) {
    // 원인 메시지(SSRF 차단·추출 실패 등)는 그대로 두고 오류 코드만 덧붙임 —
    // 고객센터 문의 시 코드로 로그 역추적.
    const ref = newErrorRef();
    const msg = e instanceof Error ? e.message : String(e);
    log.error("job_import_failed", { ref, url, error: msg.slice(0, 300) });
    return new Response(`${msg} (오류 코드: ${ref})`, { status: 502 });
  }
}

import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { importJobFromUrl } from "@/lib/job-url-import";

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
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 502 });
  }
}

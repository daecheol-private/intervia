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
    // undici fetch 는 진짜 원인(ECONNRESET 등)을 e.cause 에 감춘다 — 역추적용으로 함께 로깅.
    const causeRaw = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
    const cause =
      causeRaw instanceof Error
        ? `${causeRaw.message}${"code" in causeRaw && causeRaw.code ? ` [${String(causeRaw.code)}]` : ""}`
        : causeRaw != null
          ? String(causeRaw)
          : undefined;
    log.error("job_import_failed", {
      ref,
      url,
      error: msg.slice(0, 300),
      cause: cause?.slice(0, 300),
    });
    // 네트워크 단계 실패 = 대부분 채용 사이트의 데이터센터 IP 차단(사람인 실측) —
    // 기술 문구 대신 고객이 취할 수 있는 다음 행동을 안내.
    const userMsg = msg.startsWith("fetch failed")
      ? "해당 채용 사이트가 자동 수집을 차단하고 있어 공고를 불러오지 못했습니다. 공고 본문을 복사해 아래 항목에 직접 붙여넣어 주세요."
      : msg;
    // 명확한 원인 코드(ECONNRESET 등)가 있으면 화면에도 함께 — 문의 없이도 원인 구분 가능.
    const causeCode =
      causeRaw instanceof Error && "code" in causeRaw && causeRaw.code
        ? String(causeRaw.code)
        : undefined;
    return new Response(
      `${userMsg} (오류 코드: ${ref}${causeCode ? ` · 원인: ${causeCode}` : ""})`,
      { status: 502 }
    );
  }
}

import { searchDartCorps } from "@/lib/dart-corps";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // 비로그인 공개 엔드포인트 — DART 공개 법인 목록 대량 스크래핑/DoS 차단(형제 orgs/search 와 동일).
  // 가입 폼의 200ms 디바운스 자동완성이라 정상 사용자는 분당 40건에 도달하지 않는다. IP 기준.
  const limited = await rateLimit(req, "dart-search", {
    limit: 40,
    windowSec: 60,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const results = searchDartCorps(q, 8);
  return Response.json({ results });
}

/**
 * CSP 위반 보고 수신 (Content-Security-Policy-Report-Only 의 report-uri).
 * script-src 를 강제하기 전 1~2주 관찰용 — 막혔을 스크립트 출처를 로그로 모은다.
 * /api/health* 는 proxy matcher 제외 경로라 로그인·CSRF 검사 없이 브라우저 보고를 받는다.
 * 경로 쿼리(토큰 포함 가능)는 남기지 않고 호스트·경로·지시어만 기록.
 */
import { log } from "@/lib/logger";

export const runtime = "nodejs";

function hostOf(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  if (!u.includes("://")) return u.slice(0, 40); // inline / eval / self 등 키워드
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}

function pathOf(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    // 토큰이 경로에 들어가는 화면이 있어 첫 세그먼트만
    return "/" + (new URL(u).pathname.split("/")[1] ?? "");
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const text = (await req.text().catch(() => "")).slice(0, 8000);
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const r = (body["csp-report"] ?? body) as Record<string, unknown>;
    log.warn("csp_violation", {
      directive: String(r["violated-directive"] ?? r["effective-directive"] ?? "").slice(0, 60),
      blocked: hostOf(r["blocked-uri"]),
      page: pathOf(r["document-uri"]),
    });
  } catch {
    /* 형식 불명 — 무시 */
  }
  return new Response(null, { status: 204 });
}

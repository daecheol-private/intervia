import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "session";

// CSRF 면제 경로 — 외부에서 호출되는 콜백/공개 엔드포인트.
//   * /api/interview/* : 후보자(비로그인) 면접 진행 — 토큰 자체가 인증
//   * /api/cron/*      : cron-job.org 등 외부 스케줄러 (Authorization 헤더로 검증)
//   * /api/uploads/*   : 공개 파일 다운로드 (서명 토큰)
//   * /api/orgs/*      : (도메인 자동매칭 확인 등 — 향후 외부 콜백 가능성)
const CSRF_EXEMPT_API_PREFIXES = [
  "/api/interview/",
  "/api/cron/",
  "/api/uploads/",
  "/api/schedule/",
];

// state-changing 메서드. GET/HEAD/OPTIONS 는 CSRF 검증 X.
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isCsrfExemptApi(pathname: string): boolean {
  return CSRF_EXEMPT_API_PREFIXES.some((p) => pathname.startsWith(p));
}

function checkCsrf(req: NextRequest): NextResponse | null {
  if (!UNSAFE_METHODS.has(req.method)) return null;
  // API 만 검증. (페이지 라우트는 React Server Action 등이 자체 처리)
  if (!req.nextUrl.pathname.startsWith("/api/")) return null;
  if (isCsrfExemptApi(req.nextUrl.pathname)) return null;

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host");
  if (!host) return new NextResponse("Bad Request", { status: 400 });

  // 정상 same-origin 요청은 Origin 또는 Referer 헤더에 자기 host 가 있어야 함.
  // (현대 브라우저는 fetch/XHR 시 항상 Origin 을 자동 설정)
  const expectedHost = host.toLowerCase();
  const allowedHosts = new Set<string>([expectedHost]);
  // 환경변수로 추가 허용 호스트 지정 가능 (다중 도메인 운영 시).
  const extra = process.env.ALLOWED_ORIGINS;
  if (extra) {
    for (const o of extra.split(",")) {
      try {
        allowedHosts.add(new URL(o.trim()).host.toLowerCase());
      } catch {
        // ignore malformed
      }
    }
  }

  const checkHost = (h: string | null): boolean => {
    if (!h) return false;
    try {
      return allowedHosts.has(new URL(h).host.toLowerCase());
    } catch {
      return false;
    }
  };

  if (origin && checkHost(origin)) return null;
  if (!origin && referer && checkHost(referer)) return null;

  return new NextResponse(
    JSON.stringify({
      error: "Origin 검증 실패",
      code: "csrf_blocked",
    }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

export function proxy(req: NextRequest) {
  // CSRF 검증을 먼저 — 인증된 세션이어도 cross-origin POST 는 차단
  const csrfBlock = checkCsrf(req);
  if (csrfBlock) return csrfBlock;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = req.nextUrl;

  // 인증 가드 면제: 공개 페이지 + 공개 API
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/password-reset" ||
    pathname.startsWith("/legal/") ||
    pathname.startsWith("/preview/") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/schedule/") ||
    pathname.startsWith("/unsubscribe/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/orgs" ||
    pathname.startsWith("/api/orgs/") ||
    pathname.startsWith("/api/invites/") ||
    pathname.startsWith("/api/schedule/")
  )
    return NextResponse.next();

  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // 보호할 경로: 대시보드, 공고, 후보자, 관련 API
  // 공개: /login, /interview/*, /api/auth/*, /api/interview/*, /api/uploads/*, 정적 파일
  // 단 matcher 에 포함되어야 CSRF 검증도 동작 — api 전반은 포함되어야 함
  matcher: [
    // 인증 가드 대상 경로
    "/((?!login|signup|privacy|terms|legal|password-reset|verify|interview|invite|schedule|unsubscribe|preview|apply|api/apply|api/auth|api/interview|api/uploads|api/orgs|api/invites|api/schedule|api/cron|api/internal|api/health|_next/static|_next/image|favicon.ico).*)",
    // CSRF 검증을 위해 api/auth/* 도 매칭 (proxy 내부에서 인증 가드는 스킵)
    "/api/auth/:path*",
    "/api/orgs/:path*",
  ],
};

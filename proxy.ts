import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { subdomainFromHost, applyBaseOrigin } from "@/lib/subdomain";

const SESSION_COOKIE = "session";
// 슬라이딩 세션 TTL(초) — lib/auth.ts SESSION_TTL_HOURS 와 동기화. (idle 6시간)
const SESSION_TTL_SEC = 6 * 60 * 60;

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
  // 법인 서브도메인({sub}.intervia.kr)은 공개 지원 페이지 전용 — /apply·/api/apply·
  // 정적 자산은 matcher 에서 제외돼 여기 안 오므로, 매칭된 나머지 경로(로그인·대시보드
  // ·기타 API)는 전부 본 사이트로 돌려보낸다. 세션·인증 플로우는 apex 에서만.
  if (subdomainFromHost(req.headers.get("host"))) {
    // 3xx Location 은 Next 가 자기 호스트 대상일 때 상대경로로 재작성해
    // 현재 호스트 기준 self-redirect 루프가 된다(dev 실측, 수동 헤더도 동일).
    // 스트레이 경로 정리 목적이라 HTTP 리다이렉트 대신 meta refresh 로 우회 —
    // 정작 중요한 지원 페이지 정본 이동은 페이지의 redirect()가 담당한다.
    const { protocol, host } = applyBaseOrigin();
    const { pathname, search } = req.nextUrl;
    // 경로는 요청자 제어값 — HTML 인젝션 방지 이스케이프
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const target = esc(`${protocol}://${host}${pathname}${search}`);
    return new NextResponse(
      `<!doctype html><meta http-equiv="refresh" content="0;url=${target}"><p><a href="${target}">Intervia 로 이동</a></p>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  // CSRF 검증을 먼저 — 인증된 세션이어도 cross-origin POST 는 차단
  const csrfBlock = checkCsrf(req);
  if (csrfBlock) return csrfBlock;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = req.nextUrl;

  // 인증 가드 면제: 공개 페이지 + 공개 API
  if (
    pathname === "/" ||
    // 디자인 시스템 쇼케이스 — 개발 환경에서만 공개 (운영에선 page 가 notFound).
    (process.env.NODE_ENV !== "production" && pathname === "/design") ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/security" ||
    pathname === "/how-it-works" ||
    pathname === "/features" ||
    pathname === "/pricing" ||
    pathname === "/faq" ||
    pathname === "/resume-guide" ||
    pathname === "/zoom-guide" ||
    pathname === "/password-reset" ||
    pathname.startsWith("/legal/") ||
    pathname.startsWith("/invite/") ||
    pathname.startsWith("/schedule/") ||
    pathname.startsWith("/unsubscribe/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/client-error" ||
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

  // 슬라이딩 세션: 보호 경로를 통과할 때마다 쿠키 만료를 TTL 만큼 뒤로 민다.
  // RSC 에서는 쿠키 set 이 불가하므로 미들웨어가 쿠키 수명 연장을 담당하고,
  // DB 측 expiresAt 슬라이딩은 lib/auth.ts getCurrentUser 가 throttle 로 처리한다.
  // 실제 세션 유효성(만료/폐기)은 서버의 DB expiresAt 가 판정 — 여기선 쿠키 수명만 연장.
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}

export const config = {
  // 보호할 경로: 대시보드, 공고, 후보자, 관련 API
  // 공개: /login, /interview/*, /api/auth/*, /api/interview/*, /api/uploads/*, 정적 파일
  // 단 matcher 에 포함되어야 CSRF 검증도 동작 — api 전반은 포함되어야 함
  matcher: [
    // 인증 가드 대상 경로
    "/((?!login|signup|privacy|terms|security|how-it-works|features|resume-guide|zoom-guide|pricing|faq|legal|password-reset|verify|interview|invite|schedule|unsubscribe|apply|api/apply|api/auth|api/interview|api/uploads|api/orgs|api/invites|api/schedule|api/cron|api/internal|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|otf|eot)$).*)",
    // CSRF 검증을 위해 api/auth/* 도 매칭 (proxy 내부에서 인증 가드는 스킵)
    "/api/auth/:path*",
    "/api/orgs/:path*",
  ],
};

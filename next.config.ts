import type { NextConfig } from "next";

// 전역 보안 응답 헤더. 앱 동작에 영향 없는 안전 범위만 적용.
// (스크립트/스타일 CSP 는 inline 해시·nonce 검증이 필요해 별도 작업으로 분리 — 여기선
//  frame-ancestors + object-src/base-uri 처럼 정상 렌더에 영향 없는 지시어만.)
const securityHeaders = [
  // 클릭재킹 방어(frame-ancestors) + 플러그인 실행 차단(object-src) + <base> 태그 주입 차단(base-uri).
  // 세 지시어 모두 정상 앱 동작에 영향 없음. script-src/style-src 는 nonce 작업 후 별도 추가.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // MIME 스니핑 차단 (업로드/다운로드 라우트 보호).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // cross-origin 이동 시 경로(면접 토큰) 미노출 — origin 만 전송.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // camera·geolocation 차단. microphone 은 미지정(기본 self) — 면접 음성입력 유지.
  { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // 참고: Next 16 의 next build 는 ESLint 를 돌리지 않는다(빌트인 lint 통합 제거됨).
  // 그래서 react-hooks 가드는 vercel-build 에서 `eslint .` 로 별도 실행한다(package.json).
  experimental: {
    // 로컬 dev 의 FormData 직접 업로드 경로 본문 한도. 코드 측 MAX_FILE_SIZE / MAX_ZIP_SIZE (100MB) 와 맞춤.
    // 운영(Vercel) 은 NEXT_PUBLIC_BLOB_CLIENT_UPLOAD=1 로 Blob 직업로드 + manifest(JSON 작음) 경로라 무관.
    proxyClientMaxBodySize: "100mb",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

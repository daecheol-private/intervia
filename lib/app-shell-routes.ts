/**
 * 좌측 레일(AppShell)을 쓰는 영역인지 경로로 판정 — 전역 NavBar·Footer 가 공유한다.
 *
 * 로그인 상태에서 이 경로들은 좌측 레일 셸(AppShell)로 렌더되므로 전역 상단바(NavBar)와
 * 전역 푸터(Footer)를 숨겨 중복을 막는다. 비로그인(role=null)이면 공개 랜딩/리다이렉트
 * 대상이라 상단바·푸터를 그대로 둔다(호출부에서 로그인 여부를 함께 확인).
 *
 * 프리픽스를 추가할 때는 해당 경로에 AppShellLayout 을 재노출하는 layout.tsx 도 함께 둬야
 * 실제 셸이 렌더된다 — 짝을 맞추지 않으면 셸도 상단바도 없는 페이지가 된다.
 * (단 자체적으로 <AppShell> 을 직접 렌더하는 페이지 — "/", /interviews, /candidates 목록 —
 *  은 layout.tsx 없이도 셸이 나오므로 예외다.)
 */
const APP_SHELL_PREFIXES = [
  // 인증 영역 — 각 섹션의 layout.tsx(또는 페이지 자체)가 AppShell 을 렌더한다.
  "/candidates",
  "/interviews",
  "/insights",
  "/jobs",
  "/org",
  "/admin",
  "/account",
  "/notifications",
  "/support",
  // 공개 문서·가이드 — 로그인 상태에서도 좌측 레일을 유지해 페이지 이동 시 레이아웃이
  // 상단 헤더로 바뀌지 않게 한다(각 경로에 AppShellLayout 재노출 layout.tsx 존재).
  "/features",
  "/legal",
  "/how-it-works",
  "/pricing",
  "/faq",
  "/terms",
  "/privacy",
  "/security",
  "/resume-guide",
];

/** 주어진 경로가 좌측 레일 셸을 쓰는 영역이면 true. */
export function usesAppShell(pathname: string): boolean {
  if (pathname === "/") return true;
  return APP_SHELL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

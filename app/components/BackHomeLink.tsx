import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

/**
 * 공개 문서 페이지 상단 '← 홈' 링크 — 비로그인 방문자에게만 노출한다.
 *
 * 로그인 상태에선 이 페이지들이 좌측 레일 셸(AppShell) 안에서 열려 홈 이동을
 * 레일이 담당하므로, ←홈을 숨겨 인증 영역 페이지(공고·후보자 등)와 통일한다.
 * async server component 라 non-async 페이지에서도 자식으로 그대로 렌더하면 된다
 * (페이지를 async 로 바꿀 필요 없음).
 */
export async function BackHomeLink() {
  const user = await getCurrentUser();
  if (user) return null;
  return (
    <Link href="/" className="text-xs text-ink-muted hover:underline">
      ← 홈
    </Link>
  );
}

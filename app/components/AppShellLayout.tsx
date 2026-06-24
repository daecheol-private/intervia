import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "./AppShell";

/**
 * 인증 영역 공통 셸 레이아웃 — getCurrentUser 후 AppShell(좌측 레일)로 children 을 감싼다.
 * 각 인증 섹션(/org · /admin · /account · /notifications · /support · /jobs · /candidates)의
 * layout.tsx 가 이걸 default 로 재노출해 동일한 좌측 레일을 공유한다(셸 정의 단일화).
 * 미인증이면 셸 없이 children 만 — 페이지가 자체적으로 redirect/403 처리한다.
 * 셸을 쓰는 경로는 전역 NavBar/Footer 를 숨긴다(components/NavBar·Footer 의 usesAppShell 가드).
 */
export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) return <>{children}</>;

  // 좌측 레일 접힘 상태는 쿠키로 보관 — 서버에서 읽어 초기값으로 넘겨야
  // 섹션 간 이동(셸 리마운트) 시 펼침→접힘 깜빡임이 생기지 않는다.
  const jar = await cookies();
  const railCollapsed = jar.get("iv_rail_collapsed")?.value === "1";

  return (
    <AppShell
      userName={user.name}
      role={user.role}
      isAdmin={user.isAdmin}
      isDev={process.env.NODE_ENV !== "production"}
      defaultCollapsed={railCollapsed}
    >
      {children}
    </AppShell>
  );
}

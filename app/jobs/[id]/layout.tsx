import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/app/components/AppShell";

/**
 * 공고 상세(이력서 목록) 전용 셸 — 후보자 상세와 동일한 좌측 레일 네비를 적용한다.
 * 이 레이아웃은 /jobs/[id] 와 하위(edit·report·compare)를 모두 감싼다. 셸을 쓰는 동안
 * 전역 NavBar/Footer 는 /jobs/<숫자> 경로에서 숨긴다(중복 방지). report 인쇄 시 rail 은
 * AppShell 의 print:hidden 으로 빠진다.
 * user 가 없으면(미인증) 셸 없이 children 만 — 페이지가 API 403/redirect 로 자체 처리.
 */
export default async function JobDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) return <>{children}</>;

  return (
    <AppShell
      userName={user.name}
      role={user.role}
      isAdmin={user.isAdmin}
      isDev={process.env.NODE_ENV !== "production"}
    >
      {children}
    </AppShell>
  );
}

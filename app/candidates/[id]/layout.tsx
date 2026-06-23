import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/app/components/AppShell";

/**
 * 후보자 상세 전용 셸 — 인증 영역 좌측 레일 네비를 이 라우트에 점진 도입.
 * 셸이 적용되는 동안 전역 NavBar/Footer 는 /candidates/ 경로에서 숨긴다(중복 방지).
 * user 가 없으면(미인증) 셸 없이 children 만 — 페이지가 API 403 으로 자체 처리한다.
 */
export default async function CandidateDetailLayout({
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

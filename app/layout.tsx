import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { NavBar } from "./components/NavBar";
import { Footer } from "./components/Footer";
import { ForcePasswordChange } from "./components/ForcePasswordChange";
import { TourOverlay } from "./components/tour/TourOverlay";
import { TourAutoStart } from "./components/tour/TourAutoStart";
import { DialogHost } from "./components/Dialog";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intervia",
  description: "AI 채팅 면접 플랫폼",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // 시각 보조 사용자를 위한 확대 허용
  themeColor: "#1c3478", // brand primary (navy)
} as const;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
  // 안전장치 — MAIL_OVERRIDE_TO 가 운영 환경에 설정돼있으면 system_admin 에게 경고 배너.
  // 출시 직전 제거 망각 방지용. Preview 환경에서는 정상 설정이므로 배너 X.
  const overrideTo = process.env.MAIL_OVERRIDE_TO?.trim();
  const isProdEnv = process.env.VERCEL_ENV === "production";
  const showOverrideBanner =
    !!overrideTo && isProdEnv && user?.role === "system_admin";
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* 폰트 CDN 핸드셰이크 선행 — 렌더 블로킹 스타일시트의 DNS+TLS 왕복을 앞당겨 FCP 단축. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col bg-surface text-ink">
        {showOverrideBanner && (
          <div
            role="alert"
            className="bg-danger text-white text-xs sm:text-sm px-4 py-2 text-center font-medium"
          >
            ⚠️ <strong>MAIL_OVERRIDE_TO</strong> 활성 (운영) — 모든 후보자 메일이{" "}
            <strong>{overrideTo}</strong> 로 리다이렉트 중입니다. 실제 지원자에게는
            메일이 가지 않습니다. 출시 전 Vercel 환경변수에서 반드시 제거하세요.
          </div>
        )}
        <NavBar
          userName={user?.name ?? null}
          isAdmin={user?.isAdmin ?? false}
          role={user?.role ?? null}
          isDev={process.env.NODE_ENV !== "production"}
        />
        <div className="flex-1 flex flex-col">{children}</div>
        <Footer loggedIn={!!user} />
        {/* 페이지 진입 가이드 — 법인담당자·면접관 공통(system_admin 제외). */}
        {user && user.role !== "system_admin" && <TourOverlay />}
        {user && user.role !== "system_admin" && <TourAutoStart />}
        {user?.mustChangePassword && (
          <ForcePasswordChange email={user.email} />
        )}
        <DialogHost />
      </body>
    </html>
  );
}


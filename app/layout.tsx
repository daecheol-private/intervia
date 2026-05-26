import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { NavBar } from "./components/NavBar";
import { Footer } from "./components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intervia",
  description: "AI 채팅 면접 플랫폼",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // 시각 보조 사용자를 위한 확대 허용
  themeColor: "#0d4f3c", // brand primary (forest)
} as const;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col bg-surface text-ink">
        <NavBar
          userName={user?.name ?? null}
          isAdmin={user?.isAdmin ?? false}
          role={user?.role ?? null}
          isDev={process.env.NODE_ENV !== "production"}
        />
        <div className="flex-1 flex flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}


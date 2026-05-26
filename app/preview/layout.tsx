/**
 * 디자인 시안 미리보기 전용 레이아웃 — 기존 헤더/푸터 영향 받지 않도록 격리.
 */
export default function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.min.css"
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
      />
      <div className="fixed top-0 left-0 right-0 z-50 bg-slate-900/90 backdrop-blur text-white text-xs px-4 py-2 flex items-center justify-between">
        <span>디자인 시안 미리보기</span>
        <div className="flex gap-3">
          <a href="/preview/option-a" className="hover:underline">옵션 A · Plum + Cream</a>
          <a href="/preview/option-b" className="hover:underline">옵션 B · Forest + Ivory</a>
          <a href="/" className="hover:underline text-slate-300">← 메인으로</a>
        </div>
      </div>
      <div className="pt-10">{children}</div>
    </>
  );
}

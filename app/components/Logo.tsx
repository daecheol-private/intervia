/**
 * Intervia 로고 마크 — 둥근 사각 배지 안에 "IV" 두 글자(붙여서).
 * Forest gradient 배경 + 흰색 텍스트. 헤더·로그인·면접 화면 등 어디서나 동일.
 *
 * 가변 size — 헤더 32px, 로그인 카드 48px, 면접 채팅 아바타 28~32px.
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded-[22%] bg-gradient-to-br from-primary to-primary-deep text-white font-bold tracking-tighter shadow-sm ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        lineHeight: 1,
      }}
    >
      IV
    </span>
  );
}

/** 로고 + 워드마크 (Intervia 텍스트 포함). 헤더·푸터용. */
export function Logo({
  size = 32,
  showWordmark = true,
  className,
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark size={size} />
      {showWordmark && (
        <span className="font-bold text-ink tracking-tight text-base">
          Intervia
        </span>
      )}
    </span>
  );
}

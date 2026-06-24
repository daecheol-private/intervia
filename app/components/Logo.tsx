/**
 * Intervia 로고 마크 — 인디고 스퀘어클 배지 안에 흰색 "i/" 모노그램(SVG).
 * i(점+세로 바) + 슬래시 — 'iv'를 형상화. 배지 그라데이션은 브랜드 인디고.
 * 워드마크는 'Intervia'(점 없음). 헤더·로그인·면접 화면 등 어디서나 동일.
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
      className={`inline-flex items-center justify-center rounded-[22%] bg-gradient-to-br from-primary to-primary-deep shadow-sm ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="none"
        aria-hidden
      >
        {/* 업로드 시안의 흰 마크를 픽셀에서 컨투어 트레이싱해 추출한 정확한 외곽선(채움).
           i 세로바 직립(좌측 가장자리 x24 수직) + 매끈한 바닥 + 대각선·점이 시안과 동일. */}
        <path
          d="M70.24 36.65 L72.5 36.65 L73.91 37.05 L75.6 37.98 L76.87 39.18 L78.14 41.97 L78.14 43.96 L77.29 46.35 L76.16 47.94 L47.95 77.16 L45.56 79.15 L42.88 80.08 L29.76 80.08 L26.94 79.02 L24.96 77.03 L23.98 73.97 L23.98 44.22 L24.54 41.97 L25.81 40.11 L28.21 38.51 L29.76 38.11 L32.16 38.11 L33.57 38.51 L34.98 39.31 L36.39 40.64 L37.24 42.23 L37.66 43.96 L37.52 69.06 L37.8 69.19 L52.61 53.65 L65.44 39.31 L67.28 37.72 L68.69 37.05 L70.1 36.79 Z"
          fill="#fff"
        />
        <path
          d="M29.9 19.92 L32.58 20.05 L34.84 20.98 L36.81 22.97 L37.8 25.63 L37.66 28.15 L36.53 30.41 L34.13 32.4 L31.88 33.07 L29.76 33.07 L26.94 32.01 L25.11 30.28 L23.98 27.36 L23.98 25.5 L24.96 22.97 L27.22 20.85 L29.76 20.05 Z"
          fill="#fff"
        />
      </svg>
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

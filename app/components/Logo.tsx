/**
 * Intervia 로고 마크 — 네이비 스퀘어클 배지 안에 흰색 "i/" (SVG).
 * i(점+세로 바)와 슬래시(/) 모두 흰색 — 'iv'를 형상화. 배지는 브랜드 네이비 그라데이션.
 * 워드마크는 'Intervia'(점 없음). 헤더·로그인·면접 화면 등 어디서나 동일.
 *
 * 구현: 원본 "i/" 외곽선을 흰색으로 깔고, 그 위에 흰색 세로바·점을 덮음.
 * (원본 컨투어를 보존하면서 슬래시 베이스가 i 밑단에 자연스럽게 연결됨)
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
        {/* 원본 "i/" 외곽선 전체 — 흰색으로 채움. 위에서 흰 세로바·점이 덮여 흰색 "i/"로 통합됨.
            슬래시 윗끝 캡을 대각선 방향(-1.36,+1.46)으로 내려 최상단 y=38.11 로 정렬 → i 세로바 윗끝과 수평. */}
        <path
          d="M68.88 38.11 L71.14 38.11 L72.55 38.51 L74.24 39.44 L75.51 40.64 L76.78 43.43 L76.78 45.42 L75.93 47.81 L74.80 49.40 L47.95 77.16 L45.56 79.15 L42.88 80.08 L29.76 80.08 L26.94 79.02 L24.96 77.03 L23.98 73.97 L23.98 44.22 L24.54 41.97 L25.81 40.11 L28.21 38.51 L29.76 38.11 L32.16 38.11 L33.57 38.51 L34.98 39.31 L36.39 40.64 L37.24 42.23 L37.66 43.96 L37.52 69.06 L37.8 69.19 L52.61 53.65 L64.08 40.77 L65.92 39.18 L67.33 38.51 L68.74 38.25 Z"
          fill="#fff"
        />
        {/* i 세로바 — 흰색으로 슬래시 위에 덮음. 밑단 양쪽 모서리를 둥글게
            (왼쪽 곡선 = 원본 좌표, 오른쪽 곡선 = 중심 x=30.82 기준 미러) */}
        <path
          d="M29.76 80.08 L26.94 79.02 L24.96 77.03 L23.98 73.97 L23.98 44.22 L24.54 41.97 L25.81 40.11 L28.21 38.51 L29.76 38.11 L32.16 38.11 L33.57 38.51 L34.98 39.31 L36.39 40.64 L37.24 42.23 L37.66 43.96 L37.66 73.97 L36.68 77.03 L34.70 79.02 L31.88 80.08 Z"
          fill="#fff"
        />
        {/* i 점 — 흰색 */}
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

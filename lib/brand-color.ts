/**
 * 법인 브랜드 컬러(공개 지원 페이지 포인트 컬러) 유틸 — 서버/클라이언트 공용.
 *
 * 담당자가 어떤 색을 고르든 글자 대비는 시스템이 보장한다. 자유 배경/글자색을
 * 열지 않는 것이 의도된 설계(가독성·전환율 보호)이므로 임의 색 조합 기능을
 * 추가하지 말 것.
 */

export function isValidBrandColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

/** YIQ 밝기 기준 — 밝은 색이면 true (위에 어두운 글자가 필요). */
export function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150;
}

/** 해당 배경색 위에 올릴 글자색 — 흰색 또는 잉크색을 자동 선택. */
export function textColorOn(hex: string): string {
  return isLightColor(hex) ? "#111827" : "#ffffff";
}

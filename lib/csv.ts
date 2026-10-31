/**
 * CSV 셀 이스케이프 — 따옴표·구분자 처리 + 스프레드시트 수식 인젝션 차단.
 * = + - @ 탭 CR 로 시작하는 값은 엑셀이 수식으로 실행하므로(예: 이름에 =HYPERLINK(...)) 앞에 ' 를 붙인다.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

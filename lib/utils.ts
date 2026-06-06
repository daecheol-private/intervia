import { randomBytes } from "node:crypto";

export function generateToken(): string {
  return "tk_" + randomBytes(16).toString("hex");
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * JS Date → SQLite CURRENT_TIMESTAMP 와 같은 포맷 문자열("YYYY-MM-DD HH:MM:SS", UTC).
 * createdAt 처럼 CURRENT_TIMESTAMP 기본값으로 저장된 컬럼과 gte/lte 비교할 때 사용.
 * toISOString()(T 구분자 + Z)와 섞으면 lexicographic 비교가 경계에서 깨진다(GOTCHAS §0-0).
 * (auth-attempts.ts / rate-limit.ts 의 동명 내부 헬퍼와 동일 — 공용화.)
 */
export function sqliteTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/**
 * SQLite CURRENT_TIMESTAMP 는 UTC 시각을 "YYYY-MM-DD HH:MM:SS" 형태로 저장
 * (ISO Z 접미사 없음). JavaScript Date() 는 이런 문자열을 로컬 시간으로 잘못
 * 해석하므로, UTC 임을 명시해 파싱한다. 이미 Z·offset 이 있으면 그대로 둠.
 */
function parseDbTimestamp(iso: string | Date): Date {
  if (typeof iso !== "string") return iso;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(iso)) {
    return new Date(iso.replace(" ", "T") + "Z");
  }
  return new Date(iso);
}

/**
 * 사용자 로컬 TZ 기준 날짜·시각 표시. SSR/CSR 일관성을 위해 명시적 TZ 옵션 전달
 * 가능 (기본 Asia/Seoul — 현재 사용자가 한국 한정).
 *
 * 클라이언트에서 진짜 브라우저 TZ 로 보고 싶으면 useEffect 안에서
 * formatLocalDateTime(iso, { timeZone: undefined }) 호출 — 브라우저 자동.
 *
 * format 옵션으로 Intl.DateTimeFormatOptions 의 임의 키를 덮어쓸 수 있음
 * (예: { format: { second: "2-digit" } } 로 초까지 표시).
 */
export function formatLocalDateTime(
  iso: string | Date,
  opts: { timeZone?: string; format?: Intl.DateTimeFormatOptions } = {}
): string {
  const d = parseDbTimestamp(iso);
  return d.toLocaleString("ko-KR", {
    timeZone: opts.timeZone ?? "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...opts.format,
  });
}

/** @deprecated formatLocalDateTime 사용. KST 하드코딩 유지를 위한 alias. */
export const formatKstDateTime = formatLocalDateTime;

/** 날짜만 표시 (YYYY-MM-DD, Asia/Seoul). */
export function formatLocalDate(
  iso: string | Date,
  opts: { timeZone?: string } = {}
): string {
  const d = parseDbTimestamp(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: opts.timeZone ?? "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts;
}

export function compositeScore(
  screening: number | null | undefined,
  interview: number | null | undefined
): number | null {
  if (screening == null && interview == null) return null;
  if (interview == null) return screening ?? null;
  if (screening == null) return interview ?? null;
  return Math.round(screening * 0.4 + interview * 0.6);
}

export function recommendationFromScore(
  score: number
): "강력추천" | "추천" | "보류" | "비추천" {
  if (score >= 85) return "강력추천";
  if (score >= 70) return "추천";
  if (score >= 50) return "보류";
  return "비추천";
}

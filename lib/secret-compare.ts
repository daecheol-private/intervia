import { timingSafeEqual } from "node:crypto";

/**
 * 시크릿(CRON_SECRET / INTERNAL_API_SECRET 등) 문자열 비교를 상수 시간으로 수행.
 * 일반 `===` 는 첫 불일치 바이트에서 조기 종료해 타이밍 사이드채널을 남긴다.
 * 길이가 다르면 즉시 false (길이는 어차피 응답 크기 등으로 노출되므로 비교 대상 아님).
 * a/b 중 하나라도 비어 있으면 false — 시크릿 미설정 시 우회 방지는 호출부에서 별도 처리.
 */
export function secretEquals(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

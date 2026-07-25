/**
 * 메일 발송량 집계 — 발신 서버 일·월 한도 모니터링(/api/cron/quota-alerts) +
 * 불합격 저녁 드레인(/api/cron/decision-drain)의 일일 발송 예산 계산.
 *
 * 집계 원천은 mail_send_events (sendMail 성공마다 1행, 수신자 PII 없음).
 * sent_at 은 CURRENT_TIMESTAMP('YYYY-MM-DD HH:MM:SS' UTC) 형식이라 같은 UTC 형식으로 비교한다.
 *
 * "오늘"·"이번 달" 은 UTC 달력 기준이다 — 발신 서버의 한도 리셋 시각을 알 수 없어도,
 * 달력일 기준은 매일 같은 시각 드레인에서 경계 정체(직전 드레인분이 롤링 창 끝에 걸려
 * 예산이 0이 되는 문제)를 피한다. 리셋 시각 불확실성은 드레인의 버퍼(MAIL_DAILY_BUFFER)가
 * 흡수한다.
 */
import { db } from "./db";
import { mailSendEvents } from "./schema";
import { sql, gte, lt } from "drizzle-orm";

/** Date → UTC 'YYYY-MM-DD HH:MM:SS' (schema sent_at 형식과 동일). */
function utcStamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export type MailAudienceKind = "candidate" | "org";

/**
 * 발송 1건 기록 — sendMail 성공 직후 호출한다. best-effort: 집계 실패가 실제 발송을
 * 되돌리거나 막아서는 안 되므로 호출부에서 반드시 catch 로 감싼다(여기서는 throw 가능).
 */
export async function recordMailSend(
  audience: MailAudienceKind,
  kind?: string | null
): Promise<void> {
  await db.insert(mailSendEvents).values({ audience, kind: kind ?? null });
}

async function countSince(stamp: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(mailSendEvents)
    .where(gte(mailSendEvents.sentAt, stamp));
  return Number(row?.c ?? 0);
}

/** 오늘(UTC 달력일 00:00 이후) 발송 수 — 일 100통 대비 + 드레인 예산 기준값. */
export async function sentToday(now = new Date()): Promise<number> {
  return countSince(now.toISOString().slice(0, 10) + " 00:00:00");
}

/** 이번 달(UTC 1일 00:00 이후) 발송 수 — 월 3,000통 대비. */
export async function sentThisMonth(now = new Date()): Promise<number> {
  return countSince(now.toISOString().slice(0, 7) + "-01 00:00:00");
}

/** 최근 N시간(롤링) 발송 수 — 필요 시 보수적 창 확인용. */
export async function sentInWindow(hours: number, now = new Date()): Promise<number> {
  return countSince(utcStamp(new Date(now.getTime() - hours * 3_600_000)));
}

/** N일 경과 이벤트 정리 — 무한 누적 방지(일일 cron 에서 호출). 삭제 행 수 반환. */
export async function pruneMailEvents(days = 45, now = new Date()): Promise<number> {
  const cutoff = utcStamp(new Date(now.getTime() - days * 86_400_000));
  const result = await db
    .delete(mailSendEvents)
    .where(lt(mailSendEvents.sentAt, cutoff));
  return Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
}

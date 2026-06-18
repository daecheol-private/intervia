import { db } from "@/lib/db";
import { marketingRecipients, users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { normalizeEmail } from "@/lib/email-domain";

/**
 * 마케팅(광고성) 메일 수신동의 — users.marketingConsentAt 이 동의 원천이고,
 * 발송 대상 목록(marketingRecipients)은 그에 맞춰 동기화되는 미러다.
 *
 * 회원 동의/철회(가입·개인설정)와 메일 수신거부 링크가 모두 이 모듈을 통해
 * 두 테이블을 일관되게 유지한다. 관리자 수신함은 marketingRecipients 를 그대로
 * 조회하므로 동의자는 자동으로 발송 대상 목록에 편입된다.
 */

/**
 * 발송 대상 목록(marketingRecipients) 을 email 기준으로 upsert.
 * - optIn=true : 행 있으면 active 로 되살림(이전 수신거부 해제), 없으면 신규 등록.
 * - optIn=false: 행 있으면 unsubscribed 처리. 없으면 no-op.
 */
export async function syncMarketingRecipient(
  email: string,
  optIn: boolean
): Promise<void> {
  const e = normalizeEmail(email);
  const [existing] = await db
    .select({ id: marketingRecipients.id })
    .from(marketingRecipients)
    .where(eq(marketingRecipients.email, e));
  const now = new Date().toISOString();

  if (optIn) {
    if (existing) {
      // 이전에 수신거부했더라도 재동의 시 되살림 — unsubscribedAt 클리어.
      await db
        .update(marketingRecipients)
        .set({ status: "active", unsubscribedAt: null })
        .where(eq(marketingRecipients.id, existing.id));
    } else {
      await db.insert(marketingRecipients).values({
        email: e,
        // 수신거부 페이지 접근 토큰 — admin/marketing/route.ts 와 동일 패턴.
        unsubscribeToken: randomBytes(24).toString("base64url"),
      });
    }
  } else if (existing) {
    await db
      .update(marketingRecipients)
      .set({ status: "unsubscribed", unsubscribedAt: now })
      .where(eq(marketingRecipients.id, existing.id));
  }
}

/**
 * 회원의 마케팅 수신동의 상태 설정 — users(동의 원천) + marketingRecipients(발송 미러)
 * 를 함께 갱신한다. 가입 동의·개인설정 토글 양쪽에서 사용.
 *
 * 철회 시 IP/UA 는 보존(동의→철회 이력 입증)하고 marketingConsentAt 만 null 로 비운다.
 */
export async function setUserMarketingConsent(opts: {
  userId: number;
  email: string;
  optIn: boolean;
  ip?: string | null;
  ua?: string | null;
}): Promise<void> {
  const { userId, email, optIn, ip, ua } = opts;
  const now = new Date().toISOString();

  await db
    .update(users)
    .set(
      optIn
        ? {
            marketingConsentAt: now,
            marketingConsentIp: ip ?? null,
            marketingConsentUa: ua ?? null,
          }
        : { marketingConsentAt: null }
    )
    .where(eq(users.id, userId));

  await syncMarketingRecipient(email, optIn);
}

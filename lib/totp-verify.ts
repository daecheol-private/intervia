/**
 * TOTP 검증 + replay 방어 (DB 연동).
 *
 * `verifyCodeReturningCounter` 로 코드를 검증하고, 성공한 timestep(counter) 를
 * `users.lastTotpCounter` 에 기록한다. 같은(또는 더 과거) counter 의 코드는 재사용을
 * 거부 → 가로챈 코드를 유효 윈도우(~90초) 안에 재사용하는 replay 공격을 차단한다 (RFC 6238).
 *
 * 순수 crypto 인 `lib/totp.ts` 와 분리 — 이쪽은 DB 에 의존.
 */
import { db } from "./db";
import { users } from "./schema";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { verifyCodeReturningCounter } from "./totp";

export async function verifyAndConsumeTotp(
  userId: number,
  secret: string,
  code: string
): Promise<boolean> {
  const [row] = await db
    .select({ last: users.lastTotpCounter })
    .from(users)
    .where(eq(users.id, userId));
  const after = row?.last ?? undefined;

  const counter = verifyCodeReturningCounter(secret, code, { after });
  if (counter === null) return false;

  // 조건부 UPDATE — 동시 요청이 같은 코드로 동시에 통과하는 race 를 차단.
  // 더 큰 counter 로만 전진(monotonic). 0행 갱신이면 다른 요청이 이미 소비한 것 → 거부.
  const res = await db
    .update(users)
    .set({ lastTotpCounter: counter })
    .where(
      and(
        eq(users.id, userId),
        or(isNull(users.lastTotpCounter), lt(users.lastTotpCounter, counter))
      )
    )
    .returning({ id: users.id });

  return res.length > 0;
}

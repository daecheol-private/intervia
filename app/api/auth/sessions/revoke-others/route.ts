/**
 * 현재 세션을 제외한 모든 세션 종료. 비밀번호 변경 후 권장.
 */
import { db } from "@/lib/db";
import { sessions } from "@/lib/schema";
import { and, eq, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function POST() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const r = await db
    .delete(sessions)
    .where(
      and(eq(sessions.userId, me!.id), ne(sessions.token, me!.sessionToken))
    )
    .returning({ token: sessions.token });

  return Response.json({ revoked: r.length });
}

import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

// 로그인 사용자의 "오늘의 할 일 요약 메일"(daily digest, 매일 아침 발송) 수신 여부.
// optIn=true(기본): 수신, false: 수신 거부. 면접 일정·합격 통지 등 다른 운영 메일과 무관.
export async function GET() {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;
  const [row] = await db
    .select({ optOutAt: users.dailyDigestOptOutAt })
    .from(users)
    .where(eq(users.id, me!.id));
  // null = 수신(기본), 값 있으면 = 본인이 끔.
  return Response.json({ optIn: row?.optOutAt == null });
}

// 요약 메일 수신 켜기/끄기. optOutAt(null=수신 / 시각=끔) 만 토글한다.
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;

  const body = (await req.json().catch(() => null)) as { optIn?: boolean } | null;
  if (typeof body?.optIn !== "boolean")
    return new Response("optIn(boolean) 값이 필요합니다.", { status: 400 });

  await db
    .update(users)
    .set({ dailyDigestOptOutAt: body.optIn ? null : sql`(CURRENT_TIMESTAMP)` })
    .where(eq(users.id, me!.id));
  return Response.json({ ok: true, optIn: body.optIn });
}

import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { extractIp } from "@/lib/auth-attempts";
import { setUserMarketingConsent } from "@/lib/marketing-consent";

export const runtime = "nodejs";

// 로그인 사용자의 마케팅(광고성) 메일 수신동의 현재 상태.
export async function GET() {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;
  const [row] = await db
    .select({ marketingConsentAt: users.marketingConsentAt })
    .from(users)
    .where(eq(users.id, me!.id));
  return Response.json({ optIn: row?.marketingConsentAt != null });
}

// 마케팅 수신동의 켜기/끄기 — users(동의 원천) + marketingRecipients(발송 미러) 동기화.
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;

  const body = (await req.json().catch(() => null)) as { optIn?: boolean } | null;
  if (typeof body?.optIn !== "boolean")
    return new Response("optIn(boolean) 값이 필요합니다.", { status: 400 });

  await setUserMarketingConsent({
    userId: me!.id,
    email: me!.email,
    optIn: body.optIn,
    ip: extractIp(req),
    ua: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  });
  return Response.json({ ok: true, optIn: body.optIn });
}

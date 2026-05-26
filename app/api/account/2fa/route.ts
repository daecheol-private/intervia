import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });
  const [u] = await db
    .select({ enabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, me.id));
  return Response.json({ enabled: !!u?.enabledAt, enabledAt: u?.enabledAt ?? null });
}

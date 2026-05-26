import { getCurrentUser } from "@/lib/auth";
import { markAllRead } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST() {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });
  await markAllRead(me.id);
  return Response.json({ ok: true });
}

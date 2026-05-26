import { getCurrentUser } from "@/lib/auth";
import { listMyNotifications, unreadCount } from "@/lib/notifications";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });
  const [items, unread] = await Promise.all([
    listMyNotifications(me.id, 20),
    unreadCount(me.id),
  ]);
  return Response.json({ items, unread });
}

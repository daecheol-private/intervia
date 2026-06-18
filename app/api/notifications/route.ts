import { getCurrentUser } from "@/lib/auth";
import { listMyNotifications, unreadCount } from "@/lib/notifications";
import { isTransientDbError } from "@/lib/db-retry";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });
  try {
    const [items, unread] = await Promise.all([
      listMyNotifications(me.id, 20),
      unreadCount(me.id),
    ]);
    return Response.json({ items, unread });
  } catch (e) {
    // 60초 폴링이라, 재시도까지 소진한 Turso 일시 장애(502 등)는 best-effort 로 빈 결과를
    // 돌려 Sentry 도배를 막는다(클라이언트 벨은 이 사이클만 건너뛰고 다음에 복구).
    // 비일시적 오류(진짜 버그)는 그대로 throw → Sentry 가시성 유지.
    if (!isTransientDbError(e)) throw e;
    return Response.json({ items: [], unread: 0 });
  }
}

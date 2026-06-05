/**
 * 운영 공지 발송 — system_admin 전용.
 *
 * POST: 전체 활성 사용자에게 인앱 알림(type=announcement) fanout. 강제 모달 없음 — 알림 벨/목록에만 노출.
 * GET : 예상 수신자(활성 사용자) 수. 발송 폼 표시용.
 *
 * href 는 내부 경로('/'로 시작)만 허용 — 오픈 리다이렉트/외부 링크 방지. 미입력 시 /notifications.
 */
import { getCurrentUser } from "@/lib/auth";
import { requirePasswordChanged } from "@/lib/tenant";
import { broadcastAnnouncement, activeUserCount } from "@/lib/notifications";

export const runtime = "nodejs";

const MAX_TITLE = 200;

async function requireSysAdmin(): Promise<Response | null> {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });
  if (me.role !== "system_admin") return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;
  return null;
}

export async function GET() {
  const guard = await requireSysAdmin();
  if (guard) return guard;
  return Response.json({ activeUsers: await activeUserCount() });
}

export async function POST(req: Request) {
  const guard = await requireSysAdmin();
  if (guard) return guard;

  let body: { title?: unknown; href?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("잘못된 요청", { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const href = typeof body.href === "string" ? body.href.trim() : "";

  if (title.length < 2) return new Response("공지 내용은 2자 이상", { status: 400 });
  if (title.length > MAX_TITLE)
    return new Response(`공지 내용은 ${MAX_TITLE}자 이하`, { status: 400 });
  if (href && !href.startsWith("/"))
    return new Response("링크는 '/' 로 시작하는 내부 경로만 가능", { status: 400 });

  const sent = await broadcastAnnouncement({ title, href: href || undefined });
  return Response.json({ sent });
}

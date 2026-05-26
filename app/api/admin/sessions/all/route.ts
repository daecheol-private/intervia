/**
 * 전체 사용자 강제 로그아웃 — 보안사고 대응. sysadmin 전용.
 * 본인 세션은 보호 (실수로 본인 락아웃 방지).
 * 헤더 또는 body 에 `confirm: "FORCE-LOGOUT-ALL"` 필수.
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { sessions } from "@/lib/schema";
import { ne } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    confirm?: string;
    reason?: string;
  };
  if (body.confirm !== "FORCE-LOGOUT-ALL")
    return new Response(
      'confirm: "FORCE-LOGOUT-ALL" 문자열이 정확히 필요합니다.',
      { status: 400 }
    );
  const reason = (body.reason ?? "").trim();
  if (reason.length < 5)
    return new Response("사유는 5자 이상 입력하세요.", { status: 400 });

  const deleted = await db
    .delete(sessions)
    .where(ne(sessions.userId, me!.id))
    .returning({ token: sessions.token });

  logAudit(req, {
    actor: me,
    action: "session.force_logout",
    resourceType: "user",
    resourceId: 0,
    metadata: {
      scope: "all",
      sessionsRevoked: deleted.length,
      reason,
    },
  });

  return Response.json({ sessionsRevoked: deleted.length });
}

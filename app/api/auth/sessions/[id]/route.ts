/**
 * 특정 세션 종료 (원격 로그아웃).
 *
 * URL 파라미터 [id] 는 displayId (token 앞 12자). 서버에서 prefix 매칭 + userId 가드.
 * 현재 세션 (sessionToken) 은 거부 — 본인은 /api/auth/logout 사용.
 */
import { db } from "@/lib/db";
import { sessions } from "@/lib/schema";
import { and, eq, like } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  if (!id || id.length < 8 || id.length > 50)
    return new Response("Bad request", { status: 400 });

  // displayId 로 prefix 검색 + 본인 세션만
  const [target] = await db
    .select({ token: sessions.token })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, me!.id),
        like(sessions.token, `${id}%`)
      )
    )
    .limit(1);
  if (!target) return new Response("Not found", { status: 404 });

  if (target.token === me!.sessionToken)
    return new Response(
      "현재 세션은 로그아웃 버튼으로 종료해 주세요.",
      { status: 400 }
    );

  await db.delete(sessions).where(eq(sessions.token, target.token));
  return new Response(null, { status: 204 });
}

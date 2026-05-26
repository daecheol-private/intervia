import { getCurrentUser } from "@/lib/auth";
import { markRead } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0)
    return new Response("잘못된 id", { status: 400 });
  await markRead(me.id, idNum);
  return Response.json({ ok: true });
}

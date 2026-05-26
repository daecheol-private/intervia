import { consumeVerificationToken } from "@/lib/email-verify";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token) return new Response("token 필수", { status: 400 });
  const result = await consumeVerificationToken(token);
  if (!result.ok) return new Response(result.reason ?? "검증 실패", { status: 400 });
  return Response.json({ ok: true });
}

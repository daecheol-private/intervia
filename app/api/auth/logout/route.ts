import { cookies } from "next/headers";
import { SESSION_COOKIE, deleteSession, clearSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  await clearSessionCookie();
  return new Response(null, { status: 204 });
}

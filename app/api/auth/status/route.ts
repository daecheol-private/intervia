import { hasAnyUser, getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  const setupRequired = !(await hasAnyUser());
  return Response.json({ user, setupRequired });
}

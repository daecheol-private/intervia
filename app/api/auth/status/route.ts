import { hasAnyUser, getCurrentUser } from "@/lib/auth";
import { ensureSystemAdmin } from "@/lib/bootstrap-admin";

export const runtime = "nodejs";

export async function GET() {
  // 환경변수 기반 system_admin 부트스트랩 — 미설정/이미 존재 시 no-op.
  await ensureSystemAdmin();
  const user = await getCurrentUser();
  const setupRequired = !(await hasAnyUser());
  return Response.json({ user, setupRequired });
}
